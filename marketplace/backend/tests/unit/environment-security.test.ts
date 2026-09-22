import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/config/env.js";
import { refreshCookieOptions } from "../../src/http/cookies/refresh-cookie.js";

/** Builds the smallest valid environment needed to test cross-field security rules. */
function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://marketplace:marketplace@localhost:5432/marketplace",
    JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters-long",
    STORAGE_BUCKET: "marketplace-test",
    STRIPE_SECRET_KEY: "sk_test_environment_security",
    STRIPE_WEBHOOK_SECRET: "whsec_environment_security",
    STRIPE_CURRENCY_EXPONENTS_JSON: JSON.stringify({ USD: 2, PKR: 2 }),
    ...overrides,
  };
}

describe("Foundation environment security", () => {
  it("requires Stripe credentials because Payments is always composed at startup", () => {
    const input = validEnvironment({
      STRIPE_SECRET_KEY: undefined,
      STRIPE_WEBHOOK_SECRET: undefined,
    });

    expect(() => parseEnvironment(input)).toThrow(
      "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required because the Payments service is always enabled.",
    );
  });

  it("requires both Stripe credentials when either one is configured", () => {
    const input = validEnvironment({
      STRIPE_WEBHOOK_SECRET: undefined,
    });

    expect(() => parseEnvironment(input)).toThrow(
      "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required because the Payments service is always enabled.",
    );
  });

  it("rejects an insecure refresh cookie configuration in production", () => {
    const input = validEnvironment({
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      INTERNAL_API_KEY: "production-internal-api-key-that-is-at-least-32-characters",
    });

    expect(() => parseEnvironment(input)).toThrow(
      "COOKIE_SECURE must be true in production",
    );
  });

  it("accepts a secure refresh cookie configuration in production", () => {
    const input = validEnvironment({
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      INTERNAL_API_KEY: "production-internal-api-key-that-is-at-least-32-characters",
      PAYOUT_PROVIDER_MODE: "module",
      PAYOUT_PROVIDER_TYPE: "configured_provider",
      PAYOUT_PROVIDER_ADAPTER_MODULE: "/app/providers/configured-payout-provider.js",
    });

    const environment = parseEnvironment(input);
    expect(environment.COOKIE_SECURE).toBe(true);
    expect(environment.DOCUMENT_UPLOAD_POLICY_JSON).toBe("{}");
  });


  it("requires deployment-owned payout-provider composition in production", () => {
    const input = validEnvironment({
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      INTERNAL_API_KEY: "production-internal-api-key-that-is-at-least-32-characters",
    });

    expect(() => parseEnvironment(input)).toThrow(
      "Production requires a deployment-configured payout provider module.",
    );
  });

  it("rejects deterministic payout-provider and clock overrides in production", () => {
    const input = validEnvironment({
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      INTERNAL_API_KEY: "production-internal-api-key-that-is-at-least-32-characters",
      PAYOUT_PROVIDER_MODE: "deterministic_test",
      PAYOUT_PROVIDER_TYPE: "e2e",
      WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS: "2",
    });

    expect(() => parseEnvironment(input)).toThrow(
      "The deterministic payout provider is only allowed outside production.",
    );
  });

  it("still permits insecure cookies for local development", () => {
    const input = validEnvironment({
      NODE_ENV: "development",
      COOKIE_SECURE: "false",
      COOKIE_SAME_SITE: "lax",
    });

    expect(parseEnvironment(input).COOKIE_SECURE).toBe(false);
  });

  it("enables compose-backed seller upload purposes for local development", () => {
    const environment = parseEnvironment(validEnvironment({ NODE_ENV: "development" }));
    const policy = JSON.parse(environment.DOCUMENT_UPLOAD_POLICY_JSON) as Record<
      string,
      { allowedMimeTypes: string[]; maxSizeBytes: number }
    >;

    expect(environment.STORAGE_ENDPOINT).toBe("http://127.0.0.1:59010");
    expect(environment.STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(policy.product_media).toEqual({
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxSizeBytes: 5_242_880,
    });
    expect(policy.seller_verification).toBeDefined();
    expect(policy.store_asset).toBeDefined();
  });

  it("augments a partial local upload policy while preserving explicit rules", () => {
    const environment = parseEnvironment(
      validEnvironment({
        NODE_ENV: "development",
        DOCUMENT_UPLOAD_POLICY_JSON: JSON.stringify({
          store_asset: { allowedMimeTypes: ["image/png"], maxSizeBytes: 1_024 },
        }),
      }),
    );
    const policy = JSON.parse(environment.DOCUMENT_UPLOAD_POLICY_JSON) as Record<
      string,
      { allowedMimeTypes: string[]; maxSizeBytes: number }
    >;

    expect(policy.store_asset?.maxSizeBytes).toBe(1_024);
    expect(policy.product_media).toBeDefined();
  });

  it("requires secure cookies whenever SameSite is none", () => {
    const input = validEnvironment({
      NODE_ENV: "development",
      COOKIE_SECURE: "false",
      COOKIE_SAME_SITE: "none",
    });

    expect(() => parseEnvironment(input)).toThrow(
      "COOKIE_SECURE must be true when COOKIE_SAME_SITE=none",
    );
  });

  it("keeps the refresh cookie HttpOnly and scoped to authentication routes", () => {
    const options = refreshCookieOptions(60_000);

    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/api/v1/auth");
    expect(options.maxAge).toBe(60_000);
  });
});

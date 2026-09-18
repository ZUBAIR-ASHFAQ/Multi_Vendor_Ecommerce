import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/config/env.js";
import { refreshCookieOptions } from "../../src/http/cookies/refresh-cookie.js";

/** Builds the smallest valid environment needed to test cross-field security rules. */
function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://marketplace:marketplace@localhost:5432/marketplace",
    JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters-long",
    STORAGE_BUCKET: "marketplace-test",
    ...overrides,
  };
}

describe("Foundation environment security", () => {
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

    expect(parseEnvironment(input).COOKIE_SECURE).toBe(true);
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

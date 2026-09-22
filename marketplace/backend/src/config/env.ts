import "dotenv/config";
import { z } from "zod";

/** Builds a strict boolean environment-variable parser with one default value. */
function environmentBoolean(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");
}

const secretSchema = z.string().min(32, "Secret must contain at least 32 characters");

const LOCAL_DEVELOPMENT_UPLOAD_POLICY = {
  seller_verification: {
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
    maxSizeBytes: 5_242_880,
  },
  store_asset: {
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxSizeBytes: 5_242_880,
  },
  product_media: {
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    maxSizeBytes: 5_242_880,
  },
} as const;

/**
 * Supplies compose-backed storage defaults for local development and augments a partial local
 * upload policy with the purposes used by the seller workflows. Production remains fail-closed.
 */
function applyLocalDevelopmentDefaults(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...input };
  if ((normalized.NODE_ENV ?? "development") !== "development") return normalized;

  normalized.STORAGE_PROVIDER ??= "s3_compatible";
  normalized.STORAGE_REGION ??= "us-east-1";
  normalized.STORAGE_ENDPOINT ??= "http://127.0.0.1:59010";
  normalized.STORAGE_ACCESS_KEY_ID ??= "marketplace-dev";
  normalized.STORAGE_SECRET_ACCESS_KEY ??= "marketplace-dev-secret";
  normalized.STORAGE_FORCE_PATH_STYLE ??= "true";
  normalized.STORAGE_SIGNED_URL_TTL_SECONDS ??= "900";

  const configuredPolicy = normalized.DOCUMENT_UPLOAD_POLICY_JSON?.trim();
  if (!configuredPolicy) {
    normalized.DOCUMENT_UPLOAD_POLICY_JSON = JSON.stringify(LOCAL_DEVELOPMENT_UPLOAD_POLICY);
    return normalized;
  }

  try {
    const parsed = JSON.parse(configuredPolicy) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      normalized.DOCUMENT_UPLOAD_POLICY_JSON = JSON.stringify({
        ...LOCAL_DEVELOPMENT_UPLOAD_POLICY,
        ...(parsed as Record<string, unknown>),
      });
    }
  } catch {
    // Preserve invalid input so Module 21 reports its existing precise startup error.
  }

  return normalized;
}

const environmentObjectSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE_NAME: z.string().trim().min(1).max(100).default("marketplace-backend"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HTTP_TRUST_PROXY: environmentBoolean("false"),
  HTTP_BODY_LIMIT: z.string().trim().regex(/^\d+(kb|mb)$/i).default("1mb"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.string().url()).min(1)),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(300),
  SWAGGER_ENABLED: environmentBoolean("true"),
  PRODUCT_MODERATION_REQUIRED: environmentBoolean("true"),
  REVIEW_MODERATION_REQUIRED: environmentBoolean("false"),
  COOKIE_SECURE: environmentBoolean("false"),
  COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().trim().min(1).optional(),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_SSL: environmentBoolean("false"),
  DB_SSL_REJECT_UNAUTHORIZED: environmentBoolean("true"),
  DB_APPLICATION_NAME: z.string().trim().min(1).max(100).default("marketplace-backend"),

  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  BULLMQ_PREFIX: z.string().trim().min(1).max(100).default("marketplace"),
  JOB_DEFAULT_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  JOB_BACKOFF_MS: z.coerce.number().int().min(100).max(3_600_000).default(1_000),
  JOB_DEFAULT_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),

  JWT_ACCESS_SECRET: secretSchema,
  INTERNAL_API_KEY: secretSchema.optional(),
  JWT_ISSUER: z.string().trim().min(1).max(200).default("marketplace-api"),
  JWT_AUDIENCE: z.string().trim().min(1).max(200).default("marketplace-web"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_BYTES: z.coerce.number().int().min(32).max(128).default(48),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000).default(2_592_000),
  ARGON2_MEMORY_COST: z.coerce.number().int().min(19_456).max(1_048_576).default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(200).optional(),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Initial Platform Administrator"),

  CHECKOUT_QUOTE_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
  CHECKOUT_ATTEMPT_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
  IDEMPOTENCY_LOCK_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  IDEMPOTENCY_RETENTION_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(86_400),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  OUTBOX_CLAIM_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  OUTBOX_BASE_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(3_600_000).default(1_000),
  OUTBOX_MAX_RETRY_DELAY_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(300_000),

  STORAGE_BUCKET: z.string().trim().min(1),
  STORAGE_PROVIDER: z.enum(["s3", "r2", "s3_compatible"]).default("s3_compatible"),
  STORAGE_REGION: z.string().trim().min(1).default("auto"),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_FORCE_PATH_STYLE: environmentBoolean("false"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  DOCUMENT_UPLOAD_POLICY_JSON: z.string().trim().min(2).default("{}"),

  STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  STRIPE_CURRENCY_EXPONENTS_JSON: z.string().trim().min(2).default("{}"),
  STRIPE_API_BASE_URL: z.string().url().optional(),

  NOTIFICATION_EMAIL_PROVIDER_MODE: z
    .enum(["disabled", "resend", "deterministic_test"])
    .default("disabled"),
  NOTIFICATION_EMAIL_FROM: z.string().trim().email().optional(),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  RESEND_API_BASE_URL: z.string().url().optional(),

  PAYOUT_PROVIDER_MODE: z
    .enum(["unconfigured", "module", "deterministic_test"])
    .default("unconfigured"),
  PAYOUT_PROVIDER_TYPE: z.string().trim().min(1).max(40).optional(),
  PAYOUT_PROVIDER_ADAPTER_MODULE: z.string().trim().min(1).max(500).optional(),
  WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS: z.coerce.number().int().min(0).max(30).default(0),
});

type EnvironmentObject = z.infer<typeof environmentObjectSchema>;

/** Validates the configured Stripe currency exponent map without exposing any provider secrets. */
function validateStripeCurrencyExponentMap(value: string, ctx: z.RefinementCtx): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      path: ["STRIPE_CURRENCY_EXPONENTS_JSON"],
      message: "STRIPE_CURRENCY_EXPONENTS_JSON must be valid JSON.",
    });
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    ctx.addIssue({
      code: "custom",
      path: ["STRIPE_CURRENCY_EXPONENTS_JSON"],
      message: "STRIPE_CURRENCY_EXPONENTS_JSON must be an object of currency codes to non-negative integer exponents.",
    });
    return;
  }

  for (const [currency, exponent] of Object.entries(parsed)) {
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isInteger(exponent) || Number(exponent) < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_CURRENCY_EXPONENTS_JSON"],
        message: "Stripe currency exponents require uppercase three-letter codes and non-negative integer values.",
      });
      return;
    }
  }
}

/** Adds security and consistency checks that depend on multiple environment values. */
function validateEnvironmentRelationships(value: EnvironmentObject, ctx: z.RefinementCtx): void {
  const hasAccessKey = Boolean(value.STORAGE_ACCESS_KEY_ID);
  const hasStripeSecret = Boolean(value.STRIPE_SECRET_KEY);
  const hasStripeWebhookSecret = Boolean(value.STRIPE_WEBHOOK_SECRET);

  validateStripeCurrencyExponentMap(value.STRIPE_CURRENCY_EXPONENTS_JSON, ctx);

  if (!hasStripeSecret || !hasStripeWebhookSecret) {
    ctx.addIssue({
      code: "custom",
      path: ["STRIPE_SECRET_KEY"],
      message:
        "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required because the Payments service is always enabled.",
    });
  }

  if (value.NODE_ENV === "production" && value.STRIPE_API_BASE_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["STRIPE_API_BASE_URL"],
      message: "STRIPE_API_BASE_URL is only allowed outside production for provider-test infrastructure.",
    });
  }

  if ((hasStripeSecret || hasStripeWebhookSecret) && value.STRIPE_CURRENCY_EXPONENTS_JSON === "{}") {
    ctx.addIssue({
      code: "custom",
      path: ["STRIPE_CURRENCY_EXPONENTS_JSON"],
      message: "At least one Stripe currency exponent is required when Stripe credentials are configured.",
    });
  }


  const resendConfigured = Boolean(value.RESEND_API_KEY);
  const notificationFromConfigured = Boolean(value.NOTIFICATION_EMAIL_FROM);
  if (
    value.NOTIFICATION_EMAIL_PROVIDER_MODE === "resend" &&
    (!resendConfigured || !notificationFromConfigured)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "Resend Notification email mode requires RESEND_API_KEY and NOTIFICATION_EMAIL_FROM.",
    });
  }
  if (
    value.NOTIFICATION_EMAIL_PROVIDER_MODE === "deterministic_test" &&
    value.NODE_ENV === "production"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["NOTIFICATION_EMAIL_PROVIDER_MODE"],
      message: "The deterministic Notification email provider is only allowed outside production.",
    });
  }
  if (value.NODE_ENV === "production" && value.RESEND_API_BASE_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_BASE_URL"],
      message: "RESEND_API_BASE_URL is only allowed outside production for provider-test infrastructure.",
    });
  }

  const payoutModuleConfigured = Boolean(value.PAYOUT_PROVIDER_ADAPTER_MODULE);
  const payoutTypeConfigured = Boolean(value.PAYOUT_PROVIDER_TYPE);
  if (value.PAYOUT_PROVIDER_MODE === "module" && (!payoutModuleConfigured || !payoutTypeConfigured)) {
    ctx.addIssue({
      code: "custom",
      path: ["PAYOUT_PROVIDER_ADAPTER_MODULE"],
      message: "Module payout mode requires PAYOUT_PROVIDER_TYPE and PAYOUT_PROVIDER_ADAPTER_MODULE.",
    });
  }
  if (value.PAYOUT_PROVIDER_MODE === "deterministic_test" && value.NODE_ENV === "production") {
    ctx.addIssue({
      code: "custom",
      path: ["PAYOUT_PROVIDER_MODE"],
      message: "The deterministic payout provider is only allowed outside production.",
    });
  }
  if (value.PAYOUT_PROVIDER_MODE === "deterministic_test" && !payoutTypeConfigured) {
    ctx.addIssue({
      code: "custom",
      path: ["PAYOUT_PROVIDER_TYPE"],
      message: "Deterministic payout mode requires PAYOUT_PROVIDER_TYPE.",
    });
  }
  if (value.NODE_ENV === "production" && value.PAYOUT_PROVIDER_MODE !== "module") {
    ctx.addIssue({
      code: "custom",
      path: ["PAYOUT_PROVIDER_MODE"],
      message: "Production requires a deployment-configured payout provider module.",
    });
  }
  if (value.NODE_ENV === "production" && value.WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS !== 0) {
    ctx.addIssue({
      code: "custom",
      path: ["WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS"],
      message: "Wallet/Payout test clock offset is not allowed in production.",
    });
  }

  const hasSecret = Boolean(value.STORAGE_SECRET_ACCESS_KEY);

  if (!value.COOKIE_SECURE && value.NODE_ENV === "production") {
    ctx.addIssue({
      code: "custom",
      path: ["COOKIE_SECURE"],
      message: "COOKIE_SECURE must be true in production",
    });
  } else if (!value.COOKIE_SECURE && value.COOKIE_SAME_SITE === "none") {
    ctx.addIssue({
      code: "custom",
      path: ["COOKIE_SECURE"],
      message: "COOKIE_SECURE must be true when COOKIE_SAME_SITE=none",
    });
  }

  if (hasAccessKey !== hasSecret) {
    ctx.addIssue({
      code: "custom",
      path: ["STORAGE_ACCESS_KEY_ID"],
      message: "STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY must be provided together",
    });
  }

  if (value.NODE_ENV === "production" && !value.INTERNAL_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["INTERNAL_API_KEY"],
      message: "INTERNAL_API_KEY is required in production",
    });
  }

  const hasBootstrapEmail = Boolean(value.BOOTSTRAP_ADMIN_EMAIL);
  const hasBootstrapPassword = Boolean(value.BOOTSTRAP_ADMIN_PASSWORD);
  if (hasBootstrapEmail !== hasBootstrapPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["BOOTSTRAP_ADMIN_EMAIL"],
      message: "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be provided together",
    });
  }
}

const environmentSchema = environmentObjectSchema.superRefine(validateEnvironmentRelationships);

export type Environment = z.infer<typeof environmentSchema>;

/** Parses runtime environment values and throws one readable startup error when validation fails. */
export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const parsedEnvironment = environmentSchema.safeParse(applyLocalDevelopmentDefaults(input));

  if (!parsedEnvironment.success) {
    const issues = parsedEnvironment.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid backend environment configuration: ${issues}`);
  }

  return parsedEnvironment.data;
}

/** Validated runtime environment. Secrets are intentionally never logged from this object. */
export const env = parseEnvironment(process.env);

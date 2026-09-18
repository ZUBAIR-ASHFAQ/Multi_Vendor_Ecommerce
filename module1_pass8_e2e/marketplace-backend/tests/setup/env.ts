/**
 * Test-only environment bootstrap.
 * It deliberately targets dedicated test ports so a developer's normal database cannot be used accidentally.
 */
process.env.NODE_ENV = "test";
process.env.SERVICE_NAME = "marketplace-backend-test";
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";
process.env.HOST = "127.0.0.1";
process.env.PORT = "3100";
process.env.HTTP_TRUST_PROXY = "false";
process.env.HTTP_BODY_LIMIT = "16kb";
process.env.CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.RATE_LIMIT_MAX = "1000";
process.env.SWAGGER_ENABLED = "true";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
process.env.DB_POOL_MAX = "4";
process.env.DB_SSL = "false";
process.env.DB_SSL_REJECT_UNAUTHORIZED = "true";
process.env.DB_APPLICATION_NAME = "marketplace-backend-test";

process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379";
process.env.BULLMQ_PREFIX = "marketplace-test";
process.env.JOB_DEFAULT_ATTEMPTS = "2";
process.env.JOB_BACKOFF_MS = "100";
process.env.JOB_DEFAULT_CONCURRENCY = "1";

process.env.JWT_ACCESS_SECRET = "test-only-access-secret-that-is-at-least-32-characters-long";
process.env.JWT_ISSUER = "marketplace-api-test";
process.env.JWT_AUDIENCE = "marketplace-web-test";
process.env.JWT_ACCESS_TTL_SECONDS = "900";
process.env.REFRESH_TOKEN_BYTES = "48";
process.env.REFRESH_TOKEN_TTL_SECONDS = "2592000";
process.env.ARGON2_MEMORY_COST = "19456";
process.env.ARGON2_TIME_COST = "2";
process.env.ARGON2_PARALLELISM = "1";

process.env.IDEMPOTENCY_LOCK_SECONDS = "30";
process.env.IDEMPOTENCY_RETENTION_SECONDS = "3600";
process.env.OUTBOX_BATCH_SIZE = "20";
process.env.OUTBOX_CLAIM_SECONDS = "30";
process.env.OUTBOX_BASE_RETRY_DELAY_MS = "100";
process.env.OUTBOX_MAX_RETRY_DELAY_MS = "5000";

process.env.STORAGE_BUCKET = "marketplace-test";
process.env.STORAGE_PROVIDER = "s3_compatible";
process.env.STORAGE_REGION = "auto";
process.env.STORAGE_SIGNED_URL_TTL_SECONDS = "300";
process.env.STORAGE_FORCE_PATH_STYLE = "true";
process.env.DOCUMENT_UPLOAD_POLICY_JSON = "{}";
process.env.INTERNAL_API_KEY =
  process.env.INTERNAL_API_KEY ??
  "module7-test-internal-api-key-that-is-at-least-32-characters";

// Module 12 uses deterministic test-only credentials; focused tests inject/mocks provider calls.
process.env.STRIPE_SECRET_KEY = "sk_test_module12_placeholder";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_module12_placeholder";
process.env.STRIPE_CURRENCY_EXPONENTS_JSON = JSON.stringify({ USD: 2, PKR: 2 });

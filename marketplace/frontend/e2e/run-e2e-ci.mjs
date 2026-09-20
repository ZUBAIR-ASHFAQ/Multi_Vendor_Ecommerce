import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, "..");
const backendDirectory = path.resolve(
  process.env.E2E_BACKEND_DIR ?? process.argv[2] ?? path.join(frontendDirectory, "..", "marketplace-backend"),
);
const composeFile = path.join(backendDirectory, "docker-compose.test.yml");

const databaseUrl = "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const redisUrl = "redis://127.0.0.1:56379";
const backendOrigin = "http://127.0.0.1:4000";
const frontendOrigin = "http://127.0.0.1:5173";
const storageOrigin = "http://127.0.0.1:59000";
const stripeOrigin = "http://127.0.0.1:4123";
const stripeWebhookSecret = "whsec_e2e_module12_provider_test_secret";
const fakeStripeServer = path.join(scriptDirectory, "support", "fake-stripe-server.mjs");
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";
const sellerPassword = process.env.E2E_SELLER_PASSWORD ?? "E2e-Seller-Password!123";
const internalApiKey = "e2e-ci-internal-api-key-that-is-at-least-32-characters";

const backendEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  SERVICE_NAME: "marketplace-backend-e2e-ci",
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
  HOST: "127.0.0.1",
  PORT: "4000",
  HTTP_TRUST_PROXY: "false",
  HTTP_BODY_LIMIT: "1mb",
  CORS_ORIGINS: `${frontendOrigin},http://localhost:5173`,
  RATE_LIMIT_WINDOW_MS: "60000",
  RATE_LIMIT_MAX: "10000",
  SWAGGER_ENABLED: "true",
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  DB_POOL_MAX: "6",
  DB_SSL: "false",
  DB_SSL_REJECT_UNAUTHORIZED: "true",
  DB_APPLICATION_NAME: "marketplace-backend-e2e-ci",
  REDIS_URL: redisUrl,
  TEST_REDIS_URL: redisUrl,
  BULLMQ_PREFIX: "marketplace-e2e-ci",
  JOB_DEFAULT_ATTEMPTS: "2",
  JOB_BACKOFF_MS: "100",
  JOB_DEFAULT_CONCURRENCY: "1",
  JWT_ACCESS_SECRET: "e2e-ci-access-secret-that-is-at-least-32-characters-long",
  INTERNAL_API_KEY: internalApiKey,
  JWT_ISSUER: "marketplace-api-e2e-ci",
  JWT_AUDIENCE: "marketplace-web-e2e-ci",
  JWT_ACCESS_TTL_SECONDS: "900",
  REFRESH_TOKEN_BYTES: "48",
  REFRESH_TOKEN_TTL_SECONDS: "2592000",
  ARGON2_MEMORY_COST: "19456",
  ARGON2_TIME_COST: "2",
  ARGON2_PARALLELISM: "1",
  IDEMPOTENCY_LOCK_SECONDS: "30",
  IDEMPOTENCY_RETENTION_SECONDS: "3600",
  OUTBOX_BATCH_SIZE: "20",
  OUTBOX_CLAIM_SECONDS: "30",
  OUTBOX_BASE_RETRY_DELAY_MS: "100",
  OUTBOX_MAX_RETRY_DELAY_MS: "5000",
  STORAGE_PROVIDER: "s3_compatible",
  STORAGE_BUCKET: "marketplace-e2e-ci",
  STORAGE_REGION: "us-east-1",
  STORAGE_ENDPOINT: storageOrigin,
  STORAGE_ACCESS_KEY_ID: "marketplace-e2e",
  STORAGE_SECRET_ACCESS_KEY: "marketplace-e2e-secret",
  STORAGE_FORCE_PATH_STYLE: "true",
  STORAGE_SIGNED_URL_TTL_SECONDS: "300",
  DOCUMENT_UPLOAD_POLICY_JSON: JSON.stringify({
    operational_evidence: { allowedMimeTypes: ["application/pdf"], maxSizeBytes: 1_048_576 },
    seller_verification: { allowedMimeTypes: ["application/pdf"], maxSizeBytes: 1_048_576 },
    store_asset: { allowedMimeTypes: ["image/png"], maxSizeBytes: 1_048_576 },
    product_media: {
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      maxSizeBytes: 2_097_152,
    },
  }),
  PRODUCT_MODERATION_REQUIRED: "false",
  CHECKOUT_QUOTE_TTL_SECONDS: "900",
  CHECKOUT_ATTEMPT_TTL_SECONDS: "900",
  STRIPE_SECRET_KEY: "sk_test_e2e_provider_key",
  STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
  STRIPE_CURRENCY_EXPONENTS_JSON: JSON.stringify({ USD: 2 }),
  STRIPE_API_BASE_URL: stripeOrigin,
  PAYOUT_PROVIDER_MODE: "deterministic_test",
  PAYOUT_PROVIDER_TYPE: "e2e",
  NOTIFICATION_EMAIL_PROVIDER_MODE: "deterministic_test",
  NOTIFICATION_EMAIL_FROM: "notifications@example.test",
  WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS: "2",
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  E2E_ADMIN_DISPLAY_NAME: "E2E Platform Admin",
  E2E_SELLER_PASSWORD: sellerPassword,
  E2E_SELLER_A_EMAIL: "e2e.seller.a@marketplace.test",
  E2E_SELLER_B_EMAIL: "e2e.seller.b@marketplace.test",
  E2E_FRONTEND_ORIGIN: frontendOrigin,
};

const backendRegressionEnvironment = { ...backendEnvironment };
delete backendRegressionEnvironment.STRIPE_API_BASE_URL;
backendRegressionEnvironment.PAYOUT_PROVIDER_MODE = "unconfigured";
delete backendRegressionEnvironment.PAYOUT_PROVIDER_TYPE;
backendRegressionEnvironment.WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS = "0";

const frontendEnvironment = {
  ...process.env,
  VITE_API_BASE_URL: `${backendOrigin}/api/v1`,
  VITE_APP_NAME: "Marketplace",
  VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_e2e_publishable_key",
  E2E_API_ORIGIN: backendOrigin,
  E2E_FRONTEND_ORIGIN: frontendOrigin,
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  E2E_SELLER_PASSWORD: sellerPassword,
  E2E_SELLER_A_EMAIL: "e2e.seller.a@marketplace.test",
  E2E_SELLER_B_EMAIL: "e2e.seller.b@marketplace.test",
  E2E_INTERNAL_API_KEY: internalApiKey,
  E2E_STRIPE_API_ORIGIN: stripeOrigin,
  E2E_STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
};

/** Returns the platform-specific executable name for npm commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Prints one readable CI stage heading. */
function logStage(name) {
  console.log(`\n=== ${name} ===`);
}

/** Runs one command and fails the release gate when the command exits unsuccessfully. */
async function run(command, args, { cwd = frontendDirectory, env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Starts one long-running application process owned by this E2E gate. */
function spawnLongRunning(command, args, { cwd, env }) {
  return spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
}

/** Stops one application process and gives it a short graceful-shutdown window. */
async function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;

  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Waits until an HTTP endpoint returns the expected status code. */
async function waitForHttp(url, expectedStatus = 200, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.status === expectedStatus) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Fails early when the checked-out frontend/backend pair cannot run the complete browser gate. */
function verifyPrerequisites() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < 22) {
    throw new Error(`Node.js 22+ is required; current version is ${process.versions.node}.`);
  }

  const requiredPaths = [
    path.join(frontendDirectory, "package.json"),
    path.join(frontendDirectory, "node_modules"),
    path.join(backendDirectory, "package.json"),
    path.join(backendDirectory, "node_modules"),
    composeFile,
    fakeStripeServer,
  ];
  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`E2E prerequisite is missing: ${requiredPath}`);
    }
  }

  if (spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker is required for the E2E release gate.");
  }
  if (spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker Compose v2 is required for the E2E release gate.");
  }
}

/** Recreates the disposable database and applies the full current migration chain. */
async function resetAndMigrateDatabase() {
  await run("node", ["scripts/reset-test-database.mjs"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:migrations"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
}

/** Seeds only deterministic browser prerequisites through approved seed commands. */
async function prepareBrowserFixtures() {
  await resetAndMigrateDatabase();
  await run(executable("npm"), ["run", "db:seed:module21-e2e"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "db:seed:module10-e2e"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "db:seed:module18-e2e"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "db:seed:module20"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "db:check"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
}

/** Confirms the live backend exposes the documented OpenAPI document before browser tests start. */
async function verifyLiveOpenApi() {
  const response = await fetch(`${backendOrigin}/openapi.json`);
  if (!response.ok) {
    throw new Error(`OpenAPI endpoint returned ${response.status}.`);
  }

  const document = await response.json();
  for (const route of [
    "/api/v1/auth/login",
    "/api/v1/documents/uploads/sign",
    "/api/v1/customers/me",
    "/api/v1/sellers/applications",
    "/api/v1/catalog/categories",
    "/api/v1/seller/products",
    "/api/v1/seller/inventory",
    "/api/v1/search/products",
    "/api/v1/cart",
    "/api/v1/wishlist",
    "/api/v1/admin/promotions",
    "/api/v1/admin/promotions/{id}",
    "/api/v1/seller/promotions",
    "/api/v1/promotions/validate",
    "/api/v1/admin/promotions/{id}/activate",
    "/api/v1/admin/promotions/{id}/deactivate",
    "/api/v1/checkout/shipping-options",
    "/api/v1/seller/shipments",
    "/api/v1/seller/orders/{sellerOrderId}/shipments",
    "/api/v1/seller/shipments/{id}/tracking",
    "/api/v1/seller/shipments/{id}/mark-shipped",
    "/api/v1/seller/shipments/{id}/mark-delivered",
    "/api/v1/orders/{orderId}/shipments",
    "/api/v1/checkout/quote",
    "/api/v1/checkout/quote/{id}",
    "/api/v1/checkout/quote/{id}/confirm",
    "/api/v1/checkout/{attemptId}/status",
    "/api/v1/orders",
    "/api/v1/orders/{id}",
    "/api/v1/orders/{id}/cancel",
    "/api/v1/seller/orders",
    "/api/v1/seller/orders/{id}",
    "/api/v1/seller/orders/{id}/accept",
    "/api/v1/admin/orders",
    "/api/v1/admin/orders/{id}/cancel",
    "/api/v1/internal/orders/{id}/payment-confirmed",
    "/api/v1/payments/order/{orderId}/intent",
    "/api/v1/payments/order/{orderId}",
    "/api/v1/payments/webhooks/stripe",
    "/api/v1/admin/payments",
    "/api/v1/admin/payments/{id}",
    "/api/v1/internal/payments/{id}/refund",
    "/api/v1/admin/commissions/rules",
    "/api/v1/admin/commissions/rules/{id}",
    "/api/v1/seller/commissions",
    "/api/v1/admin/commissions/entries",
    "/api/v1/internal/commissions/order-settle",
    "/api/v1/internal/commissions/refund-adjust",
    "/api/v1/orders/{orderId}/returns",
    "/api/v1/returns",
    "/api/v1/seller/returns",
    "/api/v1/seller/returns/{id}/approve",
    "/api/v1/seller/returns/{id}/reject",
    "/api/v1/seller/returns/{id}/receive",
    "/api/v1/returns/{id}/refund",
    "/api/v1/admin/returns",
    "/api/v1/seller/wallet",
    "/api/v1/seller/payouts",
    "/api/v1/seller/payout-accounts",
    "/api/v1/admin/payouts",
    "/api/v1/admin/payouts/{id}/approve",
    "/api/v1/admin/payouts/{id}/send",
    "/api/v1/internal/wallet/settle",
    "/api/v1/internal/wallet/adjust",
    "/api/v1/reviews",
    "/api/v1/reviews/{id}",
    "/api/v1/products/{productId}/reviews",
    "/api/v1/stores/{storeId}/reviews",
    "/api/v1/reviews/{id}/helpful",
    "/api/v1/admin/reviews",
    "/api/v1/admin/reviews/{id}/hide",
    "/api/v1/admin/reviews/{id}/publish",
    "/api/v1/notifications",
    "/api/v1/notifications/{id}/read",
    "/api/v1/notifications/read-all",
    "/api/v1/notifications/preferences",
    "/api/v1/admin/notification-deliveries",
    "/api/v1/admin/notification-deliveries/{id}/retry",
    "/api/v1/reports/catalog",
    "/api/v1/reports/sales",
    "/api/v1/reports/sellers",
    "/api/v1/reports/inventory",
    "/api/v1/reports/refunds",
    "/api/v1/reports/commissions",
    "/api/v1/reports/payouts",
    "/api/v1/reports/runs",
    "/api/v1/reports/runs/{id}",
    "/api/v1/dashboard/summary",
    "/api/v1/dashboard/orders",
    "/api/v1/dashboard/sellers",
    "/api/v1/dashboard/alerts",
    "/api/v1/dashboard/preferences",
  ]) {
    if (!document.paths?.[route]) {
      throw new Error(`Live OpenAPI is missing required route ${route}.`);
    }
  }
}

/** Runs every currently implemented critical Playwright workflow in deterministic serial order. */
async function runPlaywrightGate() {
  await run(
    executable("npm"),
    [
      "run",
      "test:e2e",
      "--",
      "e2e/foundation.spec.ts",
      "e2e/module2.spec.ts",
      "e2e/module21.spec.ts",
      "e2e/module3.spec.ts",
      "e2e/module4.spec.ts",
      "e2e/module5.spec.ts",
      "e2e/module6.spec.ts",
      "e2e/module7.spec.ts",
      "e2e/module19.spec.ts",
      "e2e/module8.spec.ts",
      "e2e/module9.spec.ts",
      "e2e/module10.spec.ts",
      "e2e/module11.spec.ts",
      "e2e/module12.spec.ts",
      "e2e/module16.spec.ts",
      "e2e/module13.spec.ts",
      "e2e/module14.spec.ts",
      "e2e/module17.spec.ts",
      "e2e/module15.spec.ts",
      "e2e/module18.spec.ts",
      "e2e/module20.spec.ts",
      "e2e/module1.spec.ts",
      "--workers=1",
    ],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );
}

/** Builds both independent Docker images after browser and data-integrity checks succeed. */
async function buildReleaseContainers() {
  await run("docker", ["build", "-t", "marketplace-backend-e2e-ci", "."], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(
    "docker",
    [
      "build",
      "--build-arg",
      `VITE_API_BASE_URL=${backendOrigin}/api/v1`,
      "--build-arg",
      "VITE_APP_NAME=Marketplace",
      "--build-arg",
      "VITE_STRIPE_PUBLISHABLE_KEY=pk_test_e2e_publishable_key",
      "-t",
      "marketplace-frontend-e2e-ci",
      ".",
    ],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );
}

let composeStarted = false;
let backendProcess;
let frontendProcess;
let stripeProcess;

try {
  logStage("E2E prerequisites");
  verifyPrerequisites();

  logStage("Run current backend regression gates through Module 18");
  await run(executable("npm"), ["run", "test:module12"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module16"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module13"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module14"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module17"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module15"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "test:module18"], {
    cwd: backendDirectory,
    env: backendRegressionEnvironment,
  });
  await run(executable("npm"), ["run", "verify"], {
    cwd: frontendDirectory,
    env: frontendEnvironment,
  });

  logStage("Start disposable PostgreSQL, Redis, and S3-compatible storage");
  await run("docker", ["compose", "--profile", "module21", "-f", composeFile, "up", "-d", "--wait"]);
  composeStarted = true;
  await run(executable("npm"), ["run", "storage:prepare:module21-e2e"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Verify Module 20 Reports/Analytics database migration");
  await run(executable("npm"), ["run", "test:module20:migrations"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Verify Module 20 Reports/Analytics boundary contracts");
  await run(executable("npm"), ["run", "test:module20:contracts"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Run Module 20 Reports/Analytics backend proof");
  await run(executable("npm"), ["run", "db:seed:module20"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module20:specs"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Verify Module 1 Dashboard database migration");
  await run(executable("npm"), ["run", "test:module1:migrations"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Verify Module 1 Dashboard boundary contracts");
  await run(executable("npm"), ["run", "test:module1:contracts"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Run Module 1 Dashboard backend proof");
  await resetAndMigrateDatabase();
  await run(executable("npm"), ["run", "db:seed:administration"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "db:seed:module20"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module1:specs"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Start local Stripe-compatible provider-test server");
  stripeProcess = spawnLongRunning("node", [fakeStripeServer], {
    cwd: frontendDirectory,
    env: { ...process.env, E2E_STRIPE_PORT: "4123" },
  });
  await waitForHttp(`${stripeOrigin}/health`);

  logStage("Build backend and frontend");
  await run(executable("npm"), ["run", "build"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "build"], {
    cwd: frontendDirectory,
    env: frontendEnvironment,
  });

  logStage("Prepare deterministic browser fixtures");
  await prepareBrowserFixtures();
  await run(executable("npm"), ["run", "storage:prepare:module21-e2e"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Start production-built backend and frontend preview");
  backendProcess = spawnLongRunning("node", ["dist/server.js"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await waitForHttp(`${backendOrigin}/health`);
  await waitForHttp(`${backendOrigin}/ready`);
  await verifyLiveOpenApi();

  frontendProcess = spawnLongRunning(
    executable("npm"),
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", "5173"],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );
  await waitForHttp(frontendOrigin);

  logStage("Run Playwright Foundation through Module 1 in dependency order");
  await runPlaywrightGate();

  logStage("Verify post-browser database integrity");
  await run(executable("npm"), ["run", "db:check"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module6:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module7:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module19:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module8:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module9:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module10:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module11:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module12:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module16:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module13:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module14:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module17:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module15:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module18:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module20:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module1:release-data"], {
    cwd: backendDirectory,
    env: backendEnvironment,
  });

  logStage("Build both independent release containers");
  await buildReleaseContainers();

  console.log("\nE2E release gate completed successfully.");
} finally {
  await Promise.allSettled([
    stopProcessTree(frontendProcess),
    stopProcessTree(backendProcess),
    stopProcessTree(stripeProcess),
  ]);
  if (composeStarted) {
    try {
      await run("docker", ["compose", "--profile", "module21", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop disposable E2E infrastructure cleanly:", error);
    }
  }
}

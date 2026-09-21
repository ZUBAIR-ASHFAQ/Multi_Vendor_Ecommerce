import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const backendDirectory = path.join(rootDirectory, "backend");
const frontendDirectory = path.join(rootDirectory, "frontend");
const composeFile = path.join(backendDirectory, "docker-compose.test.yml");

const databaseUrl = "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const redisUrl = "redis://127.0.0.1:56379";
const backendOrigin = "http://127.0.0.1:4000";
const frontendOrigin = "http://127.0.0.1:5173";
const storageOrigin = "http://127.0.0.1:59000";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "e2e.admin@marketplace.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Admin-Password!123";
const sellerPassword = process.env.E2E_SELLER_PASSWORD ?? "E2e-Seller-Password!123";

const sharedBackendEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  SERVICE_NAME: "marketplace-backend-module8-e2e",
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
  DB_APPLICATION_NAME: "marketplace-backend-module8-e2e",
  REDIS_URL: redisUrl,
  TEST_REDIS_URL: redisUrl,
  BULLMQ_PREFIX: "marketplace-module8-e2e",
  JOB_DEFAULT_ATTEMPTS: "2",
  JOB_BACKOFF_MS: "100",
  JOB_DEFAULT_CONCURRENCY: "1",
  JWT_ACCESS_SECRET: "module8-e2e-access-secret-that-is-at-least-32-characters-long",
  INTERNAL_API_KEY: "module8-e2e-internal-api-key-that-is-at-least-32-characters",
  JWT_ISSUER: "marketplace-api-module8-e2e",
  JWT_AUDIENCE: "marketplace-web-module8-e2e",
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
  STORAGE_BUCKET: "marketplace-module8-e2e",
  STORAGE_REGION: "us-east-1",
  STORAGE_ENDPOINT: storageOrigin,
  STORAGE_ACCESS_KEY_ID: "marketplace-e2e",
  STORAGE_SECRET_ACCESS_KEY: "marketplace-e2e-secret",
  STORAGE_FORCE_PATH_STYLE: "true",
  STORAGE_SIGNED_URL_TTL_SECONDS: "300",
  DOCUMENT_UPLOAD_POLICY_JSON: JSON.stringify({
    operational_evidence: { allowedMimeTypes: ["application/pdf"], maxSizeBytes: 1048576 },
    seller_verification: { allowedMimeTypes: ["application/pdf"], maxSizeBytes: 1048576 },
    store_asset: { allowedMimeTypes: ["image/png"], maxSizeBytes: 1048576 },
    product_media: { allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"], maxSizeBytes: 2097152 },
  }),
  PRODUCT_MODERATION_REQUIRED: "false",
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  E2E_ADMIN_DISPLAY_NAME: "E2E Platform Admin",
  E2E_SELLER_PASSWORD: sellerPassword,
  E2E_SELLER_A_EMAIL: "e2e.seller.a@marketplace.test",
  E2E_SELLER_B_EMAIL: "e2e.seller.b@marketplace.test",
  E2E_FRONTEND_ORIGIN: frontendOrigin,
};

const backendServerEnvironment = { ...sharedBackendEnvironment, NODE_ENV: "development" };
const frontendEnvironment = {
  ...process.env,
  VITE_API_BASE_URL: `${backendOrigin}/api/v1`,
  VITE_APP_NAME: "Marketplace",
  E2E_API_ORIGIN: backendOrigin,
  E2E_FRONTEND_ORIGIN: frontendOrigin,
  E2E_ADMIN_EMAIL: adminEmail,
  E2E_ADMIN_PASSWORD: adminPassword,
  E2E_SELLER_PASSWORD: sellerPassword,
  E2E_SELLER_A_EMAIL: "e2e.seller.a@marketplace.test",
  E2E_SELLER_B_EMAIL: "e2e.seller.b@marketplace.test",
};

/** Returns the platform-specific executable name for npm-like commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Runs one child command and rejects when it exits unsuccessfully. */
async function run(command, args, { cwd = rootDirectory, env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Starts one long-running application process owned by this release verifier. */
function spawnLongRunning(command, args, { cwd, env }) {
  return spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
}

/** Stops one spawned application process with a short graceful-shutdown window. */
async function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
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

/** Waits until one HTTP endpoint returns the expected status. */
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

/** Prints one visible release-stage heading. */
function logStage(name) {
  console.log(`\n=== ${name} ===`);
}

/** Fails early when the local machine cannot execute the complete release gate. */
function requireLocalReleasePrerequisites() {
  const majorNodeVersion = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (majorNodeVersion < 22) {
    throw new Error(`Node.js 22+ is required; current version is ${process.versions.node}.`);
  }

  for (const directory of [backendDirectory, frontendDirectory]) {
    if (!existsSync(path.join(directory, "node_modules"))) {
      throw new Error(
        `Dependencies are not installed in ${path.basename(directory)}. ` +
          "Run npm install independently in both projects first.",
      );
    }
    if (!existsSync(path.join(directory, "package-lock.json"))) {
      throw new Error(
        `${path.basename(directory)} is missing package-lock.json. ` +
          "Generate it from that independent project before release verification.",
      );
    }
  }

  const dockerVersion = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (dockerVersion.status !== 0) {
    throw new Error("Docker is required for PostgreSQL, Redis, storage, and container-build regression.");
  }

  const composeVersion = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (composeVersion.status !== 0) {
    throw new Error("Docker Compose v2 is required for the disposable release infrastructure.");
  }
}

/** Rebuilds the disposable test database and applies the complete migration chain. */
async function resetAndMigrate() {
  await run("node", ["scripts/reset-test-database.mjs"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
}

/** Prepares the RBAC catalog before one backend regression suite. */
async function prepareBackendRegressionDatabase() {
  await resetAndMigrate();
  await run(executable("npm"), ["run", "db:seed:administration"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "db:check"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
}

/** Creates deterministic browser prerequisites without manually editing data during Playwright. */
async function prepareE2eDatabase() {
  await resetAndMigrate();
  await run(executable("npm"), ["run", "db:seed:module21-e2e"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "db:check"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
}

/** Returns the HTTP methods exposed by one OpenAPI path item. */
function openApiMethods(pathItem) {
  const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  return Object.keys(pathItem ?? {}).filter((method) => httpMethods.has(method)).sort();
}

/** Verifies one path exposes exactly the expected methods and optional operation IDs. */
function verifyOpenApiPath(document, route, expected) {
  const pathItem = document.paths?.[route];
  if (!pathItem) throw new Error(`OpenAPI is missing ${route}.`);

  const expectedMethods = Object.keys(expected).sort();
  const actualMethods = openApiMethods(pathItem);
  if (
    actualMethods.length !== expectedMethods.length ||
    actualMethods.some((method, index) => method !== expectedMethods[index])
  ) {
    throw new Error(
      `OpenAPI method mismatch for ${route}. Expected ${expectedMethods.join(", ")}; ` +
        `received ${actualMethods.join(", ")}.`,
    );
  }

  for (const [method, operationId] of Object.entries(expected)) {
    if (!operationId) continue;
    const actualOperationId = pathItem?.[method]?.operationId;
    if (actualOperationId !== operationId) {
      throw new Error(
        `OpenAPI operationId mismatch for ${method.toUpperCase()} ${route}: ${actualOperationId ?? "missing"}.`,
      );
    }
  }
}

/** Verifies exact live OpenAPI surfaces for the currently implemented business modules. */
async function verifyLiveImplementedOpenApi() {
  const response = await fetch(`${backendOrigin}/openapi.json`);
  if (!response.ok) throw new Error(`OpenAPI endpoint returned ${response.status}.`);
  const document = await response.json();

  const module2Paths = new Map([
    ["/api/v1/auth/register", { post: null }],
    ["/api/v1/auth/login", { post: null }],
    ["/api/v1/auth/refresh", { post: null }],
    ["/api/v1/auth/logout", { post: null }],
    ["/api/v1/auth/me", { get: null }],
    ["/api/v1/admin/users", { get: null }],
    ["/api/v1/admin/users/{id}/status", { patch: null }],
    ["/api/v1/admin/users/{id}/roles", { put: null }],
    ["/api/v1/admin/roles", { get: null, post: null }],
    ["/api/v1/admin/roles/{id}/permissions", { put: null }],
    ["/api/v1/admin/settings", { get: null, patch: null }],
  ]);

  const module21Paths = new Map([
    ["/api/v1/documents/uploads/sign", { post: "signDocumentUpload" }],
    ["/api/v1/documents/uploads/{id}/confirm", { post: "confirmDocumentUpload" }],
    ["/api/v1/documents/{id}/link", { post: "linkDocumentFile" }],
    ["/api/v1/documents/{id}/download", { get: "createDocumentDownload" }],
    ["/api/v1/documents/{id}/link/{linkId}", { delete: "unlinkDocumentFile" }],
    ["/api/v1/audit", { get: "listAuditLogs" }],
    ["/api/v1/audit/{id}", { get: "getAuditLog" }],
  ]);

  const module3Paths = new Map([
    ["/api/v1/customers/me", { get: "getCurrentCustomerProfile", patch: "updateCurrentCustomerProfile" }],
    ["/api/v1/customers/me/addresses", { get: "listCurrentCustomerAddresses", post: "createCurrentCustomerAddress" }],
    [
      "/api/v1/customers/me/addresses/{id}",
      { patch: "updateCurrentCustomerAddress", delete: "archiveCurrentCustomerAddress" },
    ],
    ["/api/v1/admin/customers", { get: "listCustomersForAdmin" }],
    ["/api/v1/admin/customers/{id}", { get: "getCustomerForAdmin" }],
  ]);

  const module4Paths = new Map([
    ["/api/v1/sellers/applications", { post: "submitSellerApplication" }],
    ["/api/v1/admin/seller-applications", { get: "listSellerApplications" }],
    ["/api/v1/admin/seller-applications/{id}/approve", { post: "approveSellerApplication" }],
    ["/api/v1/admin/seller-applications/{id}/reject", { post: "rejectSellerApplication" }],
    ["/api/v1/sellers/me", { get: "getMySeller", patch: "updateMySeller" }],
    ["/api/v1/sellers/me/stores", { post: "createSellerStore" }],
    ["/api/v1/stores/{slug}", { get: "getPublicStore" }],
    ["/api/v1/sellers/me/stores/{id}", { patch: "updateSellerStore" }],
    ["/api/v1/admin/sellers/{id}/suspend", { post: "suspendSeller" }],
  ]);

  const module5Paths = new Map([
    ["/api/v1/catalog/categories", { get: null }],
    ["/api/v1/catalog/categories/{id}/attributes", { get: null }],
    ["/api/v1/admin/catalog/categories", { post: null }],
    ["/api/v1/admin/catalog/categories/{id}", { patch: null }],
    ["/api/v1/catalog/brands", { get: null }],
    ["/api/v1/admin/catalog/brands", { post: null }],
    ["/api/v1/catalog/attributes", { get: null }],
    ["/api/v1/admin/catalog/attributes", { post: null }],
    ["/api/v1/admin/catalog/categories/{id}/attributes", { put: null }],
  ]);

  const module6Paths = new Map([
    ["/api/v1/products", { get: null }],
    ["/api/v1/products/{slug}", { get: null }],
    ["/api/v1/seller/products", { get: null, post: null }],
    ["/api/v1/seller/products/{id}", { get: null, patch: null }],
    ["/api/v1/seller/products/{id}/variants", { post: null }],
    ["/api/v1/seller/products/{id}/variants/{variantId}", { patch: null }],
    ["/api/v1/seller/products/{id}/media", { post: null }],
    ["/api/v1/seller/products/{id}/publish", { post: null }],
    ["/api/v1/seller/products/{id}/unpublish", { post: null }],
    ["/api/v1/admin/products", { get: null }],
    ["/api/v1/admin/products/{id}", { get: null }],
    ["/api/v1/admin/products/{id}/approve", { post: null }],
    ["/api/v1/admin/products/{id}/reject", { post: null }],
  ]);

  const module7Paths = new Map([
    ["/api/v1/seller/inventory", { get: null }],
    ["/api/v1/seller/inventory/{variantId}/movements", { get: null }],
    ["/api/v1/seller/inventory/{variantId}/adjust", { post: null }],
    ["/api/v1/seller/inventory/{variantId}/reorder-level", { patch: null }],
    ["/api/v1/internal/inventory/reserve", { post: null }],
    ["/api/v1/internal/inventory/release", { post: null }],
    ["/api/v1/internal/inventory/ship", { post: null }],
  ]);

  const module19Paths = new Map([
    ["/api/v1/search/products", { get: null }],
    ["/api/v1/search/suggestions", { get: null }],
    ["/api/v1/search/stores", { get: null }],
    ["/api/v1/admin/search/reindex", { post: null }],
    ["/api/v1/admin/search/reindex/{id}", { get: null }],
  ]);

  const module8Paths = new Map([
    ["/api/v1/cart", { get: null, delete: null }],
    ["/api/v1/cart/items", { post: null }],
    ["/api/v1/cart/items/{id}", { patch: null, delete: null }],
    ["/api/v1/wishlist", { get: null }],
    ["/api/v1/wishlist/items", { post: null }],
    ["/api/v1/wishlist/items/{id}", { delete: null }],
  ]);

  for (const [route, methods] of [
    ...module2Paths,
    ...module21Paths,
    ...module3Paths,
    ...module4Paths,
    ...module5Paths,
    ...module6Paths,
    ...module7Paths,
    ...module19Paths,
    ...module8Paths,
  ]) {
    verifyOpenApiPath(document, route, methods);
  }

  const allPaths = Object.keys(document.paths ?? {});
  const actualAuthPaths = allPaths.filter((route) => route.startsWith("/api/v1/auth/"));
  const expectedAuthPaths = [...module2Paths.keys()].filter((route) =>
    route.startsWith("/api/v1/auth/"),
  );
  if (
    actualAuthPaths.length !== expectedAuthPaths.length ||
    actualAuthPaths.some((route) => !expectedAuthPaths.includes(route))
  ) {
    throw new Error(
      `Live OpenAPI Auth paths do not match the approved Module 2 surface: ${actualAuthPaths.join(", ")}`,
    );
  }

  const expectedModule2AdminPaths = [...module2Paths.keys()].filter(
    (route) =>
      route.startsWith("/api/v1/admin/users") ||
      route.startsWith("/api/v1/admin/roles") ||
      route === "/api/v1/admin/settings",
  );
  const actualModule2AdminPaths = allPaths.filter(
    (route) =>
      route.startsWith("/api/v1/admin/users") ||
      route.startsWith("/api/v1/admin/roles") ||
      route === "/api/v1/admin/settings",
  );
  if (
    actualModule2AdminPaths.length !== expectedModule2AdminPaths.length ||
    actualModule2AdminPaths.some((route) => !expectedModule2AdminPaths.includes(route))
  ) {
    throw new Error(
      "Live OpenAPI Administration paths do not match the approved Module 2 surface: " +
        actualModule2AdminPaths.join(", "),
    );
  }

  const actualModule21Paths = allPaths.filter(
    (route) => route.startsWith("/api/v1/documents") || route.startsWith("/api/v1/audit"),
  );
  if (
    actualModule21Paths.length !== module21Paths.size ||
    actualModule21Paths.some((route) => !module21Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 21 paths do not match the approved surface: ${actualModule21Paths.join(", ")}`,
    );
  }

  const actualModule3Paths = allPaths.filter(
    (route) => route.startsWith("/api/v1/customers") || route.startsWith("/api/v1/admin/customers"),
  );
  if (
    actualModule3Paths.length !== module3Paths.size ||
    actualModule3Paths.some((route) => !module3Paths.has(route))
  ) {
    throw new Error(`Live OpenAPI Module 3 paths do not match the approved surface: ${actualModule3Paths.join(", ")}`);
  }

  const actualModule4Paths = allPaths.filter(
    (route) =>
      route.startsWith("/api/v1/sellers") ||
      route.startsWith("/api/v1/stores") ||
      route.startsWith("/api/v1/admin/seller"),
  );
  if (
    actualModule4Paths.length !== module4Paths.size ||
    actualModule4Paths.some((route) => !module4Paths.has(route))
  ) {
    throw new Error(`Live OpenAPI Module 4 paths do not match the approved surface: ${actualModule4Paths.join(", ")}`);
  }

  const actualModule5Paths = allPaths.filter(
    (route) =>
      route.startsWith("/api/v1/catalog/") ||
      route.startsWith("/api/v1/admin/catalog/"),
  );
  if (
    actualModule5Paths.length !== module5Paths.size ||
    actualModule5Paths.some((route) => !module5Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 5 paths do not match the approved surface: ${actualModule5Paths.join(", ")}`,
    );
  }

  const actualModule6Paths = allPaths.filter(
    (route) =>
      route.startsWith("/api/v1/products") ||
      route.startsWith("/api/v1/seller/products") ||
      route.startsWith("/api/v1/admin/products"),
  );
  if (
    actualModule6Paths.length !== module6Paths.size ||
    actualModule6Paths.some((route) => !module6Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 6 paths do not match the approved surface: ${actualModule6Paths.join(", ")}`,
    );
  }

  const actualModule7Paths = allPaths.filter(
    (route) =>
      route.startsWith("/api/v1/seller/inventory") ||
      route.startsWith("/api/v1/internal/inventory"),
  );
  if (
    actualModule7Paths.length !== module7Paths.size ||
    actualModule7Paths.some((route) => !module7Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 7 paths do not match the approved surface: ${actualModule7Paths.join(", ")}`,
    );
  }

  const actualModule19Paths = allPaths.filter(
    (route) => route.startsWith("/api/v1/search/") || route.startsWith("/api/v1/admin/search/"),
  );
  if (
    actualModule19Paths.length !== module19Paths.size ||
    actualModule19Paths.some((route) => !module19Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 19 paths do not match the approved surface: ${actualModule19Paths.join(", ")}`,
    );
  }


  const actualModule8Paths = allPaths.filter(
    (route) => route.startsWith("/api/v1/cart") || route.startsWith("/api/v1/wishlist"),
  );
  if (
    actualModule8Paths.length !== module8Paths.size ||
    actualModule8Paths.some((route) => !module8Paths.has(route))
  ) {
    throw new Error(
      `Live OpenAPI Module 8 paths do not match the approved surface: ${actualModule8Paths.join(", ")}`,
    );
  }

  for (const removedPath of [
    "/api/v1/auth/logout-all",
    "/api/v1/auth/change-password",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/admin/permissions",
  ]) {
    if (document.paths?.[removedPath]) throw new Error(`Live OpenAPI still exposes removed path ${removedPath}.`);
  }
}

let composeStarted = false;
let backendProcess;
let frontendProcess;

try {
  logStage("Dependency-free Foundation modules through Module 8 structure");
  await run("node", ["scripts/verify-module2-static.mjs"]);
  await run("node", ["scripts/verify-module21-static.mjs"]);
  await run("node", ["scripts/verify-module3-static.mjs"]);
  await run("node", ["scripts/verify-module4-static.mjs"]);
  await run("node", ["scripts/verify-module5-static.mjs"]);
  await run("node", ["scripts/verify-module6-static.mjs"]);
  await run("node", ["scripts/verify-module7-static.mjs"]);
  await run("node", ["scripts/verify-module19-static.mjs"]);
  await run("node", ["scripts/verify-module8-static.mjs"]);

  logStage("Dependency-free cross-layer contract guards");
  await run("node", ["scripts/verify-http-contracts.mjs"]);
  await run("node", ["scripts/verify-backend-test-contracts.mjs"]);
  await run("node", ["scripts/verify-frontend-feature-contracts.mjs"]);

  logStage("Local release prerequisites");
  requireLocalReleasePrerequisites();

  logStage("Start isolated PostgreSQL, Redis and S3-compatible storage");
  await run("docker", ["compose", "--profile", "module21", "-f", composeFile, "up", "-d", "--wait"]);
  composeStarted = true;
  await run(executable("npm"), ["run", "storage:prepare:module21-e2e"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Backend lint, typecheck and migration gates");
  await run(executable("npm"), ["run", "lint"], { cwd: backendDirectory, env: sharedBackendEnvironment });
  await run(executable("npm"), ["run", "typecheck"], { cwd: backendDirectory, env: sharedBackendEnvironment });
  await run(executable("npm"), ["run", "test:module2:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module21:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module3:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module4:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module5:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module6:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module7:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module19:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module8:migrations"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Foundation backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:foundation:specs"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Module 2 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module2:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 21 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module21:specs"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Module 3 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module3:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 4 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module4:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 5 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module5:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 6 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module6:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 7 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module7:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 19 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module19:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Module 8 backend regression");
  await prepareBackendRegressionDatabase();
  await run(executable("npm"), ["run", "test:module8:specs"], { cwd: backendDirectory, env: sharedBackendEnvironment });
  await run(executable("npm"), ["run", "test:regression:contracts"], { cwd: backendDirectory, env: sharedBackendEnvironment });
  await run(executable("npm"), ["run", "build"], { cwd: backendDirectory, env: sharedBackendEnvironment });

  logStage("Frontend lint, typecheck, tests and production build");
  await run(executable("npm"), ["run", "lint"], { cwd: frontendDirectory, env: frontendEnvironment });
  await run(executable("npm"), ["run", "typecheck"], { cwd: frontendDirectory, env: frontendEnvironment });
  await run(executable("npm"), ["run", "test:run"], { cwd: frontendDirectory, env: frontendEnvironment });
  await run(executable("npm"), ["run", "test:module8"], { cwd: frontendDirectory, env: frontendEnvironment });
  await run(executable("npm"), ["run", "build"], { cwd: frontendDirectory, env: frontendEnvironment });

  logStage("Prepare deterministic browser prerequisites");
  await prepareE2eDatabase();
  await run(executable("npm"), ["run", "storage:prepare:module21-e2e"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Start production-built backend and frontend preview");
  backendProcess = spawnLongRunning("node", ["dist/server.js"], {
    cwd: backendDirectory,
    env: backendServerEnvironment,
  });
  await waitForHttp(`${backendOrigin}/health`);
  await waitForHttp(`${backendOrigin}/ready`);
  await verifyLiveImplementedOpenApi();

  frontendProcess = spawnLongRunning(
    "node",
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "5173"],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );
  await waitForHttp(frontendOrigin);

  logStage("Playwright Foundation through Module 8 Cart & Wishlist workflows");
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
      "--workers=1",
    ],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );

  logStage("Post-E2E database, Product, Inventory, Search, Cart, and Wishlist integrity");
  await run(executable("npm"), ["run", "db:check"], { cwd: backendDirectory, env: sharedBackendEnvironment });
  await run(executable("npm"), ["run", "test:module6:release-data"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module7:release-data"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module19:release-data"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(executable("npm"), ["run", "test:module8:release-data"], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });

  logStage("Container build regression");
  await run("docker", ["build", "-t", "marketplace-backend-module8-release", "."], {
    cwd: backendDirectory,
    env: sharedBackendEnvironment,
  });
  await run(
    "docker",
    [
      "build",
      "--build-arg",
      `VITE_API_BASE_URL=${backendOrigin}/api/v1`,
      "--build-arg",
      "VITE_APP_NAME=Marketplace",
      "-t",
      "marketplace-frontend-module8-release",
      ".",
    ],
    { cwd: frontendDirectory, env: frontendEnvironment },
  );

  console.log("\nModule 8 full release verification completed successfully.");
} finally {
  await Promise.allSettled([stopProcessTree(frontendProcess), stopProcessTree(backendProcess)]);
  if (composeStarted) {
    try {
      await run("docker", ["compose", "--profile", "module21", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop Module 8 test infrastructure cleanly:", error);
    }
  }
}

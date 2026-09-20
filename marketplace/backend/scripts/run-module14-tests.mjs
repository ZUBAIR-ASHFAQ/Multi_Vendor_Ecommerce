import { spawn } from "node:child_process";

const composeFile = "docker-compose.test.yml";
const testDatabaseUrl =
  "postgresql://marketplace_test:marketplace_test@127.0.0.1:55432/marketplace_test";
const testRedisUrl = "redis://127.0.0.1:56379";
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  TEST_DATABASE_URL: testDatabaseUrl,
  DATABASE_URL: testDatabaseUrl,
  TEST_REDIS_URL: testRedisUrl,
  REDIS_URL: testRedisUrl,
  JWT_ACCESS_SECRET: "test-only-access-secret-that-is-at-least-32-characters-long",
  INTERNAL_API_KEY: "module14-test-internal-api-key-that-is-at-least-32-characters",
  STORAGE_BUCKET: "marketplace-test",
  PRODUCT_MODERATION_REQUIRED: "false",
  CHECKOUT_QUOTE_TTL_SECONDS: "900",
  CHECKOUT_ATTEMPT_TTL_SECONDS: "900",
  STRIPE_SECRET_KEY: "sk_test_module14_backend_proof_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_module14_backend_proof_placeholder",
  STRIPE_CURRENCY_EXPONENTS_JSON: JSON.stringify({ PKR: 2, USD: 2 }),
  DOCUMENT_UPLOAD_POLICY_JSON: JSON.stringify({
    product_media: {
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
      maxSizeBytes: 20 * 1024 * 1024,
    },
  }),
};

/** Returns the platform-specific executable name used for npm on Windows. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Runs one child process with the isolated Module 14 backend verification environment. */
async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: testEnvironment,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`),
        );
      }
    });
  });
}

/** Recreates a deterministic database containing every committed migration and current platform RBAC. */
async function prepareDatabase() {
  await run("node", ["scripts/reset-test-database.mjs"]);
  await run(executable("npm"), ["run", "test:migrations"]);
  await run(executable("npm"), ["run", "db:seed:administration"]);
  await run(executable("npm"), ["run", "db:check"]);
}

let started = false;
try {
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  started = true;

  await run(executable("npm"), ["run", "test:module14:migrations"]);
  await prepareDatabase();
  await run(executable("npm"), ["run", "test:module14:specs"]);
  await run(executable("npm"), ["run", "test:regression:contracts"]);

  // Re-run every released prerequisite backend suite against the Module 14 schema and service boundaries.
  for (const script of [
    "test:foundation:specs",
    "test:module2:specs",
    "test:module21:specs",
    "test:module3:specs",
    "test:module4:specs",
    "test:module5:specs",
    "test:module6:specs",
    "test:module7:specs",
    "test:module19:specs",
    "test:module8:specs",
    "test:module9:specs",
    "test:module10:specs",
    "test:module11:specs",
    "test:module12:specs",
    "test:module13:specs",
    "test:module16:specs",
  ]) {
    await run(executable("npm"), ["run", script]);
  }

  await run(executable("npm"), ["run", "typecheck"]);
  await run(executable("npm"), ["run", "lint"]);
  await run(executable("npm"), ["run", "build"]);

  console.log("Module 14 Returns, Refunds & Disputes backend verification completed successfully.");
} finally {
  if (started) {
    try {
      await run("docker", ["compose", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop the Module 14 test infrastructure cleanly:", error);
    }
  }
}

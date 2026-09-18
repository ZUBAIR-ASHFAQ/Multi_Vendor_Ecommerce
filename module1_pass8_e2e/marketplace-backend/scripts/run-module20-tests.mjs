import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  INTERNAL_API_KEY: "module20-test-internal-api-key-that-is-at-least-32-characters",
  STORAGE_BUCKET: "marketplace-test",
  PRODUCT_MODERATION_REQUIRED: "false",
  REVIEW_MODERATION_REQUIRED: "false",
  CHECKOUT_QUOTE_TTL_SECONDS: "900",
  CHECKOUT_ATTEMPT_TTL_SECONDS: "900",
  STRIPE_SECRET_KEY: "sk_test_module20_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_module20_placeholder",
  STRIPE_CURRENCY_EXPONENTS_JSON: JSON.stringify({ PKR: 2, USD: 2 }),
  NOTIFICATION_EMAIL_PROVIDER_MODE: "deterministic_test",
  NOTIFICATION_EMAIL_FROM: "notifications@example.test",
  DOCUMENT_UPLOAD_POLICY_JSON: JSON.stringify({
    product_media: {
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4"],
      maxSizeBytes: 20 * 1024 * 1024,
    },
    report_export: {
      allowedMimeTypes: ["text/csv", "application/pdf"],
      maxSizeBytes: 25 * 1024 * 1024,
    },
  }),
};

/** Returns the platform-specific executable name used for npm on Windows. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Returns true when a command can be started successfully on this machine. */
function commandExists(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

/** Fails early with a clear setup message when Module 20 runtime prerequisites are missing. */
function verifyRuntimePrerequisites() {
  const lockfile = path.join(projectRoot, "package-lock.json");
  if (!existsSync(lockfile)) {
    throw new Error(
      "package-lock.json is missing. Run `npm run deps:lock` on a networked machine, commit the lockfile, then run `npm ci`.",
    );
  }

  const vitestBinary = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!existsSync(vitestBinary)) {
    throw new Error("Backend dependencies are not installed. Run `npm ci` before the Module 20 runtime gate.");
  }

  if (!commandExists("docker")) {
    throw new Error("Docker is required for the Module 20 PostgreSQL and Redis runtime tests.");
  }
  if (!commandExists("docker", ["compose", "version"])) {
    throw new Error("Docker Compose v2 is required for the Module 20 runtime tests.");
  }
}

/** Runs one child process with the isolated Module 20 backend verification environment. */
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
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Recreates a deterministic database containing every committed migration and current platform/report seed data. */
async function prepareDatabase() {
  await run("node", ["scripts/reset-test-database.mjs"]);
  await run(executable("npm"), ["run", "test:migrations"]);
  await run(executable("npm"), ["run", "db:seed:administration"]);
  await run(executable("npm"), ["run", "db:seed:module20"]);
  await run(executable("npm"), ["run", "db:check"]);
}

let started = false;
try {
  verifyRuntimePrerequisites();
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  started = true;

  await run(executable("npm"), ["run", "test:module20:migrations"]);
  await prepareDatabase();
  await run(executable("npm"), ["run", "test:module20:specs"]);
  await run(executable("npm"), ["run", "test:regression:contracts"]);
  await run(executable("npm"), ["run", "typecheck"]);
  await run(executable("npm"), ["run", "lint"]);
  await run(executable("npm"), ["run", "build"]);

  console.log("Module 20 Reports & Analytics backend verification completed successfully.");
} finally {
  if (started) {
    try {
      await run("docker", ["compose", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop the Module 20 test infrastructure cleanly:", error);
    }
  }
}

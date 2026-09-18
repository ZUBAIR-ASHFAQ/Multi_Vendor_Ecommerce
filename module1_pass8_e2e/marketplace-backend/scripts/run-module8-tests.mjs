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
  INTERNAL_API_KEY: "module8-test-internal-api-key-that-is-at-least-32-characters",
  STORAGE_BUCKET: "marketplace-test",
  PRODUCT_MODERATION_REQUIRED: "false",
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

/** Runs one child process with the isolated Module 8 backend test environment. */
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
          new Error(
            `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}

/** Recreates a deterministic database containing all migrations and current platform RBAC. */
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

  await run(executable("npm"), ["run", "test:module8:migrations"]);
  await prepareDatabase();
  await run(executable("npm"), ["run", "test:module8:specs"]);
  await run(executable("npm"), ["run", "test:regression:contracts"]);

  // Re-run Foundation and every released prerequisite backend suite against the Module 8 schema.
  await run(executable("npm"), ["run", "test:foundation:specs"]);
  await run(executable("npm"), ["run", "test:module2:specs"]);
  await run(executable("npm"), ["run", "test:module21:specs"]);
  await run(executable("npm"), ["run", "test:module3:specs"]);
  await run(executable("npm"), ["run", "test:module4:specs"]);
  await run(executable("npm"), ["run", "test:module5:specs"]);
  await run(executable("npm"), ["run", "test:module6:specs"]);
  await run(executable("npm"), ["run", "test:module7:specs"]);
  await run(executable("npm"), ["run", "test:module19:specs"]);

  await run(executable("npm"), ["run", "typecheck"]);
  await run(executable("npm"), ["run", "lint"]);
  await run(executable("npm"), ["run", "build"]);

  console.log("Module 8 backend verification completed successfully.");
} finally {
  if (started) {
    try {
      await run("docker", ["compose", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop the Module 8 test infrastructure cleanly:", error);
    }
  }
}

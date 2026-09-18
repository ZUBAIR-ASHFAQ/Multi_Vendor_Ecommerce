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
  STORAGE_BUCKET: "marketplace-test",
};

/** Returns the platform-specific executable name for npm-like commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Runs one verification command with the shared test environment and streams its output. */
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

/** Rebuilds and seeds the deterministic database required by the Module 2 test suite. */
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

  await run(executable("npm"), ["run", "test:module2:migrations"]);

  // Foundation regression runs in a separate Vitest process so its database lifecycle
  // cannot affect the Module 2 integration suite.
  await prepareDatabase();
  await run(executable("npm"), ["run", "typecheck"]);
  await run(executable("npm"), ["run", "test:foundation:specs"]);

  // Rebuild a deterministic database for Module 2 and run its security/business suite.
  await prepareDatabase();
  await run(executable("npm"), ["run", "test:module2:specs"]);
  await run(executable("npm"), ["run", "lint"]);
  await run(executable("npm"), ["run", "build"]);

  console.log("Module 2 backend verification completed successfully.");
} finally {
  if (started) {
    try {
      await run("docker", ["compose", "-f", composeFile, "down", "-v"]);
    } catch (error) {
      console.error("Failed to stop the Module 2 test infrastructure cleanly:", error);
    }
  }
}

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const backendDirectory = path.join(rootDirectory, "marketplace-backend");
const frontendDirectory = path.join(rootDirectory, "marketplace-frontend");

/** Returns the platform-specific executable name used for npm commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Prints one readable release-stage heading. */
function logStage(name) {
  console.log(`\n=== ${name} ===`);
}

/** Runs one child command and fails the release verifier on a non-zero exit code. */
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

/** Fails early when either independent project has not been installed for the runtime release gate. */
function requireInstalledProjects() {
  for (const directory of [backendDirectory, frontendDirectory]) {
    for (const required of ["package.json", "node_modules"]) {
      const target = path.join(directory, required);
      if (!existsSync(target)) {
        throw new Error(
          `Module 16 release verification requires ${target}. Run npm install independently in both projects first.`,
        );
      }
    }
  }
}

/** Runs the final Module 16 release gate across the independent frontend and backend repositories. */
async function main() {
  logStage("Dependency-free Module 16 structure, HTTP, backend-test, and frontend checks");
  await run("node", [path.join("scripts", "verify-module16-static.mjs")]);
  await run("node", [path.join("scripts", "verify-http-contracts.mjs")]);
  await run("node", [path.join("scripts", "verify-backend-test-contracts.mjs")]);
  await run("node", [path.join("scripts", "verify-frontend-feature-contracts.mjs")]);
  requireInstalledProjects();

  logStage("Module 16 runtime regression, Playwright, reconciliation, build, and container gate");
  await run(executable("npm"), ["run", "test:e2e:ci"], { cwd: frontendDirectory });

  console.log("\nModule 16 Commissions full release verification completed successfully.");
}

await main();

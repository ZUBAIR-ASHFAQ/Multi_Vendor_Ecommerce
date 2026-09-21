import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const backendDirectory = path.join(rootDirectory, "backend");
const frontendDirectory = path.join(rootDirectory, "frontend");

/** Returns the platform-specific executable name used for npm commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Prints one readable release-stage heading. */
function logStage(name) {
  console.log(`\n=== ${name} ===`);
}

/** Runs one child command and fails the release verifier on any non-zero exit code. */
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

/** Fails early when either independent project has not been installed yet. */
function requireInstalledProjects() {
  for (const directory of [backendDirectory, frontendDirectory]) {
    for (const required of ["package.json", "node_modules"]) {
      const target = path.join(directory, required);
      if (!existsSync(target)) {
        throw new Error(
          `Module 11 release verification requires ${target}. Run npm install independently in both projects first.`,
        );
      }
    }
  }
}

/** Runs every dependency-free structural verifier required by the Module 11 dependency chain. */
async function runStaticDependencyChain() {
  for (const script of [
    "verify-module2-static.mjs",
    "verify-module21-static.mjs",
    "verify-module3-static.mjs",
    "verify-module4-static.mjs",
    "verify-module5-static.mjs",
    "verify-module6-static.mjs",
    "verify-module7-static.mjs",
    "verify-module19-static.mjs",
    "verify-module8-static.mjs",
    "verify-module9-static.mjs",
    "verify-module13-static.mjs",
    "verify-module10-static.mjs",
    "verify-module11-static.mjs",
  ]) {
    await run("node", [path.join("scripts", script)]);
  }
}

/** Runs the final Module 11 release gate across both independent repositories. */
async function main() {
  logStage("Dependency-free Module 11 structure and dependency chain");
  await runStaticDependencyChain();
  requireInstalledProjects();

  logStage("Backend Module 11 migration, service, API, regression, lint, typecheck, and build gate");
  await run(executable("npm"), ["run", "test:module11"], { cwd: backendDirectory });

  logStage("Frontend Module 11 lint, typecheck, RTL/MSW, and production build gate");
  await run(executable("npm"), ["run", "lint"], { cwd: frontendDirectory });
  await run(executable("npm"), ["run", "typecheck"], { cwd: frontendDirectory });
  await run(executable("npm"), ["run", "test:module11"], { cwd: frontendDirectory });
  await run(executable("npm"), ["run", "build"], { cwd: frontendDirectory });

  logStage("Live OpenAPI, Playwright Module 11, post-browser reconciliation, and container gate");
  await run(executable("npm"), ["run", "test:e2e:ci"], { cwd: frontendDirectory });

  console.log("\nModule 11 Orders full release verification completed successfully.");
}

await main();

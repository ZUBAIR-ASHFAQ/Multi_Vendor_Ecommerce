import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDirectory = path.join(root, "marketplace-backend");
const frontendDirectory = path.join(root, "marketplace-frontend");
const skipInstall = process.argv.includes("--skip-install");

/** Returns the platform-specific executable name for npm commands. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/** Runs one release command and stops immediately when it fails. */
async function run(command, args, { cwd = root, env = process.env } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Reads the major version from a normal semantic-version string. */
function majorVersion(version) {
  return Number.parseInt(String(version).split(".")[0] ?? "0", 10);
}

/** Returns the installed npm version, or an empty string when npm cannot be executed. */
function npmVersion() {
  const result = spawnSync(executable("npm"), ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Fails early when the machine cannot run the complete current-stage release gate. */
function verifyPrerequisites() {
  if (majorVersion(process.versions.node) < 22) {
    throw new Error(`Node.js 22+ is required; current version is ${process.versions.node}.`);
  }

  const installedNpm = npmVersion();
  if (majorVersion(installedNpm) !== 10) {
    throw new Error(`npm 10 is required; current version is ${installedNpm || "unavailable"}.`);
  }

  for (const requiredPath of [
    path.join(backendDirectory, "package.json"),
    path.join(backendDirectory, "package-lock.json"),
    path.join(frontendDirectory, "package.json"),
    path.join(frontendDirectory, "package-lock.json"),
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `Release prerequisite is missing: ${requiredPath}. Bootstrap each independent lockfile with npm run deps:lock first.`,
      );
    }
  }

  if (spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker is required for the full current-stage release gate.");
  }
  if (spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker Compose v2 is required for the full current-stage release gate.");
  }
}

/** Confirms both lockfiles belong to their independent projects and match package.json. */
async function verifyLockfiles() {
  await run(executable("npm"), ["run", "deps:verify-lock"], { cwd: backendDirectory });
  await run(executable("npm"), ["run", "deps:verify-lock"], { cwd: frontendDirectory });
}

/** Installs both independent dependency trees exactly from their committed lockfiles. */
async function installDependencies() {
  await run(executable("npm"), ["ci"], { cwd: backendDirectory });
  await run(executable("npm"), ["ci"], { cwd: frontendDirectory });
  await run(executable("npm"), ["exec", "playwright", "install", "--with-deps", "chromium"], {
    cwd: frontendDirectory,
  });
}

/** Runs the dependency-free cross-project contract and module source verification first. */
async function runSourceGate() {
  await run(process.execPath, ["scripts/verify-current-release-static.mjs"], { cwd: root });
}

/** Runs the complete backend/frontend/browser/data/container release gate. */
async function runProvisionedGate() {
  await run(executable("npm"), ["run", "test:e2e:ci"], {
    cwd: frontendDirectory,
    env: {
      ...process.env,
      E2E_BACKEND_DIR: backendDirectory,
    },
  });
}

/** Executes the final release gate in the same order a CI release should follow. */
async function main() {
  verifyPrerequisites();
  await verifyLockfiles();
  await runSourceGate();

  if (!skipInstall) {
    await installDependencies();
  } else {
    for (const nodeModulesPath of [
      path.join(backendDirectory, "node_modules"),
      path.join(frontendDirectory, "node_modules"),
    ]) {
      if (!existsSync(nodeModulesPath)) {
        throw new Error(`--skip-install was used but dependencies are missing: ${nodeModulesPath}`);
      }
    }
  }

  await runProvisionedGate();
  console.log("\nCurrent marketplace release gate passed through Module 1 Pass 8 E2E/regression verification.");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease gate failed: ${message}`);
  process.exitCode = 1;
}

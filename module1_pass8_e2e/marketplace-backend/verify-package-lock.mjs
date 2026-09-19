import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** Reads and parses one JSON file from the backend project root. */
function readJson(fileName) {
  return JSON.parse(
    readFileSync(path.join(projectRoot, fileName), "utf8").replace(/^\uFEFF/, ""),
  );
}

/** Returns a stable representation so dependency-map key order does not affect comparison. */
function stableRecord(record) {
  return JSON.stringify(Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

/** Confirms the committed npm lockfile belongs to this independent backend project. */
function verifyPackageLock() {
  const lockPath = path.join(projectRoot, "package-lock.json");
  if (!existsSync(lockPath)) {
    throw new Error(
      "package-lock.json is missing. Run `npm run deps:lock` in marketplace-backend on a networked machine, then commit the generated lockfile.",
    );
  }

  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const rootEntry = packageLock.packages?.[""];

  if (packageLock.lockfileVersion !== 3) {
    throw new Error("Backend package-lock.json must use npm lockfileVersion 3.");
  }
  if (packageLock.name !== packageJson.name || rootEntry?.name !== packageJson.name) {
    throw new Error("Backend package-lock.json does not belong to marketplace-backend.");
  }
  if (stableRecord(rootEntry?.dependencies) !== stableRecord(packageJson.dependencies)) {
    throw new Error("Backend package-lock.json dependencies are out of sync with package.json.");
  }
  if (stableRecord(rootEntry?.devDependencies) !== stableRecord(packageJson.devDependencies)) {
    throw new Error("Backend package-lock.json devDependencies are out of sync with package.json.");
  }

  console.log("Backend package lock metadata is synchronized.");
}

verifyPackageLock();

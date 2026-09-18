import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads a required release-gate file and reports its path when it is missing. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Pass 8 file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Requires one exact source fragment that proves a release-gate contract. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms every implemented Playwright workflow is present and executed in dependency order. */
function verifyPlaywrightCoverage() {
  const runner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const specs = [
    "foundation.spec.ts",
    "module2.spec.ts",
    "module21.spec.ts",
    "module3.spec.ts",
    "module4.spec.ts",
    "module5.spec.ts",
    "module6.spec.ts",
    "module7.spec.ts",
    "module19.spec.ts",
    "module8.spec.ts",
    "module9.spec.ts",
    "module10.spec.ts",
    "module11.spec.ts",
    "module12.spec.ts",
    "module16.spec.ts",
    "module13.spec.ts",
    "module14.spec.ts",
    "module17.spec.ts",
    "module15.spec.ts",
    "module18.spec.ts",
    "module20.spec.ts",
    "module1.spec.ts",
  ];

  let previousIndex = -1;
  for (const spec of specs) {
    read(`marketplace-frontend/e2e/${spec}`);
    const expected = `e2e/${spec}`;
    const currentIndex = runner.indexOf(expected);
    if (currentIndex === -1) {
      throw new Error(`Pass 8 E2E runner does not execute ${expected}.`);
    }
    if (currentIndex <= previousIndex) {
      throw new Error(`Pass 8 Playwright order is not dependency-safe at ${expected}.`);
    }
    previousIndex = currentIndex;
  }

  requireText(runner, '"--workers=1"', "Pass 8 E2E runner");
  requireText(runner, "Run Playwright Foundation through Module 1 in dependency order", "Pass 8 E2E runner");
}

/** Confirms the post-browser reconciliation checks cover every current transactional read model. */
function verifyReleaseDataCoverage() {
  const runner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  for (const script of [
    "test:module6:release-data",
    "test:module7:release-data",
    "test:module19:release-data",
    "test:module8:release-data",
    "test:module9:release-data",
    "test:module10:release-data",
    "test:module11:release-data",
    "test:module12:release-data",
    "test:module16:release-data",
    "test:module13:release-data",
    "test:module14:release-data",
    "test:module17:release-data",
    "test:module15:release-data",
    "test:module18:release-data",
    "test:module20:release-data",
    "test:module1:release-data",
  ]) {
    requireText(runner, script, "Pass 8 post-browser release-data gate");
  }

  for (const proof of [
    'await run(executable("npm"), ["run", "build"]',
    "verifyLiveOpenApi()",
    "await runPlaywrightGate()",
    "buildReleaseContainers()",
    "E2E release gate completed successfully.",
  ]) {
    requireText(runner, proof, "Pass 8 E2E runner");
  }
}

/** Confirms independent CI repositories require committed lockfiles and reproducible npm ci installs. */
function verifyCiLockfilePolicy() {
  for (const project of ["marketplace-backend", "marketplace-frontend"]) {
    const workflow = read(`${project}/.github/workflows/ci.yml`);
    requireText(workflow, "npm run deps:verify-lock", `${project} CI`);
    requireText(workflow, "run: npm ci", `${project} CI`);
    if (workflow.includes("npm install")) {
      throw new Error(`${project} CI must not fall back to npm install.`);
    }
  }

  const e2eWorkflow = read("marketplace-frontend/.github/workflows/e2e.yml");
  for (const proof of [
    "Verify backend dependency lock",
    "Verify frontend dependency lock",
    "run: npm ci",
    "node e2e/run-e2e-ci.mjs",
  ]) {
    requireText(e2eWorkflow, proof, "Cross-repository E2E workflow");
  }
  if (e2eWorkflow.includes("npm install")) {
    throw new Error("Cross-repository E2E workflow must not fall back to npm install.");
  }
}

/** Confirms the permanent full release runner reports the actual implemented stage. */
function verifyReleaseRunner() {
  const runner = read("scripts/run-current-release-gate.mjs");
  for (const proof of [
    "verifyLockfiles()",
    "runSourceGate()",
    "installDependencies()",
    "runProvisionedGate()",
    "Current marketplace release gate passed through Module 1 Pass 8 E2E/regression verification.",
  ]) {
    requireText(runner, proof, "Current release runner");
  }
}

/** Executes the dependency-free Pass 8 release-contract verification. */
function main() {
  verifyPlaywrightCoverage();
  verifyReleaseDataCoverage();
  verifyCiLockfilePolicy();
  verifyReleaseRunner();
  console.log("Pass 8 E2E/release-contract verification passed.");
}

main();

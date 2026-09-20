import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required final Module 16 file and reports the exact missing path. */
function read(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`Required Module 16 file is missing: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

/** Requires one stable source fragment that proves an intended release behavior. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`${label} is missing required text: ${expected}`);
}

/** Rejects one source fragment that would violate the final release boundary. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) throw new Error(`${label} contains forbidden text: ${forbidden}`);
}

/** Confirms obsolete remediation evidence is removed from the final delivery. */
function verifyCleanup() {
  for (let pass = 0; pass <= 8; pass += 1) {
    const historical = join(root, "scripts", `verify-module16-pass${pass}.mjs`);
    if (existsSync(historical)) {
      throw new Error(`Obsolete Module 16 pass verifier must be removed: scripts/verify-module16-pass${pass}.mjs`);
    }
  }
  if (existsSync(join(root, "MODULE16_INSPECTION.md"))) {
    throw new Error("Completed MODULE16_INSPECTION.md pass evidence must be removed from the final delivery.");
  }
}

/** Confirms the focused Playwright workflow proves settlement, replay, history, refund, and seller isolation. */
function verifyPlaywrightWorkflow() {
  const e2e = read("marketplace-frontend/e2e/module16.spec.ts");
  for (const proof of [
    'test.describe("Module 16 Commissions E2E"',
    '"/admin/commissions/rules"',
    '"/seller/commissions"',
    '"/admin/commissions/entries"',
    "internal/commissions/order-settle",
    "internal/commissions/refund-adjust",
    "replayedSettlement",
    "replayedAdjustment",
    "updatedFutureRule",
    "sellerBBrowser",
    "full-refund Commission reversal",
    'commissionAmount: "13.0000"',
    'commissionAmount: "-13.0000"',
  ]) {
    requireText(e2e, proof, "Module 16 Playwright workflow");
  }
  rejectText(e2e.toLowerCase(), "insert into ", "Module 16 Playwright workflow");
  rejectText(e2e.toLowerCase(), "update commission_", "Module 16 Playwright workflow");
  rejectText(e2e.toLowerCase(), "delete from ", "Module 16 Playwright workflow");
}

/** Confirms post-browser verification is read-only and checks immutable finance invariants. */
function verifyReleaseDataGate() {
  const releaseData = read("marketplace-backend/scripts/verify-module16-release-data.mjs");
  for (const proof of [
    "commission_rule_snapshots",
    "commission_entries",
    "commission.rule_created",
    "commission.posted",
    "commission.adjusted",
    "commissions.order-settle",
    "commissions.refund-adjust",
    "Duplicate Commission entry source keys",
    "Duplicate Commission snapshots per Order Item",
    "full-refund reversal economics",
    "snapshot historical-rate drift",
  ]) {
    requireText(releaseData, proof, "Module 16 release-data verifier");
  }
  for (const forbidden of ["INSERT INTO", "UPDATE commission_", "DELETE FROM", "TRUNCATE", "DROP TABLE"]) {
    rejectText(releaseData.toUpperCase(), forbidden, "Read-only Module 16 release-data verifier");
  }
}

/** Confirms package scripts keep only durable Module 16 test/release commands. */
function verifyPackageScripts() {
  const backend = JSON.parse(read("marketplace-backend/package.json"));
  const frontend = JSON.parse(read("marketplace-frontend/package.json"));
  const durableBackendScripts = {
    "test:module16:migrations": "node scripts/verify-module16-migrations.mjs",
    "test:module16:contracts": "vitest run tests/module16/module16.schemas.test.ts",
    "test:module16:repository": "vitest run tests/module16/module16.schemas.test.ts tests/module16/module16.repository.test.ts",
    "test:module16:service": "vitest run tests/module16/module16.schemas.test.ts tests/module16/module16.repository.test.ts tests/module16/module16.service.test.ts",
    "test:module16:http": "vitest run tests/module16/module16.http.test.ts",
    "test:module16:integration": "vitest run tests/module16/module16.integration.test.ts",
    "test:module16:specs": "vitest run tests/module16",
    "test:module16": "node scripts/run-module16-tests.mjs",
    "test:module16:release-data": "node scripts/verify-module16-release-data.mjs",
  };
  for (const [name, command] of Object.entries(durableBackendScripts)) {
    if (backend.scripts?.[name] !== command) throw new Error(`Backend package.json must keep ${name}.`);
  }
  for (const obsolete of [
    "test:module16:prerequisites",
    "test:module16:database",
    "test:module16:contracts:static",
    "test:module16:repository:static",
    "test:module16:service:static",
    "test:module16:http:static",
    "test:module16:backend:static",
  ]) {
    if (obsolete in (backend.scripts ?? {})) throw new Error(`Obsolete Module 16 pass script remains: ${obsolete}`);
  }
  if (frontend.scripts?.["test:module16"] !== "vitest run tests/module16-commissions.test.tsx") {
    throw new Error("Frontend package.json must expose test:module16.");
  }
  if (frontend.scripts?.["test:e2e:module16"] !== "playwright test e2e/module16.spec.ts") {
    throw new Error("Frontend package.json must expose test:e2e:module16.");
  }
}

/** Confirms the permanent cross-repository E2E gate carries Module 16 through release reconciliation. */
function verifyE2eRunner() {
  const runner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  for (const proof of [
    '"e2e/module16.spec.ts"',
    '"test:module16"',
    '"test:module16:release-data"',
    '"/api/v1/admin/commissions/rules"',
    '"/api/v1/admin/commissions/rules/{id}"',
    '"/api/v1/seller/commissions"',
    '"/api/v1/admin/commissions/entries"',
    '"/api/v1/internal/commissions/order-settle"',
    '"/api/v1/internal/commissions/refund-adjust"',
    "Run Playwright Foundation through Module 1 in dependency order",
    "Build both independent release containers",
  ]) {
    requireText(runner, proof, "Cross-repository Module 16 release runner");
  }
}

/** Confirms permanent CI runs Module 16 migrations/tests in each independent project. */
function verifyCiWiring() {
  const backendCi = read("marketplace-backend/.github/workflows/ci.yml");
  const frontendCi = read("marketplace-frontend/.github/workflows/ci.yml");
  const e2eCi = read("marketplace-frontend/.github/workflows/e2e.yml");
  requireText(backendCi, "Verify Module 16 Commissions clean and upgrade migrations", "Backend CI");
  requireText(backendCi, "npm run test:module16:migrations", "Backend CI");
  requireText(backendCi, "npm run test:module16:specs", "Backend CI");
  requireText(frontendCi, "Run Module 16 Commissions frontend tests", "Frontend CI");
  requireText(frontendCi, "npm run test:module16", "Frontend CI");
  requireText(e2eCi, "node e2e/run-e2e-ci.mjs", "Cross-repository E2E CI");
}

/** Confirms the final release verifier delegates runtime proof to the permanent static and E2E gates. */
function verifyFinalReleaseVerifier() {
  const finalVerifier = read("scripts/verify-module16.mjs");
  for (const proof of [
    "verify-module16-static.mjs",
    "verify-http-contracts.mjs",
    "verify-backend-test-contracts.mjs",
    "verify-frontend-feature-contracts.mjs",
    '"test:e2e:ci"',
    "Module 16 Commissions full release verification completed successfully.",
  ]) {
    requireText(finalVerifier, proof, "Module 16 final release verifier");
  }
  rejectText(finalVerifier, "verify-module16-pass", "Module 16 final release verifier");
}

/** Confirms final documentation no longer tells developers to run obsolete remediation pass gates. */
function verifyDocumentationCleanup() {
  const rootReadme = read("README.md");
  const backendReadme = read("marketplace-backend/README.md");
  for (const source of [rootReadme, backendReadme]) {
    rejectText(source, "verify-module16-pass", "Final Module 16 documentation");
    rejectText(source, "test:module16:backend:static", "Final Module 16 documentation");
    rejectText(source, "MODULE16_INSPECTION.md", "Final Module 16 documentation");
  }
}

verifyCleanup();
verifyPlaywrightWorkflow();
verifyReleaseDataGate();
verifyPackageScripts();
verifyE2eRunner();
verifyCiWiring();
verifyFinalReleaseVerifier();
verifyDocumentationCleanup();
console.log("Module 16 permanent static release verification passed.");

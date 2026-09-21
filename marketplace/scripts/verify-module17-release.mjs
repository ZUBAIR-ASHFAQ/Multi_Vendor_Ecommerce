import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required final Module 17 release file and reports the exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 17 release file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one durable final-release source fragment. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms production payout composition is environment-driven while test behavior stays non-production only. */
function verifyProviderComposition() {
  const factory = read("backend/src/integrations/payouts/payout-provider.factory.ts");
  const environment = read("backend/src/config/env.ts");
  const application = read("backend/src/app.ts");
  const example = read("backend/.env.example");
  const tests = read("backend/tests/module17/module17.provider.test.ts");
  const environmentTests = read("backend/tests/unit/environment-security.test.ts");

  for (const expected of [
    'UNCONFIGURED: "unconfigured"',
    'MODULE: "module"',
    'DETERMINISTIC_TEST: "deterministic_test"',
    "class ModulePayoutProviderAdapter",
    "export class DeterministicTestPayoutProviderAdapter",
    "export function createPayoutProviderAdapter",
  ]) requireText(factory, expected, "Module 17 payout-provider factory");

  for (const expected of [
    "PAYOUT_PROVIDER_MODE",
    "PAYOUT_PROVIDER_TYPE",
    "PAYOUT_PROVIDER_ADAPTER_MODULE",
    "WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS",
    "Production requires a deployment-configured payout provider module.",
    "The deterministic payout provider is only allowed outside production.",
  ]) requireText(environment, expected, "Module 17 environment contract");

  for (const expected of [
    "createPayoutProviderAdapter({",
    "provider: payoutProvider",
    "now: walletPayoutNow",
  ]) requireText(application, expected, "Module 17 application composition");

  requireText(example, "PAYOUT_PROVIDER_MODE=unconfigured", "Module 17 environment example");
  requireText(tests, "keeps an unknown result held until the same provider payout identity", "Module 17 provider proof");
  requireText(environmentTests, "requires deployment-owned payout-provider composition", "Environment security proof");
}

/** Confirms final browser proof covers paid, failed, uncertain, and post-payout refund behavior. */
function verifyBrowserProof() {
  const browser = read("frontend/e2e/module17.spec.ts");
  const packageJson = JSON.parse(read("frontend/package.json"));

  for (const expected of [
    "moves Commission earnings through delivery, hold, available, reservation, and paid Payout history",
    "reconciles provider failure and unknown results without losing or prematurely releasing held money",
    "appends a refund Commission/Wallet adjustment after payout without rewriting paid history",
    '"paid:module17-main-1234"',
    '"failed:module17-failed-5678"',
    '"unknown_then_paid:module17-unknown-9999"',
    "expect(paidAfterRefund).toEqual(paidBeforeRefund)",
  ]) requireText(browser, expected, "Module 17 Playwright proof");

  if (packageJson.scripts?.["test:e2e:module17"] !== "playwright test e2e/module17.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 17 Playwright gate.");
  }
}

/** Confirms post-browser reconciliation checks immutable financial truth instead of UI-only success. */
function verifyReleaseDataProof() {
  const releaseData = read("backend/scripts/verify-module17-release-data.mjs");
  const packageJson = JSON.parse(read("backend/package.json"));

  for (const expected of [
    "Module 17 delivered Commission sale source",
    "Module 17 pending-to-available settlement evidence",
    "Module 17 provider-paid Payout",
    "Module 17 authoritative provider failure",
    "Module 17 unknown-then-paid reconciliation",
    "Module 17 post-payout refund Wallet adjustment",
    "Module 17 Wallet snapshot-to-ledger reconciliation",
    "Module 17 duplicate immutable Wallet source keys",
    "Module 17 reserved Payout allocation totals",
    "Module 17 paid Payout held-history finalization",
  ]) requireText(releaseData, expected, "Module 17 release-data verifier");

  requireText(releaseData, "availability_transfer", "Module 17 settlement-entry reconciliation");
  if (packageJson.scripts?.["test:module17:release-data"] !== "node scripts/verify-module17-release-data.mjs") {
    throw new Error("Backend package.json must expose the Module 17 post-browser reconciliation gate.");
  }
}

/** Confirms the cumulative E2E runner executes Module 17 with deterministic test-only provider composition. */
function verifyCumulativeRunner() {
  const runner = read("frontend/e2e/run-e2e-ci.mjs");

  for (const expected of [
    'PAYOUT_PROVIDER_MODE: "deterministic_test"',
    'PAYOUT_PROVIDER_TYPE: "e2e"',
    'WALLET_PAYOUT_TEST_CLOCK_OFFSET_DAYS: "2"',
    '"e2e/module17.spec.ts"',
    '"test:module17"',
    '"test:module17:release-data"',
    '"/api/v1/seller/wallet"',
    '"/api/v1/admin/payouts/{id}/send"',
  ]) requireText(runner, expected, "Cross-repository Module 17 release runner");
}

/** Confirms failed/uncertain provider commands refresh persisted Payout state in the finance UI. */
function verifyFrontendReconciliationRefresh() {
  const hooks = read(
    "frontend/src/features/seller-wallet-payouts/hooks/use-seller-wallet-payouts.ts",
  );
  const tests = read("frontend/tests/module17-seller-wallet-payouts.test.tsx");
  const marker = hooks.indexOf("export function useSendPayoutMutation");
  const source = marker >= 0 ? hooks.slice(marker, marker + 700) : "";

  requireText(source, "onSettled", "Module 17 send-Payout mutation");
  if (source.includes("onSuccess:")) {
    throw new Error("Send-Payout refresh must not depend only on a 2xx provider result.");
  }
  requireText(
    tests,
    "refreshes finance Payout state after a provider error",
    "Module 17 frontend provider-reconciliation regression proof",
  );
}

/** Confirms temporary audit evidence is absent while approved requirement patches remain. */
function verifyFinalCleanup() {
  const rootFiles = readdirSync(root);
  const temporaryEvidence = rootFiles.filter(
    (name) => /^AUDIT_REMEDIATION_PASS_\d+\.md$/u.test(name) || name === "MODULE17_INSPECTION.md",
  );
  if (temporaryEvidence.length > 0) {
    throw new Error(`Temporary audit evidence still exists: ${temporaryEvidence.join(", ")}`);
  }

  read("REQUIREMENTS_PATCH_0010.md");
  read("REQUIREMENTS_PATCH_0002_PROPOSED.md");
}

/** Keeps the remediation database history frozen at migration 0030. */
function verifyMigrationFreeze() {
  const migrations = readdirSync(path.join(root, "backend", "drizzle"))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();

  if (!migrations.includes("0030_audit_remediation_expiry_lookup.sql")) {
    throw new Error("Module 17 remediation migration 0030 must remain in migration history.");
  }
}

verifyProviderComposition();
verifyBrowserProof();
verifyReleaseDataProof();
verifyCumulativeRunner();
verifyFrontendReconciliationRefresh();
verifyFinalCleanup();
verifyMigrationFreeze();
console.log("Module 17 current release source verification passed.");

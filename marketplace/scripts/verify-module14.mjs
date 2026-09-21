import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required final Module 14 file and reports its exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required final Module 14 file is missing: ${relativePath}`);
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one durable final-release fragment. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Runs one earlier permanent Module 14 source gate so final verification remains cumulative. */
function runGate(scriptName) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${scriptName} failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  if (result.stdout) process.stdout.write(result.stdout);
}

/** Confirms final Playwright proof covers the two required Return/refund paths and isolation/replay evidence. */
function verifyPlaywrightProof() {
  const e2e = read("frontend/e2e/module14.spec.ts");
  for (const expected of [
    "requests, seller-inspects, refunds, replays, restocks once, and preserves seller isolation",
    "refunds an approved Return without physical restock and replays the same money command",
    "RETURN_SCOPE_FORBIDDEN",
    "refund_restock",
    "refund_no_restock",
    "Idempotency-Key",
    "settleCommission",
    "markDelivered",
  ]) {
    requireText(e2e, expected, "Module 14 Playwright proof");
  }
}

/** Confirms post-browser reconciliation protects money, stock, Commission, lifecycle, and evidence invariants. */
function verifyReleaseDataProof() {
  const verifier = read("backend/scripts/verify-module14-release-data.mjs");
  for (const expected of [
    "Module 14 completed Return refunds",
    "Module 14 physical restock path",
    "Module 14 refund-without-restock path",
    "Return item cumulative refund money reconciliation",
    "Return restock exactly-once reconciliation",
    "Commission sale/refund append-only reconciliation",
    "Return lifecycle audit/outbox exactly-once evidence",
    "Return refund Foundation idempotency completion",
    "Return seller-scoped audit ownership",
  ]) {
    requireText(verifier, expected, "Module 14 release-data verifier");
  }
}

/** Confirms package scripts and the permanent cross-repository runner execute Module 14 release proof. */
function verifyReleaseWiring() {
  const backendPackage = JSON.parse(read("backend/package.json"));
  const frontendPackage = JSON.parse(read("frontend/package.json"));
  const runner = read("frontend/e2e/run-e2e-ci.mjs");

  if (
    backendPackage.scripts?.["test:module14:release-data"] !==
    "node scripts/verify-module14-release-data.mjs"
  ) {
    throw new Error("Backend package.json must expose the Module 14 release-data verifier.");
  }
  if (
    frontendPackage.scripts?.["test:e2e:module14"] !==
    "playwright test e2e/module14.spec.ts"
  ) {
    throw new Error("Frontend package.json must expose the focused Module 14 Playwright workflow.");
  }

  for (const expected of [
    '"test:module14"',
    '"e2e/module14.spec.ts"',
    '"test:module14:release-data"',
    '"/api/v1/orders/{orderId}/returns"',
    '"/api/v1/returns"',
    '"/api/v1/seller/returns"',
    '"/api/v1/seller/returns/{id}/approve"',
    '"/api/v1/seller/returns/{id}/reject"',
    '"/api/v1/seller/returns/{id}/receive"',
    '"/api/v1/returns/{id}/refund"',
    '"/api/v1/admin/returns"',
  ]) {
    requireText(runner, expected, "Module 14 cross-repository release runner");
  }
}

/** Confirms temporary pass evidence and stale deferred-release wording are absent from final delivery metadata. */
function verifyCleanup() {
  if (fs.existsSync(path.join(root, "MODULE14_INSPECTION.md"))) {
    throw new Error("Temporary MODULE14_INSPECTION.md must be removed from the final release archive.");
  }

  for (const relativePath of [
    "README.md",
    "backend/README.md",
    "frontend/README.md",
  ]) {
    const source = read(relativePath);
    if (/Module 14[^\n]*(Pass 8[^\n]*deferred|E2E[^\n]*deferred)/i.test(source)) {
      throw new Error(`${relativePath} still describes Module 14 final release work as deferred.`);
    }
  }
}

/** Runs the completed Module 14 source-level release gate. */
function main() {
  for (const script of [
    "verify-module14-contracts.mjs",
    "verify-module14-repository.mjs",
    "verify-module14-service.mjs",
    "verify-module14-http.mjs",
    "verify-module14-backend-proof.mjs",
    "verify-module14-frontend.mjs",
  ]) {
    runGate(script);
  }
  verifyPlaywrightProof();
  verifyReleaseDataProof();
  verifyReleaseWiring();
  verifyCleanup();
  console.log("Module 14 Returns, Refunds & Disputes final source gate passed.");
}

main();

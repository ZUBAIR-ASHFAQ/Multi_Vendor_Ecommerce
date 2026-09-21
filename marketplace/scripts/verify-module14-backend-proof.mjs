import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required delivery file and reports its exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Module 14 backend proof file is missing: ${relativePath}`);
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one durable backend proof fragment. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms focused backend tests exist for repository, service, HTTP policy, and real PostgreSQL orchestration. */
function verifyTestFiles() {
  const repository = read("backend/tests/module14/module14.repository.test.ts");
  const service = read("backend/tests/module14/module14.service.test.ts");
  const http = read("backend/tests/module14/module14.http.test.ts");
  const integration = read("backend/tests/module14/module14.integration.test.ts");
  const helpers = read("backend/tests/module14/module14.test-helpers.ts");

  for (const expected of [
    "seller locks inside their exact persisted ownership scopes",
    "excludes rejected Return Requests from reserved quantity",
    "Refund identity unique",
  ]) requireText(repository, expected, "Module 14 repository proof");

  for (const expected of [
    "expired delivery windows",
    "over-allocation",
    "seller.returns.manage",
    "derives restock quantity from resolution",
    "includes append-only lifecycle history in the existing customer Return list response",
    "allocates exact cumulative scale-4 money",
    "approved no-physical-return refund",
    "replays a completed Foundation idempotency result",
    "downstream financial adjustment fails",
  ]) requireText(service, expected, "Module 14 service proof");

  for (const expected of [
    "client-owned refund/scope fields",
    "authenticated customer's own Return Requests",
    "seller A Return queue",
    "explicit receive/inspection state",
    "refund execution admin-only",
  ]) requireText(http, expected, "Module 14 HTTP proof");

  for (const expected of [
    "provider refund -> Commission reversal -> restock -> close exactly once",
    "refund-without-restock",
    "provider failure",
    "concurrent Return allocation",
    "cumulative immutable item economics",
  ]) requireText(integration, expected, "Module 14 integration proof");

  for (const expected of [
    "prepareDeliveredReturnFixture",
    "ReturnRefundProvider",
    "countReturnRestockMovements",
    "countCommissionRefundEntries",
    "countSucceededPaymentRefunds",
  ]) requireText(helpers, expected, "Module 14 test helpers");
}

/** Confirms package scripts expose focused and cumulative Module 14 backend gates. */
function verifyPackageScripts() {
  const packageJson = JSON.parse(read("backend/package.json"));
  const scripts = packageJson.scripts ?? {};
  const expected = {
    "test:module14:migrations": "node scripts/verify-module14-migrations.mjs",
    "test:module14:contracts": "vitest run tests/module14/module14.schemas.test.ts",
    "test:module14:repository": "vitest run tests/module14/module14.repository.test.ts",
    "test:module14:service": "vitest run tests/module14/module14.schemas.test.ts tests/module14/module14.repository.test.ts tests/module14/module14.service.test.ts",
    "test:module14:http": "vitest run tests/module14/module14.http.test.ts",
    "test:module14:integration": "vitest run tests/module14/module14.integration.test.ts",
    "test:module14:specs": "vitest run tests/module14",
    "test:module14": "node scripts/run-module14-tests.mjs",
  };

  for (const [name, command] of Object.entries(expected)) {
    if (scripts[name] !== command) {
      throw new Error(`Module 14 package script ${name} does not match the backend proof contract.`);
    }
  }
}

/** Confirms the cumulative runner provisions dependencies and re-runs released prerequisite suites. */
function verifyRunner() {
  const runner = read("backend/scripts/run-module14-tests.mjs");
  for (const expected of [
    '"test:module14:migrations"',
    '"test:module14:specs"',
    '"test:regression:contracts"',
    '"test:module7:specs"',
    '"test:module11:specs"',
    '"test:module12:specs"',
    '"test:module13:specs"',
    '"test:module16:specs"',
    '"typecheck"',
    '"lint"',
    '"build"',
  ]) requireText(runner, expected, "Module 14 cumulative backend runner");
}

/** Confirms CI executes Module 14 migrations and backend proof on a clean database. */
function verifyCi() {
  const ci = read("backend/.github/workflows/ci.yml");
  for (const expected of [
    "Verify Module 14 Returns/refunds clean and upgrade migrations",
    "npm run test:module14:migrations",
    "Prepare database for Module 14 Returns/refunds backend proof",
    "Run Module 14 Returns/refunds backend proof",
    "npm run test:module14:specs",
  ]) requireText(ci, expected, "Backend CI Module 14 wiring");
}

verifyTestFiles();
verifyPackageScripts();
verifyRunner();
verifyCi();
console.log("Module 14 backend proof verification passed; React and final E2E/release proof may coexist.");

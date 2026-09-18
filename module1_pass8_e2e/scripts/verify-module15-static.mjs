import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required final Module 15 file and reports the exact missing path. */
function read(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`Required Module 15 file is missing: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

/** Requires one stable source fragment that proves an intended release behavior. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`${label} is missing required text: ${expected}`);
}

/** Rejects one source fragment that would violate the approved Module 15 boundary. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) throw new Error(`${label} contains forbidden text: ${forbidden}`);
}

/** Confirms temporary Module 15 pass artifacts are absent from the current source tree. */
function verifyCleanup() {
  for (const name of [
    "MODULE15_INSPECTION.md",
    "MODULE15_PASS_1.md",
    "MODULE15_PASS_2.md",
    "MODULE15_PASS_3.md",
    "MODULE15_PASS_4.md",
    "MODULE15_PASS_5.md",
    "MODULE15_PASS_6.md",
    "MODULE15_PASS_7.md",
  ]) {
    if (existsSync(join(root, name))) throw new Error(`Temporary Module 15 pass evidence remains: ${name}`);
  }
  for (let pass = 1; pass <= 7; pass += 1) {
    const verifier = join(root, "scripts", `verify-module15-pass${pass}.mjs`);
    if (existsSync(verifier)) throw new Error(`Obsolete Module 15 pass verifier remains: ${verifier}`);
  }
}

/** Confirms the final browser flow proves verified purchase, Helpful, moderation, ratings, Search, and isolation. */
function verifyPlaywrightWorkflow() {
  const e2e = read("marketplace-frontend/e2e/module15.spec.ts");
  for (const proof of [
    'test.describe("Module 15 Reviews & Ratings E2E"',
    "Write Review",
    "REVIEW_ALREADY_EXISTS",
    "REVIEW_NOT_ELIGIBLE",
    '"Helpful"',
    '"hide"',
    '"publish"',
    '"/admin/reviews"',
    '"Review moderation"',
    "waitForSearchRating",
    "Excellent verified purchase",
    "verifiedPurchase: true",
    "customerUserId",
    "orderItemId",
  ]) requireText(e2e, proof, "Module 15 Playwright workflow");
  rejectText(e2e.toLowerCase(), "insert into ", "Module 15 Playwright workflow");
  rejectText(e2e.toLowerCase(), "update reviews ", "Module 15 Playwright workflow");
  rejectText(e2e.toLowerCase(), "delete from ", "Module 15 Playwright workflow");
}

/** Confirms post-browser verification is read-only and reconciles Review, aggregate, and Search truth. */
function verifyReleaseDataGate() {
  const releaseData = read("marketplace-backend/scripts/verify-module15-release-data.mjs");
  for (const proof of [
    "Module 15 E2E verified Review",
    "Module 15 Helpful vote",
    "Module 15 hide moderation history",
    "Module 15 publish moderation history",
    "Module 15 Review ownership snapshot reconciliation",
    "Module 15 full-delivery eligibility reconciliation",
    "Module 15 Product aggregate reconciliation",
    "Module 15 Seller aggregate reconciliation",
    "Module 15 Search rating synchronization",
    "rating.aggregate_updated",
  ]) requireText(releaseData, proof, "Module 15 release-data verifier");
  for (const forbidden of ["INSERT INTO", "UPDATE reviews", "DELETE FROM", "TRUNCATE", "DROP TABLE"]) {
    rejectText(releaseData.toUpperCase(), forbidden.toUpperCase(), "Read-only Module 15 release-data verifier");
  }
}

/** Confirms the approved eight-operation surface includes Patch 0011 without generic CRUD expansion. */
function verifyApprovedApiSurface() {
  const routes = read("marketplace-backend/src/modules/reviews/reviews.routes.ts");
  const frontendApi = read("marketplace-frontend/src/features/reviews/api/reviews.api.ts");
  requireText(routes, '"/api/v1/admin/reviews"', "Module 15 routes");
  requireText(frontendApi, 'apiClient.get("/admin/reviews"', "Module 15 frontend API");
  rejectText(routes, "router.delete(", "Module 15 routes");
  const patch = read("REQUIREMENTS_PATCH_0011_PROPOSED.md");
  requireText(patch, "Status: **APPROVED", "Requirements Patch 0011");
  requireText(patch, "exactly **eight** business operations", "Requirements Patch 0011");
}

/** Confirms package scripts keep durable backend/frontend Module 15 release commands only. */
function verifyPackageScripts() {
  const backend = JSON.parse(read("marketplace-backend/package.json"));
  const frontend = JSON.parse(read("marketplace-frontend/package.json"));
  const backendScripts = {
    "test:module15:migrations": "node scripts/verify-module15-migrations.mjs",
    "test:module15:contracts": "vitest run tests/module15/module15.schemas.test.ts",
    "test:module15:repository":
      "vitest run tests/module15/module15.schemas.test.ts tests/module15/module15.repository.test.ts",
    "test:module15:service": "vitest run tests/module15/module15.service.test.ts",
    "test:module15:http": "vitest run tests/module15/module15.http.test.ts",
    "test:module15:integration": "vitest run tests/module15/module15.integration.test.ts",
    "test:module15:specs": "vitest run tests/module15",
    "test:module15": "node scripts/run-module15-tests.mjs",
    "test:module15:release-data": "node scripts/verify-module15-release-data.mjs",
  };
  for (const [name, command] of Object.entries(backendScripts)) {
    if (backend.scripts?.[name] !== command) throw new Error(`Backend package.json must keep ${name}.`);
  }
  if (frontend.scripts?.["test:module15"] !== "vitest run tests/module15-reviews.test.tsx") {
    throw new Error("Frontend package.json must expose test:module15.");
  }
  if (frontend.scripts?.["test:e2e:module15"] !== "playwright test e2e/module15.spec.ts") {
    throw new Error("Frontend package.json must expose test:e2e:module15.");
  }
  for (const packageJson of [backend, frontend]) {
    for (const name of Object.keys(packageJson.scripts ?? {})) {
      if (/module15:pass[1-7]/u.test(name)) throw new Error(`Obsolete Module 15 pass script remains: ${name}`);
    }
  }
}

/** Confirms the permanent cross-repository E2E runner carries Module 15 through reconciliation. */
function verifyE2eRunner() {
  const runner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  for (const proof of [
    '"e2e/module15.spec.ts"',
    '"test:module15"',
    '"test:module15:release-data"',
    '"/api/v1/reviews"',
    '"/api/v1/products/{productId}/reviews"',
    '"/api/v1/stores/{storeId}/reviews"',
    '"/api/v1/admin/reviews"',
    '"/api/v1/admin/reviews/{id}/hide"',
    '"/api/v1/admin/reviews/{id}/publish"',
  ]) requireText(runner, proof, "Cross-repository Module 15 release runner");
}

/** Confirms CI and final verifiers use durable Module 15 commands. */
function verifyReleaseWiring() {
  const backendCi = read("marketplace-backend/.github/workflows/ci.yml");
  const frontendCi = read("marketplace-frontend/.github/workflows/ci.yml");
  const finalVerifier = read("scripts/verify-module15.mjs");
  requireText(backendCi, "npm run test:module15:migrations", "Backend CI");
  requireText(backendCi, "npm run test:module15:specs", "Backend CI");
  requireText(frontendCi, "npm run test:module15", "Frontend CI");
  for (const proof of [
    "verify-module15-static.mjs",
    "verify-http-contracts.mjs",
    "verify-backend-test-contracts.mjs",
    "verify-frontend-feature-contracts.mjs",
    '"test:e2e:ci"',
  ]) requireText(finalVerifier, proof, "Module 15 final release verifier");
}

/** Confirms the immutable Module 15 migration remains in the append-only history after later modules advance the head. */
function verifyMigrationFreeze() {
  const migrations = readdirSync(join(root, "marketplace-backend", "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  if (!migrations.includes("0031_reviews_ratings.sql")) {
    throw new Error("Module 15 migration 0031_reviews_ratings.sql must remain in append-only history.");
  }
}

verifyCleanup();
verifyPlaywrightWorkflow();
verifyReleaseDataGate();
verifyApprovedApiSurface();
verifyPackageScripts();
verifyE2eRunner();
verifyReleaseWiring();
verifyMigrationFreeze();
console.log("Module 15 permanent static release verification passed.");

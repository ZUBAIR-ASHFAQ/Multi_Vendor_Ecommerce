import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and reports a useful path when it is missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 8 file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one permanent contract fragment inside a Module 8 implementation file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects text that would violate Cart/Wishlist ownership or Inventory boundaries. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Rejects a source pattern that would weaken a permanent release gate. */
function rejectPattern(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`${label} contains a forbidden release-gate pattern: ${pattern}`);
  }
}

/** Runs the already accepted Module 19 structural gate before Module 8 checks. */
function verifyModule19Prerequisite() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module19-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Module 19 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms the independent frontend/backend project topology remains unchanged. */
function verifyIndependentProjects() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }
}

/** Confirms Module 8 persistence and its append-only migration remain present. */
function verifyDatabaseContract() {
  const schema = readProjectFile(
    "backend/src/database/schema/cart-wishlist.ts",
  );
  const migration = readProjectFile(
    "backend/drizzle/0017_cart_wishlist.sql",
  );
  const verifier = readProjectFile(
    "backend/scripts/verify-module8-migrations.mjs",
  );

  for (const tableName of ["carts", "cart_items", "wishlists", "wishlist_items"]) {
    requireText(schema, `"${tableName}"`, "Module 8 Drizzle schema");
    requireText(migration, `CREATE TABLE "${tableName}"`, "Module 8 migration");
  }

  for (const guard of [
    "cart_items_cart_variant_uq",
    "cart_items_quantity_positive_check",
    "wishlists_customer_default_uq",
  ]) {
    requireText(migration, guard, "Module 8 database integrity guard");
  }

  requireText(verifier, "Module 8 migration verification passed.", "Module 8 migration verifier");
}

/** Confirms the Module 8 Zod/errors/permissions contract remains narrow and server-owned. */
function verifyContracts() {
  const constants = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.constants.ts",
  );
  const schemas = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.schema.ts",
  );

  for (const permission of ["cart.manage_own", "wishlist.manage_own"]) {
    requireText(constants, permission, "Module 8 permission contract");
  }
  for (const code of [
    "CART_ITEM_NOT_FOUND",
    "CART_PRODUCT_UNAVAILABLE",
    "CART_QUANTITY_INVALID",
    "CART_CURRENCY_MISMATCH",
  ]) {
    requireText(constants, code, "Module 8 error contract");
  }
  for (const eventType of ["cart.item_added", "cart.item_removed", "wishlist.item_added"]) {
    requireText(constants, eventType, "Module 8 outbox event contract");
  }

  for (const schemaName of [
    "addCartItemBodySchema",
    "updateCartItemBodySchema",
    "addWishlistItemBodySchema",
    "cartResponseSchema",
    "wishlistResponseSchema",
  ]) {
    requireText(schemas, `export const ${schemaName}`, "Module 8 Zod contract");
  }

  rejectText(schemas, "customerUserId: uuidSchema", "Module 8 client ownership contract");
  rejectText(schemas, "sellerId: uuidSchema", "Module 8 client ownership contract");
}

/** Confirms repositories stay customer-scoped and services preserve Product/Inventory boundaries. */
function verifyRepositoryAndServiceBoundaries() {
  const repository = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.repository.ts",
  );
  const service = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.service.ts",
  );

  for (const method of [
    "findCartByCustomerUserId",
    "findCartItemByIdForCustomer",
    "updateCartItemQuantityForCustomer",
    "deleteCartItemForCustomer",
    "findDefaultWishlistByCustomerUserId",
    "deleteWishlistItemForCustomer",
  ]) {
    requireText(repository, method, "Module 8 customer-scoped repository");
  }

  for (const integration of [
    "CartWishlistProductIntegration",
    "CartWishlistInventoryIntegration",
    "CartWishlistCurrencyIntegration",
  ]) {
    requireText(service, integration, "Module 8 service integration boundary");
  }

  requireText(service, "previewSubtotal", "Module 8 preview-only Cart response");
  rejectText(service, "reserveStock", "Module 8 Inventory non-reservation boundary");
  rejectText(service, "stock_reservations", "Module 8 Inventory non-reservation boundary");
}

/** Confirms exactly the approved HTTP surface is mounted with no invented Cart lifecycle commands. */
function verifyHttpContract() {
  const routes = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.routes.ts",
  );
  const app = readProjectFile("backend/src/app.ts");

  for (const path of [
    '"/api/v1/cart"',
    '"/api/v1/cart/items"',
    '"/api/v1/cart/items/{id}"',
    '"/api/v1/wishlist"',
    '"/api/v1/wishlist/items"',
    '"/api/v1/wishlist/items/{id}"',
  ]) {
    requireText(routes, path, "Module 8 OpenAPI path");
  }

  for (const permission of [
    "CART_WISHLIST_PERMISSION.CART_MANAGE_OWN",
    "CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN",
  ]) {
    requireText(routes, permission, "Module 8 route permission middleware");
  }

  rejectText(routes, "/api/v1/cart/reserve", "Module 8 route surface");
  rejectText(routes, "/api/v1/cart/checkout", "Module 8 route surface");
  rejectText(routes, "move-to-cart", "Module 8 route surface");
  requireText(app, 'app.use(`${API_V1_PREFIX}/cart`, cartRouter);', "Module 8 Cart mount");
  requireText(app, 'app.use(`${API_V1_PREFIX}/wishlist`, wishlistRouter);', "Module 8 Wishlist mount");
}

/** Confirms Pass 6 backend tests and its repeatable local verification runner cannot disappear silently. */
function verifyBackendTests() {
  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));
  const runner = readProjectFile("backend/scripts/run-module8-tests.mjs");

  for (const relativePath of [
    "backend/tests/module8/module8.schemas.test.ts",
    "backend/tests/module8/module8.repository.test.ts",
    "backend/tests/module8/module8.service.test.ts",
    "backend/tests/module8/module8.integration.test.ts",
    "backend/tests/module8/module8.test-helpers.ts",
  ]) {
    readProjectFile(relativePath);
  }

  if (backendPackage.scripts?.["test:module8:specs"] !== "vitest run tests/module8") {
    throw new Error("Backend package is missing the focused Module 8 test command.");
  }
  if (backendPackage.scripts?.["test:module8"] !== "node scripts/run-module8-tests.mjs") {
    throw new Error("Backend package is missing the cumulative Module 8 backend test command.");
  }

  for (const command of [
    "test:module8:migrations",
    "test:module8:specs",
    "test:regression:contracts",
    "test:module19:specs",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, `"${command}"`, "Module 8 backend runner");
  }
}

/** Confirms the released Module 8 React feature uses the approved routes and state-management stack. */
function verifyFrontendFeature() {
  const packageJson = JSON.parse(readProjectFile("frontend/package.json"));
  const routes = readProjectFile("frontend/src/app/routes/cart-wishlist.routes.tsx");
  const api = readProjectFile("frontend/src/features/cart-wishlist/api/cart-wishlist.api.ts");
  const hooks = readProjectFile("frontend/src/features/cart-wishlist/hooks/use-cart-wishlist.ts");
  const form = readProjectFile("frontend/src/features/cart-wishlist/forms/cart-quantity.form.tsx");
  const cartPage = readProjectFile("frontend/src/features/cart-wishlist/pages/cart.page.tsx");
  const tests = readProjectFile("frontend/tests/module8-cart-wishlist.test.tsx");

  requireText(routes, 'path: "/cart"', "Module 8 Cart page route");
  requireText(routes, 'path: "/wishlist"', "Module 8 Wishlist page route");
  for (const endpoint of [
    'apiClient.get("/cart")',
    'apiClient.post("/cart/items", input)',
    'apiClient.get("/wishlist")',
    'apiClient.post("/wishlist/items", input)',
  ]) {
    requireText(api, endpoint, "Module 8 frontend API contract");
  }

  requireText(hooks, "useQuery({", "Module 8 TanStack Query state");
  requireText(hooks, "useMutation({", "Module 8 TanStack Query mutations");
  requireText(form, "useForm({", "Module 8 TanStack Form");
  requireText(form, "cartQuantityFormSchema", "Module 8 Zod form validation");
  requireText(cartPage, "Preview subtotal", "Module 8 preview-only Cart UI");
  requireText(cartPage, "Inventory is not reserved", "Module 8 Inventory non-reservation UI");
  requireText(tests, "moves a variant-bound Wishlist item only after Cart addition succeeds", "Module 8 move-to-Cart UI test");
  requireText(tests, "blocks an invalid Cart quantity before the PATCH request", "Module 8 validation UI test");
  requireText(tests, "shows the safe request ID and retries Cart loading", "Module 8 retry UI test");
  requireText(tests, "does not preload Cart data for a non-customer actor even if a stale permission is present", "Module 8 permission UI test");

  if (packageJson.scripts?.["test:module8"] !== "vitest run tests/module8-cart-wishlist.test.tsx") {
    throw new Error("Frontend package is missing the focused Module 8 test command.");
  }
}


/** Confirms Module 8 is part of the real Playwright and CI release gates. */
function verifyE2EReleaseGate() {
  const frontendPackage = JSON.parse(readProjectFile("frontend/package.json"));
  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));
  const e2eSpec = readProjectFile("frontend/e2e/module8.spec.ts");
  const e2eRunner = readProjectFile("frontend/e2e/run-e2e-ci.mjs");
  const frontendCi = readProjectFile("frontend/.github/workflows/ci.yml");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");
  const releaseData = readProjectFile(
    "backend/scripts/verify-module8-release-data.mjs",
  );
  const cumulativeRelease = readProjectFile("scripts/verify-module8.mjs");

  if (
    frontendPackage.scripts?.["test:e2e:module8"] !==
    "playwright test e2e/module8.spec.ts"
  ) {
    throw new Error("Frontend package is missing the focused Module 8 Playwright command.");
  }
  if (
    backendPackage.scripts?.["test:module8:release-data"] !==
    "node scripts/verify-module8-release-data.mjs"
  ) {
    throw new Error("Backend package is missing the Module 8 post-E2E integrity command.");
  }

  for (const required of [
    "adds, persists, updates, and displays a preview without reserving Inventory",
    "moves a Wishlist variant to Cart only after Cart addition succeeds",
    "shows current Product price and stock changes while preserving Cart intent",
    "removes a Cart line through the explicit remove command and can add it again later",
  ]) {
    requireText(e2eSpec, required, "Module 8 Playwright workflow");
  }

  requireText(e2eSpec, "inventoryAfter.reservedQty", "Module 8 Inventory non-reservation E2E proof");
  requireText(e2eSpec, "Current unit price: USD 31.00", "Module 8 current-price E2E proof");
  requireText(e2eRunner, '"e2e/module8.spec.ts"', "Module 8 E2E release runner");
  requireText(e2eRunner, '"/api/v1/cart"', "Module 8 live OpenAPI release check");
  requireText(e2eRunner, '"/api/v1/wishlist"', "Module 8 live OpenAPI release check");
  requireText(e2eRunner, '"test:module8:release-data"', "Module 8 post-E2E release check");
  requireText(frontendCi, "npm run test:module8", "Module 8 frontend CI gate");
  requireText(backendCi, "npm run test:module8:migrations", "Module 8 backend migration CI gate");
  requireText(backendCi, "npm run test:module8:specs", "Module 8 backend test CI gate");
  requireText(releaseData, "Module 8 post-E2E Cart/Wishlist integrity verification passed.", "Module 8 release-data verifier");
  requireText(cumulativeRelease, '"e2e/module8.spec.ts"', "Module 8 cumulative Playwright gate");
  requireText(cumulativeRelease, '"test:module8:migrations"', "Module 8 cumulative migration gate");
  requireText(cumulativeRelease, '"test:module8:release-data"', "Module 8 cumulative integrity gate");
}

/** Confirms Pass 8 keeps every implemented browser workflow in one strict cumulative release gate. */
function verifyPass8SourceGate() {
  const e2eRunner = readProjectFile("frontend/e2e/run-e2e-ci.mjs");
  const cumulativeRelease = readProjectFile("scripts/verify-module8.mjs");
  const expectedSpecs = [
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
  ];

  for (const specName of expectedSpecs) {
    const relativePath = `frontend/e2e/${specName}`;
    const spec = readProjectFile(relativePath);
    requireText(e2eRunner, `"e2e/${specName}"`, "Cross-repository Playwright runner");
    requireText(cumulativeRelease, `"e2e/${specName}"`, "Cumulative release verifier");
    rejectPattern(
      spec,
      /\b(?:test|it|describe)\.(?:skip|only|todo)\b/,
      `${specName} Playwright coverage`,
    );
    for (const forbidden of ["DATABASE_URL", "reset-test-database", "drizzle", "psql"]) {
      rejectText(spec, forbidden, `${specName} browser data boundary`);
    }
  }

  requireText(e2eRunner, '"--workers=1"', "Cross-repository Playwright serialization");
  requireText(cumulativeRelease, '"--workers=1"', "Cumulative Playwright serialization");
  requireText(cumulativeRelease, '"scripts/verify-http-contracts.mjs"', "Pass 8 HTTP contract gate");
  requireText(cumulativeRelease, '"scripts/verify-backend-test-contracts.mjs"', "Pass 8 backend test-contract gate");
  requireText(cumulativeRelease, '"scripts/verify-frontend-feature-contracts.mjs"', "Pass 8 frontend contract gate");
  requireText(cumulativeRelease, '"docker", ["build"', "Pass 8 container build gate");
}

/** Runs the cumulative structural verification for the completed Module 8 release. */
function main() {
  verifyModule19Prerequisite();
  verifyIndependentProjects();
  verifyDatabaseContract();
  verifyContracts();
  verifyRepositoryAndServiceBoundaries();
  verifyHttpContract();
  verifyBackendTests();
  verifyFrontendFeature();
  verifyE2EReleaseGate();
  verifyPass8SourceGate();
  console.log("Module 8 static verification passed.");
}

main();

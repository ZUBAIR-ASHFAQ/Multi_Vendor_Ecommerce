import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and reports a focused Checkout path when missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Checkout file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source), null, 2)
    : source;
}

/** Requires one permanent contract fragment in a source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one source fragment that would exceed the current Checkout pass boundary. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Requires one file to remain absent until a later Checkout pass owns it. */
function requireAbsent(relativePath, label) {
  if (existsSync(join(root, relativePath))) {
    throw new Error(`${label} must remain absent: ${relativePath}`);
  }
}

/** Runs the accepted Shipping Core structural gate before Checkout checks. */
function verifyShippingCorePrerequisite() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module13-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Shipping Core prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms frontend/backend remain independent projects rather than a workspace. */
function verifyIndependentProjects() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }
}

/** Confirms the hardened Checkout persistence remains intact for the Pass 4 service layer. */
function verifyCheckoutDatabaseFoundation() {
  const schema = readProjectFile("backend/src/database/schema/checkout.ts");
  const customerSchema = readProjectFile("backend/src/database/schema/customers.ts");
  const inventorySchema = readProjectFile("backend/src/database/schema/inventory.ts");
  const schemaIndex = readProjectFile("backend/src/database/schema/index.ts");
  const relations = readProjectFile("backend/src/database/relations.ts");
  const baseMigration = readProjectFile("backend/drizzle/0020_checkout.sql");
  const contractMigration = readProjectFile(
    "backend/drizzle/0022_checkout_contract_persistence.sql",
  );
  const verifier = readProjectFile("backend/scripts/verify-module10-migrations.mjs");
  const packageJson = readProjectFile("backend/package.json");

  for (const tableName of [
    '"checkout_quotes"',
    '"checkout_quote_lines"',
    '"checkout_attempts"',
  ]) {
    requireText(schema, tableName, "Checkout Drizzle schema");
    requireText(baseMigration, `CREATE TABLE ${tableName}`, "Checkout base migration");
  }
  requireText(
    schema,
    '"checkout_quote_shipping_selections"',
    "Checkout Shipping-selection Drizzle table",
  );
  requireText(
    contractMigration,
    'CREATE TABLE "checkout_quote_shipping_selections"',
    "Checkout Pass 3 shipping-selection migration",
  );

  for (const field of [
    '"shipping_address_id"',
    '"billing_address_id"',
    '"coupon_code"',
    '"store_id"',
    '"shipping_method_id"',
    '"shipping_method_code_snapshot"',
    '"shipping_method_name_snapshot"',
    '"amount"',
    '"currency"',
  ]) {
    requireText(contractMigration, field, "Checkout Pass 3 persistence field");
  }

  for (const guard of [
    "customer_addresses_id_customer_uq",
    "checkout_quotes_shipping_address_customer_fk",
    "checkout_quotes_billing_address_customer_fk",
    "checkout_quotes_addresses_present_check",
    "checkout_quotes_coupon_code_normalized_check",
    "checkout_quotes_state_hash_sha256_check",
    "checkout_quote_lines_store_seller_fk",
    "checkout_quote_lines_store_present_check",
    "checkout_quote_shipping_selections_pk",
    "checkout_quote_shipping_selections_store_seller_fk",
    "checkout_attempts_quote_uq",
  ]) {
    requireText(contractMigration, guard, "Checkout Pass 3 database integrity guard");
  }

  requireText(
    customerSchema,
    'uniqueIndex("customer_addresses_id_customer_uq")',
    "Customer/address composite ownership key",
  );
  requireText(schemaIndex, 'export * from "./checkout.js";', "Checkout schema export");
  requireText(relations, "checkoutQuotesRelations", "Checkout quote relations");
  requireText(relations, "checkoutQuoteLinesRelations", "Checkout quote-line relations");
  requireText(
    relations,
    "checkoutQuoteShippingSelectionsRelations",
    "Checkout shipping-selection relations",
  );
  requireText(relations, "checkoutAttemptsRelations", "Checkout attempt relations");
  requireText(
    relations,
    "checkoutAttempt: one(checkoutAttempts",
    "Inventory-to-Checkout relational metadata",
  );

  requireText(
    inventorySchema,
    "legacy reservations may contain opaque",
    "Backward-compatible Inventory attempt-ID decision",
  );
  requireText(
    contractMigration,
    'DROP INDEX "checkout_attempts_id_customer_uq"',
    "Redundant Checkout attempt index cleanup",
  );

  for (const forbiddenTable of [
    'CREATE TABLE "orders"',
    'CREATE TABLE "seller_orders"',
    'CREATE TABLE "payments"',
  ]) {
    rejectText(contractMigration, forbiddenTable, "Later-module persistence in Checkout migration");
  }

  requireText(
    verifier,
    "Module 10 Checkout migration verification passed.",
    "Checkout migration verifier",
  );
  requireText(
    verifier,
    "preserves legacy Checkout rows and opaque pre-Checkout reservation attempt identifiers",
    "Checkout supported-upgrade compatibility proof",
  );
  requireText(
    packageJson,
    '"test:module10:migrations": "node scripts/verify-module10-migrations.mjs"',
    "Checkout migration package script",
  );
}

/** Confirms Pass 5 exposes the approved request, header, and persisted response contracts from Patch 0004. */
function verifyCheckoutContracts() {
  const constants = readProjectFile(
    "backend/src/modules/checkout/checkout.constants.ts",
  );
  const schema = readProjectFile(
    "backend/src/modules/checkout/checkout.schema.ts",
  );
  const moduleIndex = readProjectFile(
    "backend/src/modules/checkout/index.ts",
  );
  const rbacSeed = readProjectFile(
    "backend/src/database/seeds/platform-rbac.seed.ts",
  );

  for (const permission of ["checkout.create_own", "checkout.confirm_own"]) {
    requireText(constants, permission, "Checkout permission contract");
  }

  for (const errorCode of [
    "CHECKOUT_QUOTE_EXPIRED",
    "CHECKOUT_PRICE_CHANGED",
    "CHECKOUT_STOCK_CHANGED",
    "CHECKOUT_PROMOTION_CHANGED",
    "CHECKOUT_ADDRESS_INVALID",
    "CHECKOUT_IDEMPOTENCY_CONFLICT",
  ]) {
    requireText(constants, errorCode, "Checkout error-code contract");
  }

  for (const eventName of [
    "checkout.quoted",
    "checkout.confirmed",
    "checkout.expired",
    "checkout.failed",
  ]) {
    requireText(constants, eventName, "Checkout outbox-event contract");
  }

  for (const routePath of [
    "/api/v1/checkout/quote",
    "/api/v1/checkout/quote/:id",
    "/api/v1/checkout/quote/:id/confirm",
    "/api/v1/checkout/:attemptId/status",
  ]) {
    requireText(constants, routePath, "Checkout approved-route contract");
  }

  for (const sourceContract of [
    "checkoutMoneySchema",
    "checkoutCurrencySchema",
    "checkoutCouponCodeSchema",
    "checkoutStateHashSchema",
    "checkoutAttemptStatusSchema",
    "checkoutIdempotencyKeySchema",
    "checkoutQuoteIdParamsSchema",
    "checkoutAttemptIdParamsSchema",
    "checkoutQuoteLineContractSchema",
    "checkoutQuoteShippingSelectionContractSchema",
    "checkoutQuoteContractSchema",
    "checkoutQuoteWithLinesContractSchema",
    "checkoutAttemptContractSchema",
  ]) {
    requireText(schema, sourceContract, "Checkout persisted Zod contract");
  }

  for (const approvedField of [
    "shippingAddressId",
    "billingAddressId",
    "couponCode",
    "storeId",
    "shippingMethodId",
    "shippingMethodCode",
    "shippingMethodName",
    "shippingSelections",
  ]) {
    requireText(schema, approvedField, "Checkout Patch 0004 persisted response field");
  }

  requireText(schema, "/^[0-9a-f]{64}$/", "Checkout SHA-256 state-hash contract");
  requireText(
    schema,
    "Patch 0004 limits Module 10 writes",
    "Checkout approved attempt-status documentation",
  );
  requireText(
    schema,
    "Patch 0004 required Idempotency-Key confirmation header",
    "Checkout approved idempotency transport documentation",
  );
  requireText(moduleIndex, 'export * from "./checkout.constants.js";', "Checkout module constant export");
  requireText(moduleIndex, 'export * from "./checkout.schema.js";', "Checkout module schema export");

  requireText(rbacSeed, "...CHECKOUT_PERMISSION_CATALOG", "Checkout permission catalog composition");
  requireText(rbacSeed, "CHECKOUT_PERMISSION.CREATE_OWN", "Customer Checkout create permission grant");
  requireText(rbacSeed, "CHECKOUT_PERMISSION.CONFIRM_OWN", "Customer Checkout confirm permission grant");

  for (const executableContract of [
    "checkoutShippingSelectionInputSchema",
    "createCheckoutQuoteBodySchema",
    "confirmCheckoutQuoteBodySchema",
    "CreateCheckoutQuoteInput",
    "ConfirmCheckoutQuoteInput",
    "checkoutConfirmHeadersSchema",
  ]) {
    requireText(schema, executableContract, "Checkout Pass 5 HTTP/request contract");
  }
}

/** Confirms persistence exposes only the operations needed by the frozen Checkout service. */
function verifyCheckoutRepository() {
  const repository = readProjectFile(
    "backend/src/modules/checkout/checkout.repository.ts",
  );
  const moduleIndex = readProjectFile(
    "backend/src/modules/checkout/index.ts",
  );

  for (const methodName of [
    "createQuote",
    "createQuoteLines",
    "createQuoteShippingSelections",
    "findQuoteForCustomer",
    "lockQuoteForCustomer",
    "listQuoteLinesForCustomer",
    "listQuoteShippingSelectionsForCustomer",
    "findAttemptByQuoteForCustomer",
    "createAttempt",
    "attachOrderToAttempt",
    "findAttemptForCustomer",
  ]) {
    requireText(repository, methodName, "Checkout repository operation");
  }

  for (const requiredField of [
    "shippingAddressId",
    "billingAddressId",
    "couponCode",
    "storeId",
    "shippingMethodId",
    "shippingMethodCodeSnapshot",
    "shippingMethodNameSnapshot",
  ]) {
    requireText(repository, requiredField, "Checkout Pass 3 repository persistence field");
  }

  for (const ownershipGuard of [
    "eq(checkoutQuotes.customerUserId, customerUserId)",
    "eq(checkoutAttempts.customerUserId, customerUserId)",
    "eq(checkoutAttempts.quoteId, quoteId)",
    '.for("update")',
  ]) {
    requireText(repository, ownershipGuard, "Checkout repository ownership/transaction guard");
  }

  requireText(
    repository,
    "constructor(private readonly executor: DatabaseExecutor = db)",
    "Checkout repository transaction-compatible executor",
  );
  requireText(moduleIndex, 'export * from "./checkout.repository.js";', "Checkout repository module export");

  for (const forbiddenImport of [
    "cart-wishlist.repository",
    "customers.repository",
    "inventory.repository",
    "products.repository",
    "promotions.repository",
    "sellers.repository",
    "shipping.repository",
  ]) {
    rejectText(repository, forbiddenImport, "Checkout repository cross-module repository bypass");
  }

  for (const forbiddenDecision of [
    "CHECKOUT_PRICE_CHANGED",
    "CHECKOUT_STOCK_CHANGED",
    "CHECKOUT_PROMOTION_CHANGED",
    "CHECKOUT_ADDRESS_INVALID",
    "taxRate",
    "quoteTtl",
    "reservationTtl",
  ]) {
    rejectText(repository, forbiddenDecision, "Checkout repository business-policy decision");
  }
}

/** Confirms Pass 2 exposes only the narrow prerequisite service boundaries Checkout needs next. */
function verifyCheckoutPrerequisiteServices() {
  const cartService = readProjectFile(
    "backend/src/modules/cart-wishlist/cart-wishlist.service.ts",
  );
  const customersService = readProjectFile(
    "backend/src/modules/customers/customers.service.ts",
  );
  const productsService = readProjectFile(
    "backend/src/modules/products/products.service.ts",
  );
  const checkoutRepository = readProjectFile(
    "backend/src/modules/checkout/checkout.repository.ts",
  );
  const inventoryService = readProjectFile(
    "backend/src/modules/inventory/inventory.service.ts",
  );
  const inventoryRepository = readProjectFile(
    "backend/src/modules/inventory/inventory.repository.ts",
  );
  const promotionsService = readProjectFile(
    "backend/src/modules/promotions/promotions.service.ts",
  );
  const administrationService = readProjectFile(
    "backend/src/modules/administration/administration.service.ts",
  );
  const prerequisiteTests = readProjectFile(
    "backend/tests/module10/module10.prerequisite-services.test.ts",
  );

  requireText(
    cartService,
    "async getCheckoutCart(",
    "Checkout trusted Cart-intent resolver",
  );
  requireText(
    customersService,
    "async resolveActiveOwnedAddress(",
    "Checkout customer-owned address resolver",
  );
  requireText(
    productsService,
    "async resolveVariantForCheckout(",
    "Checkout Product variant resolver",
  );
  requireText(
    inventoryRepository,
    "async listAvailabilityByVariantIds(",
    "Checkout Inventory authoritative balance read",
  );
  requireText(
    inventoryService,
    "static using(transaction: DatabaseTransaction)",
    "Checkout Inventory transaction composition",
  );
  requireText(
    inventoryService,
    "async getCheckoutAvailability(",
    "Checkout quantity-aware Inventory service read",
  );
  requireText(
    promotionsService,
    "async calculateCheckoutDiscounts(",
    "Checkout authoritative Promotion evaluator",
  );
  requireText(
    promotionsService,
    "static using(transaction: DatabaseTransaction)",
    "Checkout transaction-bound Promotion composition",
  );
  requireText(
    promotionsService,
    "async recordCouponRedemption(",
    "Checkout transaction-bound coupon redemption command",
  );
  requireText(
    promotionsService,
    "scale4ToMoney",
    "Checkout scale-4 Promotion arithmetic",
  );
  requireText(
    administrationService,
    "async getDefaultTaxRatePercent()",
    "Checkout Administration tax-setting resolver",
  );
  requireText(
    administrationService,
    "at most four decimal places",
    "Checkout tax-rate precision guard",
  );

  for (const proof of [
    "returns the full active address owned by the authenticated customer",
    "resolves only a current active public Product variant for Checkout",
    "checks exact requested Inventory quantities instead of only positive stock",
    "authoritative Checkout coupon allocation with exact scale-4 half-up rounding",
    "canonical Checkout percentage string",
  ]) {
    requireText(prerequisiteTests, proof, "Checkout Pass 2 prerequisite test");
  }
}

/** Confirms Pass 5 retains the authoritative Checkout business service behind the new thin HTTP layer. */
function verifyCheckoutServiceGate() {
  const shippingPatch = readProjectFile("REQUIREMENTS_PATCH_0003.md");
  const checkoutPatch = readProjectFile("REQUIREMENTS_PATCH_0004.md");
  const service = readProjectFile(
    "backend/src/modules/checkout/checkout.service.ts",
  );
  const schema = readProjectFile(
    "backend/src/modules/checkout/checkout.schema.ts",
  );
  const constants = readProjectFile(
    "backend/src/modules/checkout/checkout.constants.ts",
  );
  const moduleIndex = readProjectFile(
    "backend/src/modules/checkout/index.ts",
  );
  const env = readProjectFile("backend/src/config/env.ts");
  const envExample = readProjectFile("backend/.env.example");
  const checkoutRepository = readProjectFile(
    "backend/src/modules/checkout/checkout.repository.ts",
  );
  const inventoryService = readProjectFile(
    "backend/src/modules/inventory/inventory.service.ts",
  );
  const inventoryRepository = readProjectFile(
    "backend/src/modules/inventory/inventory.repository.ts",
  );

  requireText(
    shippingPatch,
    "Status: APPROVED additive contract patch for the current implementation.",
    "Approved Shipping Core contract status",
  );

  for (const required of [
    "Status: APPROVED additive contract patch for the current implementation.",
    '"shippingAddressId": "uuid"',
    '"shippingMethodId": "uuid"',
    "CHECKOUT_QUOTE_TTL_SECONDS=900",
    "CHECKOUT_ATTEMPT_TTL_SECONDS=900",
    "checkout-state-v1",
    "Idempotency-Key",
    "checkout.confirm:<customerUserId>",
    "checkout_attempts.quote_id",
    "checkout:<attemptId>:<variantId>",
  ]) {
    requireText(checkoutPatch, required, "Approved Checkout Pass 0 contract");
  }

  for (const method of [
    "async createQuote(",
    "async getQuote(",
    "async confirmQuote(",
    "async getAttemptStatus(",
  ]) {
    requireText(service, method, "Checkout Pass 4 service operation");
  }

  for (const rule of [
    "CHECKOUT_STATE_VERSION",
    "CHECKOUT_CONFIRM_REQUEST_VERSION",
    "CHECKOUT_IDEMPOTENCY_SCOPE_PREFIX",
    "buildAuthoritativeSnapshot",
    "buildStateHash",
    "buildConfirmationRequestHash",
    "lockQuoteForCustomer",
    "findAttemptByQuoteForCustomer",
    "reserveStock",
    "checkout:${attempt.id}:${line.variantId}",
    "this.ordersUsingTransaction(transaction).createFromCheckout(",
    "attachOrderToAttempt",
    "this.promotionsUsingTransaction(transaction).recordCouponRedemption(",
    "await this.recordCouponRedemption(",
    "CHECKOUT_OUTBOX_EVENT.QUOTED",
    "CHECKOUT_OUTBOX_EVENT.CONFIRMED",
  ]) {
    requireText(`${service}\n${inventoryService}`, rule, "Checkout executable service rule");
  }

  for (const serviceBoundary of [
    "CustomersService",
    "CartWishlistService",
    "ProductsService",
    "InventoryService",
    "PromotionsService",
    "CheckoutPromotionTransactionIntegration",
    "promotionsUsingTransaction?:",
    "ShippingService",
    "AdministrationService",
    "IdempotencyService",
  ]) {
    requireText(service, serviceBoundary, "Checkout service-boundary composition");
  }

  for (const forbiddenRepositoryImport of [
    "cart-wishlist.repository",
    "customers.repository",
    "products.repository",
    "promotions.repository",
    "shipping.repository",
    "administration.repository",
  ]) {
    rejectText(service, forbiddenRepositoryImport, "Checkout cross-module repository bypass");
  }

  for (const ttl of ["CHECKOUT_QUOTE_TTL_SECONDS", "CHECKOUT_ATTEMPT_TTL_SECONDS"]) {
    requireText(env, ttl, "Typed Checkout TTL environment setting");
    requireText(envExample, `${ttl}=900`, "Checkout TTL .env example");
  }

  for (const requestContract of [
    "createCheckoutQuoteBodySchema",
    "confirmCheckoutQuoteBodySchema",
    "checkoutConfirmHeadersSchema",
  ]) {
    requireText(schema, requestContract, "Checkout HTTP/request schema");
  }

  for (const constant of [
    'CONFIRMED: "confirmed"',
    'EXPIRED: "expired"',
    'FAILED: "failed"',
    'CHECKOUT_STATE_VERSION = "checkout-state-v1"',
    'CHECKOUT_CONFIRM_REQUEST_VERSION = "checkout-confirm-v1"',
    'CHECKOUT_IDEMPOTENCY_SCOPE_PREFIX = "checkout.confirm"',
  ]) {
    requireText(constants, constant, "Checkout fixed constant");
  }

  requireText(moduleIndex, 'export * from "./checkout.service.js";', "Checkout service module export");
  requireText(
    checkoutRepository,
    "attachOrderToAttempt",
    "Post-Module-11 Checkout attempt to Order link",
  );
  requireText(
    service,
    "this.ordersUsingTransaction(transaction).createFromCheckout(",
    "Post-Module-11 atomic Checkout to Order composition",
  );

}

/** Confirms Pass 5 publishes exactly the approved four Checkout routes with thin controllers, RBAC, and OpenAPI. */
function verifyCheckoutHttpGate() {
  const controller = readProjectFile(
    "backend/src/modules/checkout/checkout.controller.ts",
  );
  const routes = readProjectFile(
    "backend/src/modules/checkout/checkout.routes.ts",
  );
  const schema = readProjectFile(
    "backend/src/modules/checkout/checkout.schema.ts",
  );
  const moduleIndex = readProjectFile(
    "backend/src/modules/checkout/index.ts",
  );
  const app = readProjectFile("backend/src/app.ts");
  const openApiDocument = readProjectFile(
    "backend/src/http/openapi/openapi.document.ts",
  );

  for (const method of [
    "createQuote = async (",
    "getQuote = async (",
    "confirmQuote = async (",
    "getAttemptStatus = async (",
  ]) {
    requireText(controller, method, "Checkout thin controller operation");
  }

  for (const parser of [
    "createCheckoutQuoteBodySchema.parse(request.body)",
    "checkoutQuoteIdParamsSchema.parse(request.params)",
    "confirmCheckoutQuoteBodySchema.parse(request.body)",
    "checkoutConfirmHeadersSchema.parse(request.headers)",
    "checkoutAttemptIdParamsSchema.parse(request.params)",
  ]) {
    requireText(controller, parser, "Checkout controller Zod boundary");
  }

  for (const call of [
    "this.checkoutService.createQuote(",
    "this.checkoutService.getQuote(",
    "this.checkoutService.confirmQuote(",
    "this.checkoutService.getAttemptStatus(",
  ]) {
    requireText(controller, call, "Checkout controller service delegation");
  }

  for (const forbidden of [".repository.js", "/database/", "new CheckoutRepository"] ) {
    rejectText(controller, forbidden, "Checkout controller persistence bypass");
  }

  for (const runtimeRoute of [
    'router.post(\n    "/quote"',
    'router.get(\n    "/quote/:id"',
    'router.post(\n    "/quote/:id/confirm"',
    'router.get(\n    "/:attemptId/status"',
  ]) {
    requireText(routes, runtimeRoute, "Checkout approved runtime route");
  }

  requireText(routes, "router.use(authenticationMiddleware)", "Checkout authentication middleware");
  requireText(
    routes,
    "requirePermission(CHECKOUT_PERMISSION.CREATE_OWN)",
    "Checkout create/read route RBAC",
  );
  requireText(
    routes,
    "requirePermission(CHECKOUT_PERMISSION.CONFIRM_OWN)",
    "Checkout confirm/status route RBAC",
  );
  requireText(
    routes,
    'name: "Idempotency-Key"',
    "Checkout confirmation Idempotency-Key OpenAPI header",
  );
  requireText(
    routes,
    'objectPropertySchema(checkoutConfirmHeadersSchema, "idempotency-key")',
    "Checkout confirmation header schema reuse",
  );

  for (const openApiPath of [
    '"/api/v1/checkout/quote"',
    '"/api/v1/checkout/quote/{id}"',
    '"/api/v1/checkout/quote/{id}/confirm"',
    '"/api/v1/checkout/{attemptId}/status"',
  ]) {
    requireText(routes, openApiPath, "Checkout approved OpenAPI path");
  }
  requireText(routes, 'tags: ["Checkout"]', "Checkout OpenAPI tag usage");
  requireText(routes, "checkoutQuoteWithLinesContractSchema", "Checkout quote OpenAPI response contract");
  requireText(routes, "checkoutAttemptContractSchema", "Checkout attempt OpenAPI response contract");
  requireText(schema, '"idempotency-key": checkoutIdempotencyKeySchema', "Checkout runtime confirmation-header schema");

  requireText(moduleIndex, 'export * from "./checkout.controller.js";', "Checkout controller module export");
  requireText(moduleIndex, 'export * from "./checkout.routes.js";', "Checkout routes module export");

  for (const composition of [
    'from "./modules/checkout/index.js"',
    "const checkoutService = new CheckoutService({",
    "const checkoutController = new CheckoutController(checkoutService)",
    "checkout: createCheckoutRouter(checkoutController)",
    'app.use(`${API_V1_PREFIX}/checkout`, checkoutRouter);',
  ]) {
    requireText(app, composition, "Checkout application composition");
  }

  for (const sharedBoundary of [
    "customers: customersService",
    "cart: cartWishlistService",
    "products: productsService",
    "inventory: inventoryService",
    "promotions: promotionsService",
    "shipping: shippingService",
    "administration: administrationService",
  ]) {
    requireText(app, sharedBoundary, "Checkout composed prerequisite service");
  }

  requireText(openApiDocument, "checkoutOpenApiPaths", "Checkout OpenAPI import");
  requireText(openApiDocument, 'name: "Checkout"', "Checkout OpenAPI tag");
  requireText(openApiDocument, "...checkoutOpenApiPaths", "Checkout OpenAPI registry");

}

/** Confirms Pass 6 adds direct Checkout service and Supertest/PostgreSQL regression proof. */
function verifyCheckoutBackendProof() {
  const schemas = readProjectFile(
    "backend/tests/module10/module10.schemas.test.ts",
  );
  const repository = readProjectFile(
    "backend/tests/module10/module10.repository.test.ts",
  );
  const service = readProjectFile(
    "backend/tests/module10/module10.service.test.ts",
  );
  const integration = readProjectFile(
    "backend/tests/module10/module10.integration.test.ts",
  );
  const helpers = readProjectFile(
    "backend/tests/module10/module10.test-helpers.ts",
  );
  const runner = readProjectFile(
    "backend/scripts/run-module10-tests.mjs",
  );
  const backendPackage = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  for (const proof of [
    "keeps the approved permissions, errors, events, and four route paths stable",
    "keeps Checkout money exact for the persisted NUMERIC(18,4) boundary",
    "requires the approved lowercase SHA-256 Checkout state hash",
    "matches the approved Patch 0004 persisted quote response including store and Shipping snapshots",
    "normalizes the persisted coupon code and validates the confirmation idempotency key value",
    "validates the required normalized Idempotency-Key HTTP header",
  ]) {
    requireText(schemas, proof, "Checkout persisted schema tests");
  }

  for (const proof of [
    "persists Patch 0004 addresses, store lines, and shipping selections while keeping reads customer-scoped",
    "finds the existing attempt by quote and enforces one attempt per quote",
    "rejects cross-customer addresses and duplicate store shipping selections in PostgreSQL",
    "keeps the redundant attempt id/customer index removed while preserving the primary key",
    "lockQuoteForCustomer",
  ]) {
    requireText(repository, proof, "Checkout repository tests");
  }

  for (const proof of [
    "maps a non-owned or missing address to CHECKOUT_ADDRESS_INVALID before persistence",
    "rejects exact requested quantity when current Inventory is insufficient",
    "fails closed when the Cart currency is no longer supported before Promotion persistence is read",
    "keeps another customer's quote non-enumerating at the service boundary",
    "rejects an expired customer-owned quote before reading quote lines",
    "replays a completed confirmation without opening another database transaction",
    "validates confirmation state-hash and retry-key input before touching idempotency storage",
  ]) {
    requireText(service, proof, "Checkout Pass 6 service tests");
  }

  for (const proof of [
    "creates authoritative totals, confirms exactly once, replays the same key, and exposes attempt status",
    "missingHeader.body.error.code",
    "hiddenAttempt.body.error.code",
    "keeps a confirmed Checkout linked to its Order and leaves overdue unpaid expiry to Module 12",
    "enforces authentication, route permissions, customer quote isolation, and customer-owned addresses",
    "rejects confirmation when a selected customer address changes after quote creation",
    "rejects an expired quote before creating an attempt or reserving stock",
    "detects a Product price change between quote and confirmation",
    "detects a Product becoming unpublished between quote and confirmation",
    "detects exact-quantity stock loss between quote and confirmation",
    "records an applied coupon exactly once inside Checkout confirmation",
    "serializes the last coupon use across concurrent confirmations and rolls back the losing Checkout transaction",
    "rolls back coupon redemption when a later Checkout write fails in the same confirmation transaction",
    "detects a coupon becoming ineligible between quote and confirmation",
    "detects a Shipping rate change through authoritative confirmation revalidation",
    "detects an Administration tax change through authoritative confirmation revalidation",
    "maps one reused idempotency key with a different quote payload to CHECKOUT_IDEMPOTENCY_CONFLICT",
    "serializes different-key concurrent confirmations into one attempt and one reservation set",
    "rolls back the attempt and the first reservation when a later reservation write fails",
    "persists one Shipping selection per server-derived seller/store group",
    "rejects a currency removed from Administration support before quote persistence",
    '.post("/api/v1/checkout/quote")',
    'Idempotency-Key',
  ]) {
    requireText(integration, proof, "Checkout Pass 6 Supertest/PostgreSQL proof");
  }

  for (const proof of [
    "setCheckoutTaxRate",
    "setSupportedCurrencies",
    "createCheckoutQuoteViaHttp",
    "confirmCheckoutQuoteViaHttp",
    "readCheckoutAttemptPersistence",
    "countCheckoutOutboxEvents",
  ]) {
    requireText(helpers, proof, "Checkout Pass 6 test helper");
  }

  for (const proof of [
    '"test:module10:specs": "vitest run tests/module10"',
    '"test:module10": "node scripts/run-module10-tests.mjs"',
  ]) {
    requireText(backendPackage, proof, "Checkout Pass 6 package command");
  }
  requireText(runner, "test:module10:migrations", "Checkout Pass 6 full runner migration gate");
  requireText(runner, "test:module10:specs", "Checkout Pass 6 full runner focused suite");
  requireText(runner, "test:module13:specs", "Checkout Pass 6 prerequisite regression suite");
  requireText(runner, "typecheck", "Checkout Pass 6 typecheck gate");
  requireText(runner, "lint", "Checkout Pass 6 lint gate");
  requireText(runner, "build", "Checkout Pass 6 build gate");
  requireText(
    backendCi,
    "npm run test:module10:migrations",
    "Checkout Pass 6 migration CI gate",
  );
  requireText(
    backendCi,
    "npm run test:module10:specs",
    "Checkout Pass 6 service/API CI gate",
  );
}


/** Confirms Pass 7 publishes the required Checkout React feature and focused RTL/MSW proof. */
function verifyCheckoutFrontendGate() {
  const frontendPackage = readProjectFile("frontend/package.json");
  const frontendRouter = readProjectFile("frontend/src/app/router/router.tsx");
  const checkoutRoutes = readProjectFile("frontend/src/app/routes/checkout.routes.tsx");
  const checkoutApi = readProjectFile("frontend/src/features/checkout/api/checkout.api.ts");
  const checkoutHooks = readProjectFile("frontend/src/features/checkout/hooks/use-checkout.ts");
  const checkoutForm = readProjectFile("frontend/src/features/checkout/forms/checkout-quote.form.tsx");
  const checkoutPage = readProjectFile("frontend/src/features/checkout/pages/checkout.page.tsx");
  const checkoutTests = readProjectFile("frontend/tests/module10-checkout.test.tsx");
  const frontendContracts = readProjectFile("scripts/verify-frontend-feature-contracts.mjs");

  for (const requiredPath of [
    "frontend/src/features/checkout/api/checkout.api.ts",
    "frontend/src/features/checkout/hooks/use-checkout.ts",
    "frontend/src/features/checkout/forms/checkout-quote.form.tsx",
    "frontend/src/features/checkout/schemas/checkout.schemas.ts",
    "frontend/src/features/checkout/types/checkout.types.ts",
    "frontend/src/features/checkout/components/checkout-layout.tsx",
    "frontend/src/features/checkout/components/checkout-stepper.tsx",
    "frontend/src/features/checkout/components/checkout-quote-summary.tsx",
    "frontend/src/features/checkout/components/checkout-change-warning.tsx",
    "frontend/src/features/checkout/components/checkout-expiry-warning.tsx",
    "frontend/src/features/checkout/pages/checkout.page.tsx",
    "frontend/src/app/routes/checkout.routes.tsx",
    "frontend/tests/module10-checkout.test.tsx",
  ]) {
    readProjectFile(requiredPath);
  }

  requireText(checkoutRoutes, 'path: "/checkout"', "Checkout frontend route");
  requireText(frontendRouter, 'from "@/app/routes/checkout.routes"', "Checkout frontend router import");
  requireText(frontendRouter, "checkoutRoute,", "Checkout frontend router registration");

  for (const endpoint of [
    'apiClient.get("/checkout/shipping-options"',
    'apiClient.post("/checkout/quote", input)',
    'apiClient.get(`/checkout/quote/${quoteId}`)',
    '`/checkout/quote/${quoteId}/confirm`',
    'apiClient.get(`/checkout/${attemptId}/status`)',
    '"Idempotency-Key": idempotencyKey',
  ]) {
    requireText(checkoutApi, endpoint, "Checkout frontend API contract");
  }

  requireText(checkoutHooks, "useQuery({", "Checkout TanStack Query ownership");
  requireText(checkoutHooks, "useMutation({", "Checkout TanStack mutation ownership");
  requireText(checkoutForm, "useForm({", "Checkout TanStack Form ownership");
  requireText(checkoutForm, "checkoutQuoteFormSchema", "Checkout Zod form validation");
  requireText(checkoutPage, "CheckoutStepper", "Checkout stepper composition");
  requireText(checkoutPage, "CheckoutQuoteSummary", "Checkout quote summary composition");
  requireText(checkoutPage, "CheckoutExpiryWarning", "Checkout quote expiry warning");
  requireText(checkoutPage, "CheckoutChangeWarning", "Checkout stale-state warning");
  requireText(checkoutPage, "Confirm & pay", "Checkout confirm-and-pay action");
  requireText(checkoutPage, "Payment is completed only after secure confirmation from Stripe.", "Checkout Payment separation");

  for (const proof of [
    "creates an authoritative quote without sending client totals and confirms it with the required retry key",
    "shows a quote-change warning with the safe request ID when confirmation detects a stale price",
    "shows an expired-quote warning and disables confirmation until the customer recalculates",
    "blocks the Checkout feature before Cart or address reads when the customer lacks checkout.create_own",
    "requires an active saved address before requesting Shipping Core options",
  ]) {
    requireText(checkoutTests, proof, "Checkout RTL/MSW proof");
  }

  requireText(frontendPackage, '"test:module10": "vitest run tests/module10-checkout.test.tsx"', "Checkout frontend focused test command");
  requireText(frontendPackage, '"test:e2e:module10": "playwright test e2e/module10.spec.ts"', "Checkout focused Playwright command");
  requireText(frontendContracts, "verifyCheckoutFeature", "Checkout permanent frontend contract guard");
}

/** Confirms Pass 8 adds real browser proof, post-browser data integrity, and one full release verifier. */
function verifyCheckoutE2EGate() {
  const frontendPackage = readProjectFile("frontend/package.json");
  const backendPackage = readProjectFile("backend/package.json");
  const e2eSpec = readProjectFile("frontend/e2e/module10.spec.ts");
  const e2eRunner = readProjectFile("frontend/e2e/run-e2e-ci.mjs");
  const seed = readProjectFile("backend/src/database/seeds/module10-e2e.seed.ts");
  const releaseData = readProjectFile("backend/scripts/verify-module10-release-data.mjs");
  const releaseVerifier = readProjectFile("scripts/verify-module10.mjs");
  const frontendCi = readProjectFile("frontend/.github/workflows/ci.yml");
  const shippingPatch = readProjectFile("REQUIREMENTS_PATCH_0003.md");
  const checkoutPatch = readProjectFile("REQUIREMENTS_PATCH_0004.md");

  for (const proof of [
    "creates an authoritative quote in the UI, confirms it idempotently, and reserves exact stock",
    "shows the real Checkout change warning when Product price changes after quoting",
    'not.toHaveProperty("subtotal")',
    'not.toHaveProperty("grandTotal")',
    '"idempotency-key"',
    "CHECKOUT_PRICE_CHANGED",
    "reservedQty: 2",
  ]) {
    requireText(e2eSpec, proof, "Checkout Pass 8 Playwright proof");
  }

  requireText(seed, "seedModule10E2eShippingMethod", "Checkout test-only Shipping seed");
  requireText(seed, "cannot run in production", "Checkout E2E seed production guard");
  requireText(seed, "E2E Checkout Standard", "Checkout deterministic Shipping fixture");

  for (const proof of [
    "Module 10 authoritative quote E2E",
    "Checkout quote aggregate reconciliation",
    "Checkout Shipping selection seller/store coverage",
    "Checkout confirmed reservation coverage",
    "Checkout duplicate attempt per quote",
    "checkout.quoted",
    "checkout.confirmed",
  ]) {
    requireText(releaseData, proof, "Checkout Pass 8 post-browser data proof");
  }

  requireText(frontendPackage, '"test:e2e:module10": "playwright test e2e/module10.spec.ts"', "Checkout Playwright package command");
  requireText(backendPackage, '"db:seed:module10-e2e": "tsx src/database/seeds/module10-e2e.seed.ts"', "Checkout E2E seed package command");
  requireText(backendPackage, '"test:module10:release-data": "node scripts/verify-module10-release-data.mjs"', "Checkout release-data package command");

  for (const runnerProof of [
    "db:seed:module10-e2e",
    "/api/v1/checkout/quote",
    "e2e/module10.spec.ts",
    "test:module10:release-data",
  ]) {
    requireText(e2eRunner, runnerProof, "Checkout cumulative E2E release runner");
  }

  for (const releaseProof of [
    "runStaticDependencyChain",
    '["run", "test:module10"]',
    '["run", "test:module10"]',
    '["run", "test:e2e:ci"]',
    "Module 10 Checkout full release verification completed successfully.",
  ]) {
    requireText(releaseVerifier, releaseProof, "Checkout full release verifier");
  }

  requireText(frontendCi, "npm run test:module10", "Checkout frontend CI regression gate");
  requireText(
    shippingPatch,
    "Status: APPROVED additive contract patch for the current implementation.",
    "Shipping Core approved patch status",
  );
  requireText(
    checkoutPatch,
    "Status: APPROVED additive contract patch for the current implementation.",
    "Checkout approved Pass 0 patch status",
  );
}

/** Runs the dependency-free Checkout structural gate through Pass 8 release proof. */
function main() {
  verifyShippingCorePrerequisite();
  verifyIndependentProjects();
  verifyCheckoutDatabaseFoundation();
  verifyCheckoutContracts();
  verifyCheckoutRepository();
  verifyCheckoutPrerequisiteServices();
  verifyCheckoutServiceGate();
  verifyCheckoutHttpGate();
  verifyCheckoutBackendProof();
  verifyCheckoutFrontendGate();
  verifyCheckoutE2EGate();
  console.log(
    [
      "Module 10 Checkout Pass 8 verification passed; backend service/Supertest proof, the React Checkout feature",
      "with RTL/MSW coverage, live Playwright customer-flow proof, post-browser Checkout/Inventory reconciliation,",
      "cumulative OpenAPI coverage, and the full cross-repository release verifier are present.",
    ].join(" "),
  );
}

main();

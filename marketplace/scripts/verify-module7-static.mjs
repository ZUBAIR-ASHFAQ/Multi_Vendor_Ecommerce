import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one UTF-8 project file and throws a clear error when it is missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires a known text fragment in a source file used by the cumulative Module 7 gate. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects text that would indicate a contract or ownership boundary regression. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Runs the already accepted Module 6 structural gate before Module 7 checks. */
function verifyModule6Prerequisite() {
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-module6-static.mjs")], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Module 6 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms the two independent projects and required technology choices remain intact. */
function verifyTopologyAndStack() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }

  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));
  const frontendPackage = JSON.parse(readProjectFile("frontend/package.json"));

  for (const dependency of ["express", "drizzle-orm", "pg", "zod", "bullmq", "ioredis"]) {
    if (!backendPackage.dependencies?.[dependency]) {
      throw new Error(`Backend stack dependency is missing: ${dependency}`);
    }
  }

  for (const dependency of [
    "react",
    "@tanstack/react-router",
    "@tanstack/react-query",
    "@tanstack/react-form",
    "zod",
    "axios",
  ]) {
    if (!frontendPackage.dependencies?.[dependency]) {
      throw new Error(`Frontend stack dependency is missing: ${dependency}`);
    }
  }
}

/** Confirms Module 7 can reuse the required Foundation transaction, audit, outbox and idempotency primitives. */
function verifyFoundationReadiness() {
  const requiredFiles = [
    "backend/src/database/transaction.ts",
    "backend/src/common/audit/audit.service.ts",
    "backend/src/common/outbox/outbox.service.ts",
    "backend/src/common/idempotency/idempotency.service.ts",
    "backend/src/common/schemas/api-envelope.schema.ts",
    "backend/src/common/schemas/pagination.schema.ts",
    "backend/src/common/middleware/authentication.middleware.ts",
    "backend/src/common/middleware/authorization.middleware.ts",
  ];

  for (const relativePath of requiredFiles) {
    readProjectFile(relativePath);
  }
}

/** Confirms Product variants remain the upstream sellable-unit prerequisite for Inventory. */
function verifyProductVariantPrerequisite() {
  const productSchema = readProjectFile("backend/src/database/schema/products.ts");
  const productConstants = readProjectFile(
    "backend/src/modules/products/products.constants.ts",
  );

  requireText(productSchema, '"product_variants"', "Module 6 Product variant schema");
  requireText(
    productSchema,
    "inventory quantities remain Module 7 responsibility",
    "Product ownership boundary",
  );
  requireText(
    productConstants,
    "inventory quantities remain owned by Module 7",
    "Product module ownership boundary",
  );
}

/** Confirms Pass 1 persistence remains centralized, constrained, and append-only. */
function verifyInventoryDatabasePass() {
  const inventorySchema = readProjectFile(
    "backend/src/database/schema/inventory.ts",
  );
  const schemaIndex = readProjectFile("backend/src/database/schema/index.ts");
  const relations = readProjectFile("backend/src/database/relations.ts");
  const migration = readProjectFile("backend/drizzle/0011_inventory_stock.sql");
  const partialShipmentMigration = readProjectFile(
    "backend/drizzle/0014_inventory_partial_shipment_accounting.sql",
  );
  const migrationVerifier = readProjectFile(
    "backend/scripts/verify-module7-migrations.mjs",
  );
  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));

  for (const tableName of ["inventory_items", "stock_movements", "stock_reservations"]) {
    requireText(inventorySchema, `\"${tableName}\"`, "Inventory Drizzle schema");
    requireText(migration, `CREATE TABLE \"${tableName}\"`, "Module 7 migration");
  }

  for (const guard of [
    "inventory_items_reserved_not_over_on_hand_check",
    "inventory_items_store_variant_uq",
    "stock_movements_idempotency_key_uq",
    "stock_reservations_source_key_uq",
    "inventory_items_variant_scope_trigger",
    "stock_movements_append_only_trigger",
  ]) {
    requireText(migration, guard, "Module 7 database integrity guard");
  }

  requireText(inventorySchema, 'consumedQty: integer("consumed_qty").notNull().default(0)', "Inventory reservation consumption field");
  requireText(
    inventorySchema,
    'releasedQty: integer("released_qty").notNull().default(0)',
    "Inventory reservation released-quantity field",
  );
  requireText(
    inventorySchema,
    "stock_reservations_accounted_qty_range_check",
    "Inventory reservation consumed/released accounting check",
  );
  requireText(
    partialShipmentMigration,
    'ADD COLUMN "consumed_qty" integer DEFAULT 0 NOT NULL',
    "Partial-shipment Inventory migration",
  );
  requireText(
    partialShipmentMigration,
    "WHERE \"status\" = 'consumed'",
    "Partial-shipment consumed-reservation backfill",
  );
  requireText(
    partialShipmentMigration,
    "stock_reservations_consumed_qty_range_check",
    "Partial-shipment database range guard",
  );

  requireText(schemaIndex, 'export * from "./inventory.js";', "Schema export registry");
  requireText(relations, "inventoryItemsRelations", "Inventory relations");
  requireText(relations, "stockMovementsRelations", "Stock movement relations");
  requireText(relations, "stockReservationsRelations", "Stock reservation relations");
  requireText(
    migrationVerifier,
    "Module 7 migration verification passed.",
    "Module 7 migration verifier",
  );

  if (
    backendPackage.scripts?.["test:module7:migrations"] !==
    "node scripts/verify-module7-migrations.mjs"
  ) {
    throw new Error("Backend package is missing the permanent Module 7 migration verification command.");
  }

  requireText(
    migrationVerifier,
    'const partialShipmentMigration = "0014_inventory_partial_shipment_accounting.sql";',
    "Permanent Module 7 partial-shipment migration history",
  );
  requireText(
    migrationVerifier,
    "verifyPartialShipmentUpgradePath",
    "Permanent Module 7 partial-shipment upgrade verification",
  );
}

/** Confirms Pass 2 owns only real Inventory constants, Zod contracts, inferred types, and RBAC catalog composition. */
function verifyInventoryContractsPass() {
  const constants = readProjectFile(
    "backend/src/modules/inventory/inventory.constants.ts",
  );
  const schemas = readProjectFile(
    "backend/src/modules/inventory/inventory.schema.ts",
  );
  const platformRbac = readProjectFile(
    "backend/src/database/seeds/platform-rbac.seed.ts",
  );

  for (const permission of [
    "inventory.read",
    "inventory.adjust",
    "inventory.reorder.manage",
    "admin.inventory.read",
  ]) {
    requireText(constants, permission, "Inventory permission contract");
  }

  for (const errorCode of [
    "INVENTORY_NOT_FOUND",
    "INSUFFICIENT_STOCK",
    "STOCK_ADJUSTMENT_INVALID",
    "DUPLICATE_STOCK_SOURCE",
  ]) {
    requireText(constants, errorCode, "Inventory error contract");
  }

  for (const movementType of ["adjustment", "reserve", "release", "ship", "restock"]) {
    requireText(constants, `\"${movementType}\"`, "Stock movement contract");
  }

  for (const reservationStatus of [
    "reserved",
    "committed",
    "released",
    "consumed",
    "expired",
  ]) {
    requireText(constants, `\"${reservationStatus}\"`, "Stock reservation contract");
  }

  for (const eventCode of [
    "inventory.adjusted",
    "inventory.reserved",
    "inventory.reservation_released",
    "inventory.shipped",
    "inventory.low_stock",
  ]) {
    requireText(constants, eventCode, "Inventory outbox event contract");
  }

  for (const schemaName of [
    "sellerInventoryListQuerySchema",
    "stockMovementListQuerySchema",
    "adjustStockBodySchema",
    "updateReorderLevelBodySchema",
    "reserveStockBodySchema",
    "commitStockReservationBodySchema",
    "releaseStockBodySchema",
    "shipStockBodySchema",
    "inventoryItemResponseSchema",
    "stockMovementResponseSchema",
    "stockReservationResponseSchema",
  ]) {
    requireText(schemas, `export const ${schemaName}`, "Inventory Zod contract");
  }

  requireText(
    schemas,
    'paginationQuerySchema',
    "Inventory shared pagination contract",
  );
  requireText(
    schemas,
    "availableQty",
    "Inventory available-stock response contract",
  );
  rejectText(
    schemas,
    "sellerId: uuidSchema,\n    storeId: uuidSchema,\n    quantityDelta",
    "Inventory adjustment request ownership contract",
  );

  requireText(platformRbac, "INVENTORY_PERMISSION_CATALOG", "Platform permission composition");
  requireText(platformRbac, "INVENTORY_PERMISSION.READ", "Seller Inventory permission grant");
  requireText(platformRbac, "INVENTORY_PERMISSION.ADJUST", "Seller Inventory permission grant");
  requireText(
    platformRbac,
    "INVENTORY_PERMISSION.REORDER_MANAGE",
    "Seller Inventory permission grant",
  );

  if (existsSync(join(root, "backend/src/modules/inventory/inventory.types.ts"))) {
    throw new Error("Pass 2 must not create an unnecessary Inventory types file; infer types from Zod/Drizzle.");
  }

}

/** Confirms Pass 3 keeps Inventory persistence scoped, transaction-ready, and free of service-layer decisions. */
function verifyInventoryRepositoryPass() {
  const repository = readProjectFile(
    "backend/src/modules/inventory/inventory.repository.ts",
  );

  for (const repositoryMethod of [
    "listSellerInventory",
    "findInventoryItemByVariantInSellerScope",
    "findInventoryItemByVariantInSellerScopeForUpdate",
    "findInventoryItemByVariantForUpdate",
    "createInventoryItemIfMissing",
    "updateReorderLevelInSellerScope",
    "applyOnHandAdjustmentInSellerScope",
    "increaseReservedQuantity",
    "decreaseReservedQuantity",
    "consumeReservedQuantity",
    "listMovementsByVariantInSellerScope",
    "findMovementByIdempotencyKey",
    "createMovement",
    "findReservationBySourceKey",
    "findExpiredReservedReservations",
    "findReservationByIdForUpdate",
    "createReservation",
    "updateReservationStatus",
  ]) {
    requireText(repository, `async ${repositoryMethod}`, "Inventory repository");
  }

  requireText(repository, "InventorySellerScope", "Inventory repository seller scope");
  requireText(repository, "inventorySellerScopeCondition", "Inventory seller scope SQL guard");
  requireText(repository, '.for("update")', "Inventory repository row locking");
  requireText(
    repository,
    "onHandQty} - ${inventoryItems.reservedQty} >= ${quantity}",
    "Inventory reserve conditional update",
  );
  requireText(
    repository,
    "onHandQty} + ${quantityDelta} >= ${inventoryItems.reservedQty}",
    "Inventory adjustment conditional update",
  );
  requireText(repository, "createMovement", "Immutable stock movement insert");
  requireText(
    repository,
    "updateReservationConsumption",
    "Partial shipment reservation persistence",
  );
  rejectText(repository, ".update(stockMovements)", "Immutable stock movement repository");
  rejectText(repository, ".delete(stockMovements)", "Immutable stock movement repository");

  for (const forbiddenImport of [
    "audit.service",
    "outbox.service",
    "authorization.middleware",
    "products.repository",
    "sellers.repository",
  ]) {
    rejectText(repository, forbiddenImport, "Inventory repository boundary");
  }

}

/** Confirms Pass 4 owns Inventory business decisions, state transitions, audit/outbox, and Product service integration. */
function verifyInventoryServicePass() {
  const service = readProjectFile(
    "backend/src/modules/inventory/inventory.service.ts",
  );
  const index = readProjectFile("backend/src/modules/inventory/index.ts");
  const constants = readProjectFile(
    "backend/src/modules/inventory/inventory.constants.ts",
  );
  const productsService = readProjectFile(
    "backend/src/modules/products/products.service.ts",
  );
  const productsRepository = readProjectFile(
    "backend/src/modules/products/products.repository.ts",
  );

  for (const serviceMethod of [
    "listSellerInventory",
    "listStockMovements",
    "adjustStock",
    "updateReorderLevel",
    "reserveStock",
    "commitStockReservation",
    "releaseStock",
    "releaseExpiredReservations",
    "shipStock",
  ]) {
    requireText(service, `async ${serviceMethod}`, "Inventory service");
  }

  for (const invariant of [
    "increaseReservedQuantity",
    "decreaseReservedQuantity",
    "consumeReservedQuantity",
    "updateReservationConsumption",
    "remainingReservationQuantity",
    "consumedQuantity",
    "remainingQuantity",
    "STOCK_RESERVATION_STATUS.COMMITTED",
    "STOCK_RESERVATION_STATUS.CONSUMED",
    "INSUFFICIENT_STOCK",
    "DUPLICATE_STOCK_SOURCE",
    "INVENTORY_OUTBOX_EVENT.LOW_STOCK",
    "AuditService.using(tx).record",
    "OutboxService.using(tx)",
    "enqueueLowStockIfEntered",
    "findExpiredReservedReservations",
    "expireReservationIfStillEligible",
    "releaseLockedReservation",
    "reservation-expiry:",
  ]) {
    requireText(service, invariant, "Inventory service business invariant");
  }

  requireText(
    service,
    "resolveVariantSellerStoreForCommand",
    "Inventory Product service boundary",
  );
  requireText(
    productsService,
    "resolveVariantSellerStoreForCommand",
    "Product downstream ownership service boundary",
  );
  requireText(
    productsRepository,
    "findVariantSellerStoreScope",
    "Product persistence support for Inventory ownership",
  );
  requireText(constants, "INVENTORY_SOURCE_TYPE", "Inventory movement source constants");
  requireText(index, 'export * from "./inventory.service.js";', "Inventory module export");

  const maintenanceRuntime = readProjectFile(
    "backend/src/common/jobs/lifecycle-maintenance.runtime.ts",
  );
  const server = readProjectFile("backend/src/server.ts");
  requireText(
    maintenanceRuntime,
    "INVENTORY_RESERVATION_EXPIRY",
    "Inventory reservation-expiry BullMQ job",
  );
  requireText(
    maintenanceRuntime,
    "upsertJobScheduler",
    "Inventory reservation-expiry BullMQ schedule",
  );
  requireText(
    server,
    "inventoryService.releaseExpiredReservations(limit)",
    "Inventory lifecycle runtime composition",
  );

  for (const forbiddenImport of [
    "products.repository",
    "sellers.repository",
    "authorization.middleware",
  ]) {
    rejectText(service, forbiddenImport, "Inventory service cross-module boundary");
  }

}

/** Confirms Pass 5 owns thin HTTP adapters, exact required routes, internal protection, app mounting, and OpenAPI. */
function verifyInventoryHttpPass() {
  const controller = readProjectFile(
    "backend/src/modules/inventory/inventory.controller.ts",
  );
  const routes = readProjectFile(
    "backend/src/modules/inventory/inventory.routes.ts",
  );
  const index = readProjectFile("backend/src/modules/inventory/index.ts");
  const app = readProjectFile("backend/src/app.ts");
  const openApi = readProjectFile(
    "backend/src/http/openapi/openapi.document.ts",
  );
  const internalMiddleware = readProjectFile(
    "backend/src/common/middleware/internal-service.middleware.ts",
  );
  const authenticationMiddleware = readProjectFile(
    "backend/src/common/middleware/authentication.middleware.ts",
  );
  const environment = readProjectFile("backend/src/config/env.ts");
  const envExample = readProjectFile("backend/.env.example");
  const logger = readProjectFile("backend/src/common/logger/logger.ts");

  for (const controllerMethod of [
    "listSellerInventory",
    "listStockMovements",
    "adjustStock",
    "updateReorderLevel",
    "reserveStock",
    "releaseStock",
    "shipStock",
  ]) {
    requireText(controller, `${controllerMethod} = async`, "Inventory controller");
  }

  requireText(controller, "successResponse", "Inventory standard API envelope");
  requireText(controller, "getRequestContext", "Inventory server-derived request context");
  rejectText(controller, "InventoryRepository", "Thin Inventory controller");
  rejectText(controller, "withTransaction", "Thin Inventory controller");

  for (const requiredRoute of [
    'router.get(\n    "/",',
    '"/:variantId/movements"',
    '"/:variantId/adjust"',
    '"/:variantId/reorder-level"',
    'router.post("/reserve", controller.reserveStock)',
    'router.post("/release", controller.releaseStock)',
    'router.post("/ship", controller.shipStock)',
  ]) {
    requireText(routes, requiredRoute, "Inventory route surface");
  }

  requireText(routes, "authenticationMiddleware", "Seller Inventory authentication");
  requireText(routes, "requirePermission", "Seller Inventory RBAC");
  requireText(routes, "internalServiceMiddleware", "Internal Inventory authentication");
  requireText(routes, "inventoryOpenApiPaths", "Inventory OpenAPI paths");
  requireText(routes, "inventoryOpenApiComponents", "Inventory OpenAPI security component");
  rejectText(routes, 'router.delete(', "Inventory route surface");
  rejectText(routes, 'router.put(', "Inventory route surface");
  rejectText(routes, '"/commit"', "Inventory controlling route surface");

  for (const path of [
    '"/api/v1/seller/inventory"',
    '"/api/v1/seller/inventory/{variantId}/movements"',
    '"/api/v1/seller/inventory/{variantId}/adjust"',
    '"/api/v1/seller/inventory/{variantId}/reorder-level"',
    '"/api/v1/internal/inventory/reserve"',
    '"/api/v1/internal/inventory/release"',
    '"/api/v1/internal/inventory/ship"',
  ]) {
    requireText(routes, path, "Inventory OpenAPI route");
  }

  requireText(internalMiddleware, "timingSafeEqual", "Internal Inventory credential comparison");
  requireText(internalMiddleware, "x-internal-api-key", "Internal Inventory credential header");
  requireText(internalMiddleware, "setSystemRequestContext", "Internal system request context");
  requireText(authenticationMiddleware, "setSystemRequestContext", "System request-context helper");
  requireText(environment, "INTERNAL_API_KEY", "Typed internal API key environment");
  requireText(envExample, "INTERNAL_API_KEY=", "Internal API key environment example");
  requireText(logger, "x-internal-api-key", "Internal API key log redaction");

  requireText(index, 'export * from "./inventory.controller.js";', "Inventory controller export");
  requireText(index, 'export * from "./inventory.routes.js";', "Inventory route export");
  requireText(app, "new InventoryService({ products: productsService })", "Inventory service composition");
  requireText(app, "createSellerInventoryRouter", "Seller Inventory router composition");
  requireText(app, "createInternalInventoryRouter", "Internal Inventory router composition");
  requireText(app, '`${API_V1_PREFIX}/seller/inventory`', "Seller Inventory app mount");
  requireText(app, '`${API_V1_PREFIX}/internal/inventory`', "Internal Inventory app mount");

  requireText(openApi, "inventoryOpenApiPaths", "Inventory OpenAPI registration");
  requireText(openApi, "inventoryOpenApiComponents.securitySchemes", "Internal Inventory OpenAPI security registration");
  requireText(openApi, '{ name: "Inventory"', "Inventory OpenAPI tag");

}


/** Confirms Pass 6 provides backend schema/repository/service/API proof plus prerequisite regression gates. */
function verifyInventoryBackendTestsPass() {
  const testFiles = [
    "backend/tests/module7/module7.test-helpers.ts",
    "backend/tests/module7/module7.schemas.test.ts",
    "backend/tests/module7/module7.repository.test.ts",
    "backend/tests/module7/module7.service.test.ts",
    "backend/tests/module7/module7.integration.test.ts",
  ];
  for (const relativePath of testFiles) readProjectFile(relativePath);

  const schemasTest = readProjectFile(
    "backend/tests/module7/module7.schemas.test.ts",
  );
  const repositoryTest = readProjectFile(
    "backend/tests/module7/module7.repository.test.ts",
  );
  const serviceTest = readProjectFile(
    "backend/tests/module7/module7.service.test.ts",
  );
  const integrationTest = readProjectFile(
    "backend/tests/module7/module7.integration.test.ts",
  );
  const runner = readProjectFile("backend/scripts/run-module7-tests.mjs");
  const ci = readProjectFile("backend/.github/workflows/ci.yml");
  const testEnv = readProjectFile("backend/tests/setup/env.ts");
  const service = readProjectFile(
    "backend/src/modules/inventory/inventory.service.ts",
  );
  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));

  for (const proof of [
    "bounds stock quantities",
    "partial reservation progress",
    "documents exactly the required Module 7 HTTP surface",
  ]) {
    requireText(schemasTest, proof, "Module 7 schema/OpenAPI tests");
  }
  for (const proof of [
    "exact seller/store scope",
    "persisted stock invariants",
    "append-only",
    "expired uncommitted reservations",
  ]) {
    requireText(repositoryTest, proof, "Module 7 repository tests");
  }
  for (const proof of [
    "authoritative available quantity",
    "seller-scoped permission is absent",
    "already expired reserve command",
  ]) {
    requireText(serviceTest, proof, "Module 7 service tests");
  }
  for (const proof of [
    "seller-to-seller isolation",
    "reserve retries idempotent",
    "concurrent reservations",
    "rolls an invalid seller adjustment back",
    "crosses into the configured threshold",
    "releases reservations exactly once",
    "trusted internal HTTP command",
    "committed stock reserved after checkout expiry",
    "two partial shipments",
    "unshipped remainder after a partial shipment",
  ]) {
    requireText(integrationTest, proof, "Module 7 integration tests");
  }

  requireText(
    service,
    "Committed stock stays reserved even after the temporary checkout expiry",
    "Committed Inventory reservation fulfillment rule",
  );
  requireText(
    service,
    "reservation.status === STOCK_RESERVATION_STATUS.RESERVED",
    "Committed reservation release lifecycle fix",
  );
  requireText(runner, "test:module7:migrations", "Module 7 backend test runner");
  requireText(runner, "test:module7:specs", "Module 7 backend test runner");
  requireText(runner, "test:module6:specs", "Module 7 prerequisite regression runner");
  requireText(runner, "typecheck", "Module 7 verification runner");
  requireText(runner, "lint", "Module 7 verification runner");
  requireText(runner, "build", "Module 7 verification runner");
  requireText(testEnv, "INTERNAL_API_KEY", "Module 7 deterministic internal-route test environment");
  requireText(ci, "Verify Module 7 clean and upgrade migrations", "Backend CI Module 7 migration gate");
  requireText(ci, "Run Module 7 tests", "Backend CI Module 7 spec gate");

  if (backendPackage.scripts?.["test:module7:specs"] !== "vitest run tests/module7") {
    throw new Error("Backend package is missing the permanent Module 7 spec command.");
  }
  if (
    backendPackage.scripts?.["test:module7"] !==
    "node scripts/run-module7-tests.mjs"
  ) {
    throw new Error("Backend package is missing the cumulative Module 7 backend gate.");
  }

}


/** Confirms Pass 7 provides the seller Inventory React feature using the required TanStack stack. */
function verifyInventoryFrontendPass() {
  const requiredFiles = [
    "frontend/src/features/inventory/api/inventory.api.ts",
    "frontend/src/features/inventory/hooks/inventory.query-keys.ts",
    "frontend/src/features/inventory/hooks/use-inventory.ts",
    "frontend/src/features/inventory/components/inventory-pagination.tsx",
    "frontend/src/features/inventory/components/inventory-status.tsx",
    "frontend/src/features/inventory/forms/inventory-adjustment-form.tsx",
    "frontend/src/features/inventory/forms/inventory-reorder-level-form.tsx",
    "frontend/src/features/inventory/schemas/inventory.schemas.ts",
    "frontend/src/features/inventory/pages/seller-inventory.page.tsx",
    "frontend/src/features/inventory/pages/seller-inventory-variant.page.tsx",
    "frontend/src/features/inventory/pages/seller-inventory-movements.page.tsx",
    "frontend/src/app/routes/inventory.routes.tsx",
    "frontend/tests/module7-inventory.test.tsx",
  ];
  for (const relativePath of requiredFiles) readProjectFile(relativePath);

  const api = readProjectFile("frontend/src/features/inventory/api/inventory.api.ts");
  const hooks = readProjectFile("frontend/src/features/inventory/hooks/use-inventory.ts");
  const inventoryPage = readProjectFile("frontend/src/features/inventory/pages/seller-inventory.page.tsx");
  const variantPage = readProjectFile("frontend/src/features/inventory/pages/seller-inventory-variant.page.tsx");
  const movementPage = readProjectFile("frontend/src/features/inventory/pages/seller-inventory-movements.page.tsx");
  const adjustmentForm = readProjectFile("frontend/src/features/inventory/forms/inventory-adjustment-form.tsx");
  const reorderForm = readProjectFile("frontend/src/features/inventory/forms/inventory-reorder-level-form.tsx");
  const routes = readProjectFile("frontend/src/app/routes/inventory.routes.tsx");
  const router = readProjectFile("frontend/src/app/router/router.tsx");
  const sellerLayout = readProjectFile("frontend/src/features/sellers/components/seller-layout.tsx");
  const authNavigation = readProjectFile("frontend/src/features/auth/auth.navigation.ts");
  const productEdit = readProjectFile("frontend/src/features/products/pages/seller-product-edit.page.tsx");
  const test = readProjectFile("frontend/tests/module7-inventory.test.tsx");
  const frontendPackage = JSON.parse(readProjectFile("frontend/package.json"));

  for (const route of [
    '"/seller/inventory"',
    '`/seller/inventory/${variantId}/movements`',
    '`/seller/inventory/${variantId}/adjust`',
    '`/seller/inventory/${variantId}/reorder-level`',
  ]) {
    requireText(api, route, "Inventory frontend API client");
  }
  rejectText(api, "/internal/inventory", "Inventory frontend API boundary");

  requireText(hooks, "useQuery", "Inventory TanStack Query hooks");
  requireText(hooks, "useMutation", "Inventory TanStack Query hooks");
  requireText(adjustmentForm, "useForm", "Inventory adjustment TanStack Form");
  requireText(adjustmentForm, "inventoryAdjustmentFormSchema", "Inventory adjustment Zod validation");
  requireText(reorderForm, "useForm", "Inventory reorder TanStack Form");
  requireText(reorderForm, "inventoryReorderLevelFormSchema", "Inventory reorder Zod validation");

  for (const requirement of [
    "On hand",
    "Reserved",
    "Available",
    "Only low stock",
    "Manage",
    "Movements",
  ]) {
    requireText(inventoryPage, requirement, "Inventory seller UI");
  }
  requireText(variantPage, "Manage variant Inventory", "Inventory new-variant management UI");
  requireText(variantPage, "does not have an Inventory row yet", "Inventory new-variant initialization UI");
  requireText(movementPage, "Stock movement history", "Inventory movement history UI");
  requireText(movementPage, "movement.quantityDelta", "Inventory movement history UI");
  requireText(routes, 'path: "/seller/inventory"', "Inventory TanStack Router route");
  requireText(routes, 'path: "/seller/inventory/$variantId/manage"', "Inventory TanStack Router route");
  requireText(routes, 'path: "/seller/inventory/$variantId/movements"', "Inventory TanStack Router route");
  requireText(router, "sellerInventoryRoute", "Inventory router registration");
  requireText(router, "sellerInventoryVariantRoute", "Inventory router registration");
  requireText(router, "sellerInventoryMovementsRoute", "Inventory router registration");
  requireText(sellerLayout, 'user.permissions.includes("inventory.read")', "Seller Inventory navigation");
  requireText(authNavigation, 'return "/seller/inventory";', "Inventory post-login navigation");
  requireText(productEdit, 'to="/seller/inventory/$variantId/manage"', "Product-to-Inventory variant handoff");

  for (const proof of [
    "authoritative stock columns",
    "documented low-stock filter",
    "adjusts physical stock",
    "initializes a new Product variant",
    "immutable movement history",
  ]) {
    requireText(test, proof, "Module 7 frontend tests");
  }

  if (frontendPackage.scripts?.["test:module7"] !== "vitest run tests/module7-inventory.test.tsx") {
    throw new Error("Frontend package is missing the permanent Module 7 UI test command.");
  }

  if (existsSync(join(root, "frontend/src/features/inventory/types"))) {
    throw new Error("Pass 7 must not create an unnecessary Inventory types directory; current types are inferred from Zod.");
  }

  for (const forbiddenDependency of ["redux", "zustand", "mobx"]) {
    if (frontendPackage.dependencies?.[forbiddenDependency]) {
      throw new Error(`Inventory frontend must not add unrelated state dependency: ${forbiddenDependency}`);
    }
  }
}

/** Confirms Pass 8 provides the complete Module 7 browser workflow and cumulative release gate. */
function verifyInventoryReleasePass() {
  const e2e = readProjectFile("frontend/e2e/module7.spec.ts");
  const releaseVerifier = readProjectFile("scripts/verify-module7.mjs");
  const releaseData = readProjectFile(
    "backend/scripts/verify-module7-release-data.mjs",
  );
  const backendPackage = JSON.parse(readProjectFile("backend/package.json"));
  const frontendPackage = JSON.parse(readProjectFile("frontend/package.json"));
  const frontendCi = readProjectFile("frontend/.github/workflows/ci.yml");

  for (const proof of [
    "initializes stock, manages a reorder threshold, creates low stock, and shows immutable movements",
    "proves Seller B cannot read or adjust Seller A Inventory",
    "Inventory quantity adjustment",
    "Inventory reorder level",
    "Only low stock",
    "Stock movement history",
  ]) {
    requireText(e2e, proof, "Module 7 Playwright workflow");
  }
  rejectText(e2e, "/internal/inventory", "Module 7 browser E2E boundary");

  for (const stage of [
    "test:module7:migrations",
    "test:module7:specs",
    "e2e/module7.spec.ts",
    "test:module7:release-data",
    "marketplace-backend-module7-release",
    "marketplace-frontend-module7-release",
  ]) {
    requireText(releaseVerifier, stage, "Module 7 full release verifier");
  }
  requireText(releaseVerifier, "verify-module7-static.mjs", "Module 7 full release verifier");
  requireText(releaseVerifier, "INTERNAL_API_KEY", "Module 7 E2E internal-service configuration");

  for (const invariant of [
    "Inventory seller/store ownership",
    "Inventory Product-variant ownership",
    "Inventory quantity bounds",
    "Inventory active reservation reconciliation",
    "stock_movements_append_only_trigger",
    "inventory_items_variant_scope_trigger",
  ]) {
    requireText(releaseData, invariant, "Module 7 post-E2E integrity verifier");
  }

  if (
    backendPackage.scripts?.["test:module7:release-data"] !==
    "node scripts/verify-module7-release-data.mjs"
  ) {
    throw new Error("Backend package is missing the Module 7 post-E2E integrity command.");
  }
  if (
    frontendPackage.scripts?.["test:e2e:module7"] !==
    "playwright test e2e/module7.spec.ts"
  ) {
    throw new Error("Frontend package is missing the Module 7 Playwright command.");
  }
  requireText(frontendCi, "npm run test:module7", "Frontend CI Module 7 regression");
}

/** Rejects disposable evidence and generated output that should never ship in a clean source archive. */
function verifyNoDisposableArtifacts() {
  const forbiddenDirectories = new Set([
    "node_modules",
    "dist",
    "coverage",
    "playwright-report",
    "test-results",
  ]);
  const forbiddenNamePatterns = [
    /pass[_-]?evidence/i,
    /change[_-]?map/i,
    /audit[_-]?result/i,
    /scratch/i,
    /\.tmp$/i,
  ];

  /** Walks one directory and validates every file/directory name without following generated dependencies. */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (forbiddenDirectories.has(entry.name)) {
        throw new Error(`Generated/disposable directory must not be shipped: ${entry.name}`);
      }
      if (forbiddenNamePatterns.some((pattern) => pattern.test(entry.name))) {
        throw new Error(`Disposable evidence file must not be shipped: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        walk(join(directory, entry.name));
      }
    }
  }

  walk(root);
}

/** Runs the cumulative Module 7 Pass 0-8 structural, regression, browser, and release gate. */
function main() {
  verifyModule6Prerequisite();
  verifyTopologyAndStack();
  verifyFoundationReadiness();
  verifyProductVariantPrerequisite();
  verifyInventoryDatabasePass();
  verifyInventoryContractsPass();
  verifyInventoryRepositoryPass();
  verifyInventoryServicePass();
  verifyInventoryHttpPass();
  verifyInventoryBackendTestsPass();
  verifyInventoryFrontendPass();
  verifyInventoryReleasePass();
  verifyNoDisposableArtifacts();
  console.log("Module 7 cumulative static verification passed.");
}

main();

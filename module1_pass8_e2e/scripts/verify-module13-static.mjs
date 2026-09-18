import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and reports its exact missing path. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 13 file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Requires one permanent contract fragment in a source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one source fragment that would violate the current pass boundary. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Requires one file or directory to remain absent when the completed contract forbids it. */
function requireAbsent(relativePath, label) {
  if (existsSync(join(root, relativePath))) {
    throw new Error(`${label} must remain absent: ${relativePath}`);
  }
}

/** Runs the released Module 16 structural gate because Stage 16 Shipping follows Commissions. */
function verifyReleasedPrerequisites() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module16-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Released prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
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

/** Confirms the approved Shipping Core and fulfillment contracts remain present and controlling. */
function verifyPatchContracts() {
  const corePatch = readProjectFile("REQUIREMENTS_PATCH_0003.md");
  const fulfillmentPatch = readProjectFile("REQUIREMENTS_PATCH_0008.md");

  for (const required of [
    "Status: APPROVED additive contract patch for the current implementation.",
    'pricing_type = "flat"',
    "GET /api/v1/checkout/shipping-options?addressId=<uuid>",
  ]) {
    requireText(corePatch, required, "Approved Shipping Core contract");
  }

  for (const required of [
    "Status: APPROVED additive executable contract patch for Stage 16 Module 13 completion.",
    "create shipment -> created",
    "Inventory issue timing — ambiguity resolved",
    "shipping.read_own_order",
    "seller.shipping.manage",
    "SHIPMENT_NOT_FOUND",
    "partially_fulfilled",
    "Pass 2 Contracts",
  ]) {
    requireText(fulfillmentPatch, required, "Approved Shipping fulfillment contract");
  }
}

/** Confirms the released Module 13 migration remains present even after later modules append migrations. */
function verifyPass1DatabasePrerequisite() {
  const drizzleDirectory = join(root, "marketplace-backend/drizzle");
  const migrations = readdirSync(drizzleDirectory)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  if (!migrations.includes("0027_shipping_fulfillment.sql")) {
    throw new Error("Module 13 completion requires committed migration 0027_shipping_fulfillment.sql.");
  }

  const shippingSchema = readProjectFile("marketplace-backend/src/database/schema/shipping.ts");
  const ordersSchema = readProjectFile("marketplace-backend/src/database/schema/orders.ts");
  const migration = readProjectFile(
    "marketplace-backend/drizzle/0027_shipping_fulfillment.sql",
  );

  for (const required of [
    'export const shipments = pgTable(',
    'export const shipmentItems = pgTable(',
    'export const shipmentStatusHistory = pgTable(',
    '"shipments_status_check"',
    '"shipment_items_quantity_positive_check"',
  ]) {
    requireText(shippingSchema, required, "Pass 1 Shipping database schema");
  }
  requireText(
    ordersSchema,
    "partially_fulfilled",
    "Pass 1 Orders fulfillment database contract",
  );
  requireText(
    migration,
    'CREATE TABLE "shipments"',
    "Pass 1 Shipping fulfillment migration",
  );
}

/** Confirms the released Stage 11 shipping-options runtime remains backward compatible. */
function verifyShippingCoreCompatibility() {
  const repository = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.repository.ts",
  );
  const service = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.service.ts",
  );
  const controller = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.controller.ts",
  );
  const routes = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.routes.ts",
  );
  const app = readProjectFile("marketplace-backend/src/app.ts");

  requireText(repository, "listCheckoutEligibleMethods", "Shipping Core repository");
  requireText(service, "getCheckoutShippingOptions", "Shipping Core service");
  requireText(controller, "shippingOptionsQuerySchema.parse(request.query)", "Shipping Core controller");
  requireText(routes, 'router.get("/shipping-options"', "Shipping Core route");
  requireText(routes, '"/api/v1/checkout/shipping-options"', "Shipping Core OpenAPI path");
  requireText(app, 'app.use(`${API_V1_PREFIX}/checkout`, shippingRouter);', "Shipping Core app mount");

  for (const forbiddenImport of [
    "orders.repository",
    "inventory.repository",
    "payments.repository",
  ]) {
    rejectText(service, forbiddenImport, "Shipping cross-module repository boundary");
  }
}

/** Confirms Pass 2 freezes true constants without adding empty boilerplate types. */
function verifyFulfillmentConstants() {
  const constants = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.constants.ts",
  );

  for (const required of [
    "export const SHIPMENT_STATUS = {",
    'CREATED: "created"',
    'SHIPPED: "shipped"',
    'DELIVERED: "delivered"',
    "export const SHIPPING_PERMISSION = {",
    'READ_OWN_ORDER: "shipping.read_own_order"',
    'SELLER_READ: "seller.shipping.read"',
    'SELLER_MANAGE: "seller.shipping.manage"',
    'ADMIN_READ: "admin.shipping.read"',
    "export const SHIPPING_ERROR_CODE = {",
    'SHIPMENT_NOT_FOUND: "SHIPMENT_NOT_FOUND"',
    'SHIPMENT_QUANTITY_INVALID: "SHIPMENT_QUANTITY_INVALID"',
    'SHIPMENT_STATUS_INVALID: "SHIPMENT_STATUS_INVALID"',
    'TRACKING_INVALID: "TRACKING_INVALID"',
    'INVENTORY_ISSUE_FAILED: "INVENTORY_ISSUE_FAILED"',
    "export const SHIPPING_PATH = {",
    'SELLER_CREATE: "/api/v1/seller/orders/:sellerOrderId/shipments"',
    'ORDER_SHIPMENTS: "/api/v1/orders/:orderId/shipments"',
    "export const SHIPPING_IDEMPOTENCY_SCOPE = {",
    "export const SHIPPING_OUTBOX_EVENT = {",
    "export const SHIPMENT_LIST_SORT_VALUES = [\"createdAt\", \"shipmentNo\"]",
    "SHIPMENT_NUMBER: /^SHP-[0-9A-F]{32}$/",
  ]) {
    requireText(constants, required, "Module 13 Pass 2 constants");
  }

  requireAbsent(
    "marketplace-backend/src/modules/shipping/shipping.types.ts",
    "Unnecessary Shipping types boilerplate",
  );
}

/** Confirms strict Zod contracts keep identity, ownership, status, and timestamps server-derived. */
function verifyFulfillmentSchemas() {
  const schema = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.schema.ts",
  );

  for (const required of [
    "export const shipmentStatusSchema = z.enum(SHIPMENT_STATUS_VALUES);",
    "export const customerVisibleShipmentStatusSchema = z.enum(",
    "export const createShipmentParamsSchema",
    "export const shipmentIdParamsSchema",
    "export const orderShipmentsParamsSchema",
    "export const createShipmentItemInputSchema",
    "export const createShipmentBodySchema",
    "Each Order Item may appear only once in a Shipment request.",
    "export const updateShipmentTrackingBodySchema",
    "export const shipmentLifecycleCommandBodySchema",
    "export const shipmentIdempotencyHeadersSchema",
    "export const sellerShipmentListQuerySchema",
    "export const sellerShipmentResponseSchema",
    "export const customerShipmentTrackingResponseSchema",
    "export const orderShipmentsResponseSchema",
    "export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>",
  ]) {
    requireText(schema, required, "Module 13 Pass 2 Zod contract");
  }

  for (const forbidden of [
    "sellerId: uuidSchema.optional()",
    "status: shipmentStatusSchema.optional(),\n    shippedAt",
  ]) {
    rejectText(schema, forbidden, "Module 13 client authority contract");
  }
}

/** Confirms the shared Orders contract can represent Shipping-derived fulfillment states. */
function verifyOrdersContractExtension() {
  const constants = readProjectFile(
    "marketplace-backend/src/modules/orders/orders.constants.ts",
  );
  const schema = readProjectFile(
    "marketplace-backend/src/modules/orders/orders.schema.ts",
  );

  for (const required of [
    'UNFULFILLED: "unfulfilled"',
    'PARTIALLY_FULFILLED: "partially_fulfilled"',
    'FULFILLED: "fulfilled"',
    "ORDER_FULFILLMENT_STATUS.PARTIALLY_FULFILLED",
    "ORDER_FULFILLMENT_STATUS.FULFILLED",
  ]) {
    requireText(constants, required, "Orders fulfillment contract extension");
  }
  requireText(
    schema,
    "export const orderFulfillmentStatusSchema = z.enum(ORDER_FULFILLMENT_STATUS_VALUES);",
    "Orders fulfillment Zod contract",
  );
}

/** Confirms focused Pass 2 tests cover strict authority, list scope, and response visibility boundaries. */
function verifyContractTests() {
  const tests = readProjectFile(
    "marketplace-backend/tests/module13/module13.schemas.test.ts",
  );
  const packageJson = JSON.parse(
    readProjectFile("marketplace-backend/package.json"),
  );

  for (const required of [
    "freezes the three Shipment states, seven route identities, permissions, and stable errors",
    "accepts only immutable Shipment item allocations and rejects client authority fields",
    "normalizes tracking text while keeping status and timestamps server-owned",
    "requires bounded seller-list input without accepting a client seller scope",
    "requires a non-blank Idempotency-Key for create, ship, and deliver commands",
    "customer tracking hides created/internal metadata",
    "extends the shared Orders fulfillment contract to all three Stage 16 values",
  ]) {
    requireText(tests, required, "Module 13 Pass 2 contract test");
  }

  if (
    packageJson.scripts?.["test:module13:contracts"] !==
    "vitest run tests/module13/module13.schemas.test.ts"
  ) {
    throw new Error("Backend package.json must expose the focused test:module13:contracts command.");
  }
}

/** Confirms Pass 3 adds the scoped Drizzle Shipment persistence helpers needed by later services. */
function verifyFulfillmentRepository() {
  const repository = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.repository.ts",
  );
  const tests = readProjectFile(
    "marketplace-backend/tests/module13/module13.repository.test.ts",
  );
  const packageJson = JSON.parse(
    readProjectFile("marketplace-backend/package.json"),
  );

  for (const required of [
    "export interface ShippingSellerScope",
    "using(executor: DatabaseExecutor): ShippingRepository",
    "listSellerShipments(",
    "findShipmentInScope(",
    "findShipmentForUpdateInScope(",
    "lockShipmentAllocations(",
    "sumAllocatedQuantitiesInScope(",
    "createShipmentInScope(",
    "createShipmentItemsInScope(",
    "appendStatusHistoryInScope(",
    "updateTrackingInScope(",
    "updateLifecycleInScope(",
    "listSellerShipmentItems(",
    "listSellerShipmentHistory(",
    "listCustomerVisibleShipmentsForOrder(",
    "listCustomerVisibleShipmentItemsForOrder(",
    "listCustomerVisibleShipmentHistoryForOrder(",
    "sellerScopeCondition(scope)",
    "shipping-allocation:${orderItemId}",
  ]) {
    requireText(repository, required, "Module 13 Pass 3 repository");
  }

  for (const forbidden of [
    "orders.repository",
    "inventory.repository",
    "payments.repository",
    "InventoryService",
    "OrdersService",
    "AppError",
  ]) {
    rejectText(repository, forbidden, "Module 13 repository layering");
  }

  for (const required of [
    "keeps seller Shipment headers, items, history, and writes inside exact seller/store scope",
    "serializes and sums immutable allocation rows without deciding fulfillment eligibility",
    "returns only shipped/delivered customer-safe persistence rows for an already-authorized Order",
  ]) {
    requireText(tests, required, "Module 13 Pass 3 repository test");
  }

  if (
    packageJson.scripts?.["test:module13:repository"] !==
    "vitest run tests/module13/module13.repository.test.ts"
  ) {
    throw new Error("Backend package.json must expose the focused test:module13:repository command.");
  }
}

/** Confirms Pass 4 implements fulfillment orchestration without crossing repository boundaries. */
function verifyFulfillmentService() {
  const service = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.service.ts",
  );
  const repository = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.repository.ts",
  );
  const ordersService = readProjectFile(
    "marketplace-backend/src/modules/orders/orders.service.ts",
  );
  const ordersRepository = readProjectFile(
    "marketplace-backend/src/modules/orders/orders.repository.ts",
  );
  const inventoryService = readProjectFile(
    "marketplace-backend/src/modules/inventory/inventory.service.ts",
  );

  for (const required of [
    "export interface ShippingOrdersIntegration",
    "export interface ShippingInventoryIntegration",
    "export interface ShippingIdempotencyIntegration",
    "async listSellerShipments(",
    "async createShipment(",
    "async updateShipmentTracking(",
    "async markShipmentShipped(",
    "async markShipmentDelivered(",
    "async getOrderShipments(",
    "lockShipmentAllocations(requestedIds)",
    "sumAllocatedQuantitiesInScope(",
    "getShippingReservationSnapshot",
    "shipment:${shipment.id}:item:${shipmentItem.orderItemId}",
    "applyShippingFulfillmentStatus",
    "SHIPPING_OUTBOX_EVENT.CREATED",
    "SHIPPING_OUTBOX_EVENT.SHIPPED",
    "SHIPPING_OUTBOX_EVENT.DELIVERED",
    "SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED",
    "SHIPPING_AUDIT_ACTION.TRACKING_UPDATED",
    "SHIPPING_IDEMPOTENCY_SCOPE.CREATE",
    "SHIPPING_IDEMPOTENCY_SCOPE.MARK_SHIPPED",
    "SHIPPING_IDEMPOTENCY_SCOPE.MARK_DELIVERED",
    "Tracking cannot be changed after delivery.",
    "Carrier and tracking number are required before shipping.",
  ]) {
    requireText(service, required, "Module 13 Pass 4 service");
  }

  for (const forbiddenImport of [
    "orders.repository",
    "inventory.repository",
    "payments.repository",
  ]) {
    rejectText(service, forbiddenImport, "Shipping service cross-module repository boundary");
  }

  requireText(
    repository,
    "sumIssuedQuantityForOrder(orderId: string)",
    "Shipping issued-quantity persistence helper",
  );
  for (const required of [
    "export interface OrderShippingFulfillmentSnapshot",
    "async getShippingFulfillmentSnapshot(",
    "async applyShippingFulfillmentStatus(",
    "async customerOwnsOrder(",
    "async orderExists(",
  ]) {
    requireText(ordersService, required, "Orders Shipping service boundary");
  }
  requireText(
    ordersRepository,
    "async updateOrderFulfillmentStatus(",
    "Orders fulfillment persistence helper",
  );
  requireText(
    inventoryService,
    "async getShippingReservationSnapshot(",
    "Inventory Shipping reservation boundary",
  );
}

/** Confirms Pass 5 exposes exactly the approved fulfillment HTTP/OpenAPI surface. */
function verifyFulfillmentHttp() {
  const controller = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.controller.ts",
  );
  const routes = readProjectFile(
    "marketplace-backend/src/modules/shipping/shipping.routes.ts",
  );
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const openApi = readProjectFile(
    "marketplace-backend/src/http/openapi/openapi.document.ts",
  );

  for (const required of [
    "listSellerShipments = async (",
    "createShipment = async (",
    "updateShipmentTracking = async (",
    "markShipmentShipped = async (",
    "markShipmentDelivered = async (",
    "getOrderShipments = async (",
    "sellerShipmentListQuerySchema.parse(request.query)",
    "createShipmentBodySchema.parse(request.body)",
    "shipmentIdempotencyHeadersSchema.parse(request.headers)",
    "updateShipmentTrackingBodySchema.parse(request.body)",
    "shipmentLifecycleCommandBodySchema.parse(request.body ?? {})",
    "orderShipmentsParamsSchema.parse(request.params)",
  ]) {
    requireText(controller, required, "Module 13 Pass 5 controller");
  }

  for (const required of [
    "export function createShippingRouter(",
    "export function createSellerShippingRouter(",
    "export function createOrderShippingRouter(",
    'router.get("/shipping-options"',
    'router.get(\n    "/shipments"',
    'router.post(\n    "/orders/:sellerOrderId/shipments"',
    'router.patch(\n    "/shipments/:id/tracking"',
    'router.post(\n    "/shipments/:id/mark-shipped"',
    'router.post(\n    "/shipments/:id/mark-delivered"',
    '"/:orderId/shipments"',
    "requirePermission(SHIPPING_PERMISSION.SELLER_READ)",
    "requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE)",
    "requireAnyPermission(",
    '"/api/v1/seller/shipments"',
    '"/api/v1/seller/orders/{sellerOrderId}/shipments"',
    '"/api/v1/seller/shipments/{id}/tracking"',
    '"/api/v1/seller/shipments/{id}/mark-shipped"',
    '"/api/v1/seller/shipments/{id}/mark-delivered"',
    '"/api/v1/orders/{orderId}/shipments"',
    'name: "Idempotency-Key"',
  ]) {
    requireText(routes, required, "Module 13 Pass 5 routes/OpenAPI");
  }

  for (const forbidden of [
    'router.delete("/shipments',
    'router.patch("/shipments/:id/status',
    '"/api/v1/seller/shipments/{id}":',
    '"/api/v1/shipping/carriers"',
  ]) {
    rejectText(routes, forbidden, "Unapproved Module 13 HTTP surface");
  }

  for (const required of [
    "createSellerShippingRouter(shippingController)",
    "createOrderShippingRouter(shippingController)",
    'app.use(`${API_V1_PREFIX}/seller`, sellerShippingRouter);',
    'app.use(`${API_V1_PREFIX}/orders`, orderShippingRouter);',
    "orders: ordersService",
    "ordersUsingTransaction: (transaction) => OrdersService.using(transaction)",
    "inventoryUsingTransaction: (transaction) => InventoryService.using(transaction)",
  ]) {
    requireText(app, required, "Module 13 Pass 5 application composition");
  }

  requireText(
    openApi,
    "Checkout shipping options plus seller-scoped Shipment creation, tracking, fulfillment, and customer-safe Order tracking.",
    "Module 13 OpenAPI tag",
  );
}

/** Confirms Pass 6 adds focused backend proof without changing the approved runtime surface. */
function verifyBackendProof() {
  const serviceTests = readProjectFile(
    "marketplace-backend/tests/module13/module13.service.test.ts",
  );
  const httpTests = readProjectFile(
    "marketplace-backend/tests/module13/module13.http.test.ts",
  );
  const integrationTests = readProjectFile(
    "marketplace-backend/tests/module13/module13.integration.test.ts",
  );
  const fulfillmentHelpers = readProjectFile(
    "marketplace-backend/tests/module13/module13.fulfillment-test-helpers.ts",
  );
  const regressionTests = readProjectFile(
    "marketplace-backend/tests/regression/implemented-api-contracts.test.ts",
  );
  const runner = readProjectFile(
    "marketplace-backend/scripts/run-module13-tests.mjs",
  );
  const backendCi = readProjectFile(
    "marketplace-backend/.github/workflows/ci.yml",
  );
  const packageJson = JSON.parse(
    readProjectFile("marketplace-backend/package.json"),
  );

  for (const required of [
    "rejects seller-scoped reads when no real authenticated actor exists",
    "rejects a fresh mark-shipped idempotency key when the Shipment is already shipped",
    "completes create-shipment idempotency inside the Shipment transaction",
    "serializes parent fulfillment reconciliation before summing issued quantity",
  ]) {
    requireText(serviceTests, required, "Module 13 Pass 6 service proof");
  }

  for (const required of [
    "protects seller Shipment routes with authentication and seller permissions",
    "requires idempotency headers and strict request bodies before fulfillment service work",
    "does not reveal another seller Shipment or another customer Order tracking",
    "returns only shipped/delivered customer-safe tracking while admin read remains non-mutating",
  ]) {
    requireText(httpTests, required, "Module 13 Pass 6 HTTP proof");
  }

  for (const required of [
    "runs create -> tracking -> shipped -> delivered exactly once with immutable evidence and customer tracking",
    "rejects pre-capture fulfillment, idempotency payload conflicts, and over-allocation",
    "rolls back mark-shipped when the committed Inventory prerequisite becomes invalid",
    "serializes concurrent Shipment allocation so the same commercial quantity cannot be allocated twice",
    "serializes concurrent Shipment issue so two partial Shipments reconcile the parent Order to fulfilled",
  ]) {
    requireText(integrationTests, required, "Module 13 Pass 6 PostgreSQL proof");
  }

  for (const required of [
    "prepareFulfillmentFixture",
    "createShipmentViaHttp",
    "countShipmentInventoryMovements",
    "countShippingOutboxEvents",
    "countShippingAuditEvents",
  ]) {
    const source = required === "prepareFulfillmentFixture" ? fulfillmentHelpers : readProjectFile(
      "marketplace-backend/tests/module13/module13.test-helpers.ts",
    );
    requireText(source, required, "Module 13 Pass 6 test helper");
  }

  requireText(
    regressionTests,
    "locks Module 13 Shipping to exactly the seven approved Configuration and Fulfillment operations",
    "Module 13 API regression proof",
  );

  for (const required of [
    '"test:module10:specs"',
    '"test:module11:specs"',
    '"test:module12:specs"',
    '"test:module16:specs"',
    "Module 13 Shipping & Fulfillment backend verification completed successfully.",
  ]) {
    requireText(runner, required, "Module 13 Pass 6 cumulative runner");
  }

  for (const required of [
    "Prepare database for Module 13 Shipping fulfillment tests",
    "Run Module 13 Shipping fulfillment backend proof",
    "run: npm run test:module13:specs",
  ]) {
    requireText(backendCi, required, "Module 13 Pass 6 backend CI wiring");
  }

  const expectedScripts = {
    "test:module13:service": "vitest run tests/module13/module13.schemas.test.ts tests/module13/module13.repository.test.ts tests/module13/module13.service.test.ts",
    "test:module13:http": "vitest run tests/module13/module13.http.test.ts",
    "test:module13:integration": "vitest run tests/module13/module13.integration.test.ts",
    "test:module13:specs": "vitest run tests/module13",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      throw new Error(`Backend package.json must expose ${name} as: ${command}`);
    }
  }
}

/** Confirms Pass 7 adds the independent React Shipping feature without inventing API surface. */
function verifyFrontendFeature() {
  const packageJson = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const api = readProjectFile("marketplace-frontend/src/features/shipping/api/shipping.api.ts");
  const hooks = readProjectFile("marketplace-frontend/src/features/shipping/hooks/use-shipping.ts");
  const createForm = readProjectFile("marketplace-frontend/src/features/shipping/forms/create-shipment.form.tsx");
  const trackingForm = readProjectFile("marketplace-frontend/src/features/shipping/forms/shipment-tracking.form.tsx");
  const sellerQueue = readProjectFile("marketplace-frontend/src/features/shipping/pages/seller-shipments.page.tsx");
  const sellerOrderShipping = readProjectFile("marketplace-frontend/src/features/shipping/pages/seller-order-shipping.page.tsx");
  const customerTracking = readProjectFile("marketplace-frontend/src/features/shipping/pages/customer-order-shipping.page.tsx");
  const routes = readProjectFile("marketplace-frontend/src/app/routes/shipping.routes.tsx");
  const router = readProjectFile("marketplace-frontend/src/app/router/router.tsx");
  const orderSchemas = readProjectFile("marketplace-frontend/src/features/orders/schemas/orders.schemas.ts");
  const tests = readProjectFile("marketplace-frontend/tests/module13-shipping.test.tsx");
  const frontendCi = readProjectFile("marketplace-frontend/.github/workflows/ci.yml");

  for (const required of [
    'apiClient.get("/seller/shipments"',
    'apiClient.post(`/seller/orders/${sellerOrderId}/shipments`',
    'apiClient.patch(`/seller/shipments/${shipmentId}/tracking`',
    'apiClient.post(`/seller/shipments/${shipmentId}/mark-shipped`',
    'apiClient.post(`/seller/shipments/${shipmentId}/mark-delivered`',
    'apiClient.get(`/orders/${orderId}/shipments`',
    'headers: { "Idempotency-Key": idempotencyKey }',
  ]) {
    requireText(api, required, "Module 13 Pass 7 frontend API");
  }

  requireText(hooks, "useQuery({", "Module 13 TanStack Query ownership");
  requireText(hooks, "useMutation({", "Module 13 TanStack mutation ownership");
  requireText(createForm, "useForm({", "Module 13 TanStack Form Shipment creation");
  requireText(createForm, "createShipmentFormSchema", "Module 13 Zod Shipment creation validation");
  requireText(trackingForm, "shipmentTrackingFormSchema", "Module 13 Zod tracking validation");
  requireText(sellerQueue, "Fulfillment Shipments", "Module 13 seller fulfillment queue");
  requireText(sellerOrderShipping, "CreateShipmentForm", "Module 13 Shipment allocation UI");
  requireText(sellerOrderShipping, "Mark shipped", "Module 13 mark-shipped command UI");
  requireText(sellerOrderShipping, "Mark delivered", "Module 13 mark-delivered command UI");
  requireText(customerTracking, "Only shipped or delivered Shipments are visible here.", "Module 13 customer-safe tracking language");

  for (const route of [
    'path: "/seller/shipments"',
    'path: "/seller/orders/$sellerOrderId/shipping"',
    'path: "/orders/$orderId/shipping"',
  ]) {
    requireText(routes, route, "Module 13 frontend route");
  }
  for (const registration of [
    "sellerShipmentsRoute",
    "sellerOrderShippingRoute",
    "customerOrderShippingRoute",
  ]) {
    requireText(router, registration, "Module 13 router registration");
  }

  requireText(orderSchemas, 'z.enum(["unfulfilled", "partially_fulfilled", "fulfilled"])', "Module 13 Order fulfillment frontend compatibility");

  for (const proof of [
    "renders the seller fulfillment queue and sends only allow-listed status filters",
    "creates a Shipment, saves tracking, and sends mark-shipped as an idempotent command",
    "renders only customer-safe shipped/delivered tracking fields",
    "shows a readable permission state without calling the seller Shipment API",
  ]) {
    requireText(tests, proof, "Module 13 Pass 7 RTL/MSW proof");
  }

  if (packageJson.scripts?.["test:module13"] !== "vitest run tests/module13-shipping.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 13 RTL/MSW suite.");
  }

  requireText(frontendCi, "Run Module 13 Shipping frontend tests", "Module 13 frontend CI step");
  requireText(frontendCi, "run: npm run test:module13", "Module 13 frontend CI command");

  for (const forbidden of [
    'apiClient.delete(`/seller/shipments',
    'apiClient.post("/shipping/methods"',
    'status: input.status',
  ]) {
    rejectText(api, forbidden, "Module 13 frontend authority/API surface");
  }
}

/** Confirms Pass 8 adds live Playwright proof, read-only reconciliation, and permanent release-gate wiring. */
function verifyFinalReleasePass() {
  const e2e = readProjectFile("marketplace-frontend/e2e/module13.spec.ts");
  const releaseVerifier = readProjectFile(
    "marketplace-backend/scripts/verify-module13-release-data.mjs",
  );
  const e2eRunner = readProjectFile("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const finalVerifier = readProjectFile("scripts/verify-module13.mjs");

  for (const required of [
    "creates, tracks, ships, replays, delivers, isolates, and exposes one customer-safe Shipment",
    "ships two concurrent partial Shipments and reconciles the parent Order to fulfilled",
    "M13-E2E-",
    "M13-CONCURRENT-",
    "SHIPMENT_NOT_FOUND",
    "Idempotency-Key",
  ]) {
    requireText(e2e, required, "Module 13 Pass 8 Playwright proof");
  }

  for (const required of [
    "Shipment allocation over commercial remaining quantity",
    "Shipped Shipment Inventory movement reconciliation",
    "Shipment lifecycle history reconciliation",
    "Parent Order fulfillment reconciliation",
    "Module 13 E2E replay duplicate Shipping evidence",
    "Module 13 post-E2E Shipping & Fulfillment reconciliation passed.",
  ]) {
    requireText(releaseVerifier, required, "Module 13 Pass 8 release-data verifier");
  }

  for (const required of [
    '"/api/v1/seller/shipments"',
    '"/api/v1/seller/orders/{sellerOrderId}/shipments"',
    '"/api/v1/seller/shipments/{id}/tracking"',
    '"/api/v1/seller/shipments/{id}/mark-shipped"',
    '"/api/v1/seller/shipments/{id}/mark-delivered"',
    '"/api/v1/orders/{orderId}/shipments"',
    '"e2e/module13.spec.ts"',
    '"test:module13:release-data"',
    '"test:module13"',
  ]) {
    requireText(e2eRunner, required, "Module 13 Pass 8 cross-repository release runner");
  }

  if (frontendPackage.scripts?.["test:e2e:module13"] !== "playwright test e2e/module13.spec.ts") {
    throw new Error("Frontend package.json must expose the focused Module 13 Playwright suite.");
  }
  if (
    backendPackage.scripts?.["test:module13:release-data"] !==
    "node scripts/verify-module13-release-data.mjs"
  ) {
    throw new Error("Backend package.json must expose the Module 13 post-browser release-data verifier.");
  }

  requireText(
    finalVerifier,
    "verify-module13-static.mjs",
    "Permanent Module 13 final verifier",
  );

  if (existsSync(join(root, "MODULE13_INSPECTION.md"))) {
    throw new Error("Temporary Module 13 pass evidence must not remain in the final release archive.");
  }
}

/** Runs the dependency-free Stage 16 Module 13 completed-module source gate. */
function main() {
  verifyReleasedPrerequisites();
  verifyIndependentProjects();
  verifyPatchContracts();
  verifyPass1DatabasePrerequisite();
  verifyShippingCoreCompatibility();
  verifyFulfillmentConstants();
  verifyFulfillmentSchemas();
  verifyOrdersContractExtension();
  verifyContractTests();
  verifyFulfillmentRepository();
  verifyFulfillmentService();
  verifyFulfillmentHttp();
  verifyBackendProof();
  verifyFrontendFeature();
  verifyFinalReleasePass();
  console.log(
    [
      "Module 13 Shipping & Fulfillment final structural verification passed;",
      "the exact seven-operation HTTP/OpenAPI boundary, backend proof, and React feature remain intact,",
      "Playwright now proves the live captured/accepted Shipment lifecycle, replay safety, seller isolation, customer tracking, and concurrent partial fulfillment,",
      "and the read-only post-browser verifier reconciles allocation, Inventory issue, history, audit/outbox, idempotency, and parent Order fulfillment.",
    ].join(" "),
  );
}

main();

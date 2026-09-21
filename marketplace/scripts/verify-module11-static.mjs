import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and fails with a focused Module 11 message when missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 11 Pass 8 file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one exact contract or implementation fragment to remain present. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one forbidden fragment from a boundary where it must not appear. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Requires one path to remain absent from the completed Module 11 release. */
function requireAbsent(relativePath, label) {
  if (existsSync(join(root, relativePath))) {
    throw new Error(`${label} must remain absent after Module 11 Pass 8: ${relativePath}`);
  }
}

/** Runs the released Module 10 structural gate before Module 11 checks. */
function verifyCheckoutPrerequisite() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module10-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Module 10 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms frontend/backend remain independent projects rather than a root workspace. */
function verifyIndependentProjects() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }
}

/** Confirms the approved Orders patch still contains the frozen Module 11 execution boundaries. */
function verifyOrdersContractPatch() {
  const patch = readProjectFile("REQUIREMENTS_PATCH_0005.md");

  for (const requiredDecision of [
    "**Status: APPROVED additive contract patch for the current implementation.**",
    "Approved Module 11 routes remain unchanged",
    "Checkout calls transaction-bound `OrdersService.createFromCheckout(...)`",
    "Checkout stores the returned `orderId` on `checkout_attempts.order_id`",
    "internal payment-confirmed route uses the existing `x-internal-api-key`",
    "cross-module business calls use services, never another module's repository",
  ]) {
    requireText(patch, requiredDecision, "Module 11 frozen execution decision");
  }
}

/** Confirms Module 11 keeps the approved persistence/runtime surface and adds no later-module migration. */
function verifyPassBoundary() {
  const ordersDirectory = join(root, "backend/src/modules/orders");
  for (const requiredFile of [
    "orders.constants.ts",
    "orders.schema.ts",
    "orders.repository.ts",
    "orders.service.ts",
    "orders.controller.ts",
    "orders.routes.ts",
    "index.ts",
  ]) {
    if (!existsSync(join(ordersDirectory, requiredFile))) {
      throw new Error(`Module 11 Pass 8 backend file is missing: ${requiredFile}`);
    }
  }

  requireAbsent("backend/src/modules/orders/orders.types.ts", "Unnecessary Orders type boilerplate");
  if (!existsSync(join(root, "frontend/src/features/orders"))) {
    throw new Error("Module 11 Pass 8 Orders frontend feature folder is missing.");
  }

  const migrationDirectory = join(root, "backend/drizzle");
  const migrations = readdirSync(migrationDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  if (!migrations.includes("0023_orders_persistence.sql")) {
    throw new Error("Module 11 Pass 8 must retain append-only migration 0023_orders_persistence.sql.");
  }
}

/** Confirms the Pass 1 persistence foundation remains intact. */
function verifyPersistenceFoundation() {
  const ordersSchema = readProjectFile("backend/src/database/schema/orders.ts");
  const inventorySchema = readProjectFile("backend/src/database/schema/inventory.ts");
  const migration = readProjectFile("backend/drizzle/0023_orders_persistence.sql");

  for (const fragment of [
    '"orders"',
    '"seller_orders"',
    '"order_items"',
    '"order_addresses"',
    '"order_status_history"',
    "orders_checkout_attempt_uq",
    "order_items_inventory_reservation_uq",
  ]) {
    requireText(ordersSchema, fragment, "Module 11 persistence foundation");
  }
  requireText(
    inventorySchema,
    'releasedQty: integer("released_qty").notNull().default(0)',
    "Inventory released quantity persistence",
  );
  requireText(
    migration,
    'ADD COLUMN "released_qty" integer DEFAULT 0 NOT NULL',
    "Module 11 append-only Inventory migration",
  );
}

/** Confirms the approved Pass 2 contracts and narrow prerequisite service boundaries remain intact. */
function verifyPass2ContractsAndPrerequisites() {
  const constants = readProjectFile("backend/src/modules/orders/orders.constants.ts");
  const schema = readProjectFile("backend/src/modules/orders/orders.schema.ts");
  const productsService = readProjectFile("backend/src/modules/products/products.service.ts");
  const inventoryService = readProjectFile("backend/src/modules/inventory/inventory.service.ts");

  for (const fragment of [
    "orders.read_own",
    "seller.orders.read",
    "seller.orders.manage",
    "admin.orders.read",
    "admin.orders.cancel",
    "ORDER_NOT_FOUND",
    "ORDER_STATUS_INVALID",
    "ORDER_SOURCE_DUPLICATE",
    'ORDER_CANCEL_REQUEST_VERSION = "orders-cancel-v1"',
  ]) {
    requireText(constants, fragment, "Orders fixed contract constant");
  }

  for (const contract of [
    "customerOrderListQuerySchema",
    "sellerOrderListQuerySchema",
    "adminOrderListQuerySchema",
    "paymentConfirmedBodySchema",
    "cancelOrderBodySchema",
    "createOrderFromCheckoutInputSchema",
    "customerOrderDetailSchema",
    "sellerOrderDetailSchema",
  ]) {
    requireText(schema, contract, "Orders Zod contract");
  }

  for (const fragment of [
    "skuSnapshot: string;",
    "nameSnapshot: string;",
    "variantTitleSnapshot: string | null;",
  ]) {
    requireText(productsService, fragment, "Orders Product snapshot boundary");
  }

  for (const fragment of [
    "async releaseReservationQuantity(",
    "static using(transaction: DatabaseTransaction)",
    "reservation.qty - reservation.consumedQty - reservation.releasedQty",
  ]) {
    requireText(inventoryService, fragment, "Orders Inventory partial-release boundary");
  }
}

/** Confirms the Pass 3 repository is scoped, persistence-only, and complete enough for the next service pass. */
function verifyOrdersRepository() {
  const repository = readProjectFile("backend/src/modules/orders/orders.repository.ts");
  const index = readProjectFile("backend/src/modules/orders/index.ts");

  for (const fragment of [
    "export interface OrderSellerScope",
    "function sellerOrderScopeCondition(",
    "function customerOrderSort(",
    "function sellerOrderSort(",
    "function adminSellerScopeFilter(",
    "export class OrdersRepository",
    "async createOrder(",
    "async createSellerOrders(",
    "async createOrderItems(",
    "async createOrderAddresses(",
    "async createStatusHistory(",
    "async findOrderByCheckoutAttemptId(",
    "async findOrderForCustomer(",
    "async listOverduePaymentOrderCandidates(",
    "async listOrdersForCustomer(",
    "async lockOrderForCustomer(",
    "async lockOrderById(",
    "async listSellerOrdersInScope(",
    "async findSellerOrderInScope(",
    "async lockSellerOrderInScope(",
    "async listAdminOrders(",
    "async lockOrderItemsByOrderId(",
    "async listOrderItemsBySellerOrderInScope(",
    "async listSellerOrderStatusHistoryInScope(",
    "async findStatusHistoryBySource(",
    "async markOrderPaymentCaptured(",
    "async updateDerivedOrderStatus(",
    "async updateSellerOrderStatus(",
    "async updateOrderItemCancellation(",
  ]) {
    requireText(repository, fragment, "Orders repository boundary");
  }

  for (const scopeProof of [
    "eq(orders.customerUserId, customerUserId)",
    "sellerOrderScopeCondition(scope)",
    "inArray(sellerOrders.sellerId, scope.sellerIds)",
    "inArray(sellerOrders.storeId, scope.storeIds)",
    "exists (select 1 from ${sellerOrders}",
    '.for("update")',
  ]) {
    requireText(repository, scopeProof, "Orders repository ownership/lock proof");
  }

  for (const forbidden of [
    "express",
    "RequestContext",
    "InventoryService",
    "OutboxService",
    "AuditService",
    "IdempotencyService",
    "createHash(",
    "deriveParent",
  ]) {
    rejectText(repository, forbidden, "Orders persistence-only repository");
  }

  requireText(index, 'export * from "./orders.repository.js";', "Orders module repository export");
}

/** Confirms Pass 4 places business rules, transactions, idempotency, Inventory composition, audit, and outbox in the service. */
function verifyOrdersService() {
  const service = readProjectFile("backend/src/modules/orders/orders.service.ts");
  const index = readProjectFile("backend/src/modules/orders/index.ts");

  for (const fragment of [
    "export class OrdersService",
    "static using(transaction: DatabaseTransaction)",
    "async createFromCheckout(",
    "async listCustomerOrders(",
    "async getCustomerOrder(",
    "async listSellerOrders(",
    "async getSellerOrder(",
    "async listAdminOrders(",
    "async confirmPayment(",
    "async listOverduePaymentOrderCandidates(",
    "System Payment maintenance is required.",
    "async expireUnpaidOrder(",
    "async acceptSellerOrder(",
    "async cancelCustomerOrder(",
    "async cancelAdminOrder(",
    "buildCheckoutSellerGroups(",
    "assertCheckoutMoneyReconciles(",
    "deriveParentOrderStatus(",
    "releaseReservationQuantity(",
    "commitStockReservation(",
    "IdempotencyService",
    "AuditService",
    "OutboxService",
    "ORDER_CANCEL_REQUEST_VERSION",
    "order-cancel:${order.id}:${idempotencyKeyHash}:${item.id}",
  ]) {
    requireText(service, fragment, "Orders service business boundary");
  }

  for (const eventName of [
    "ORDERS_OUTBOX_EVENT.CREATED",
    "ORDERS_OUTBOX_EVENT.SELLER_ORDER_CREATED",
    "ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED",
    "ORDERS_OUTBOX_EVENT.SELLER_ORDER_ACCEPTED",
    "ORDERS_OUTBOX_EVENT.CANCELLED",
    "ORDERS_OUTBOX_EVENT.STATUS_CHANGED",
  ]) {
    requireText(service, eventName, "Orders durable event orchestration");
  }

  for (const forbidden of [
    "express",
    "req.",
    "res.",
    "from \"../inventory/inventory.repository",
    "from \"../products/products.repository",
    "parseFloat(",
    "Number(input.grandTotal)",
  ]) {
    rejectText(service, forbidden, "Orders business service");
  }

  requireText(index, 'export * from "./orders.service.js";', "Orders module service export");
}

/** Confirms the exact nine-route HTTP/OpenAPI surface and same-transaction Checkout-to-Orders composition. */
function verifyPass5HttpAndCheckoutIntegration() {
  const controller = readProjectFile("backend/src/modules/orders/orders.controller.ts");
  const routes = readProjectFile("backend/src/modules/orders/orders.routes.ts");
  const app = readProjectFile("backend/src/app.ts");
  const openApi = readProjectFile("backend/src/http/openapi/openapi.document.ts");
  const checkoutService = readProjectFile("backend/src/modules/checkout/checkout.service.ts");
  const checkoutRepository = readProjectFile("backend/src/modules/checkout/checkout.repository.ts");
  const rbacSeed = readProjectFile("backend/src/database/seeds/platform-rbac.seed.ts");
  const index = readProjectFile("backend/src/modules/orders/index.ts");

  for (const method of [
    "listCustomerOrders = async",
    "getCustomerOrder = async",
    "listSellerOrders = async",
    "getSellerOrder = async",
    "acceptSellerOrder = async",
    "cancelCustomerOrder = async",
    "cancelAdminOrder = async",
    "listAdminOrders = async",
    "confirmPayment = async",
  ]) {
    requireText(controller, method, "Orders thin controller");
  }
  for (const forbidden of [".repository.js", "/database/", "new OrdersRepository"]) {
    rejectText(controller, forbidden, "Orders controller boundary");
  }

  for (const routeProof of [
    "createCustomerOrdersRouter",
    "createSellerOrdersRouter",
    "createAdminOrdersRouter",
    "createInternalOrdersRouter",
    "requirePermission(ORDERS_PERMISSION.READ_OWN)",
    "requirePermission(ORDERS_PERMISSION.SELLER_READ)",
    "requirePermission(ORDERS_PERMISSION.SELLER_MANAGE)",
    "requirePermission(ORDERS_PERMISSION.ADMIN_READ)",
    "requirePermission(ORDERS_PERMISSION.ADMIN_CANCEL)",
    "router.use(internalServiceMiddleware)",
    '"/api/v1/internal/orders/{id}/payment-confirmed"',
    "Idempotency-Key",
  ]) {
    requireText(routes, routeProof, "Orders route/OpenAPI surface");
  }
  requireText(index, 'export * from "./orders.controller.js";', "Orders controller export");
  requireText(index, 'export * from "./orders.routes.js";', "Orders routes export");

  for (const integrationProof of [
    "ordersUsingTransaction",
    "OrdersService.using(transaction)",
    "buildOrderCreationInput(",
    "reservationIdByVariant",
    ".createFromCheckout(",
    "attachOrderToAttempt(",
    "orderId: order.id",
  ]) {
    requireText(checkoutService, integrationProof, "Checkout-to-Orders same-transaction integration");
  }
  requireText(checkoutRepository, "async attachOrderToAttempt(", "Checkout Order-link repository write");

  for (const appProof of [
    "const ordersService = new OrdersService();",
    "const ordersController = new OrdersController(ordersService);",
    "createCustomerOrdersRouter(ordersController)",
    "createSellerOrdersRouter(ordersController)",
    "createAdminOrdersRouter(ordersController)",
    "createInternalOrdersRouter(ordersController)",
    "ordersUsingTransaction: (transaction) => OrdersService.using(transaction)",
    'app.use(`${API_V1_PREFIX}/orders`, customerOrdersRouter);',
    'app.use(`${API_V1_PREFIX}/seller/orders`, sellerOrdersRouter);',
    'app.use(`${API_V1_PREFIX}/admin/orders`, adminOrdersRouter);',
    'app.use(`${API_V1_PREFIX}/internal/orders`, internalOrdersRouter);',
  ]) {
    requireText(app, appProof, "Module 11 application composition");
  }
  requireText(openApi, "...ordersOpenApiPaths", "Orders OpenAPI registration");
  for (const permissionProof of [
    "...ORDERS_PERMISSION_CATALOG",
    "ORDERS_PERMISSION.READ_OWN",
    "ORDERS_PERMISSION.SELLER_READ",
    "ORDERS_PERMISSION.SELLER_MANAGE",
  ]) {
    requireText(rbacSeed, permissionProof, "Module 11 RBAC composition");
  }
}

/** Confirms Pass 6 keeps focused lower-layer tests and adds real Supertest/PostgreSQL reconciliation coverage. */
function verifyPass6BackendTests() {
  const repositoryTests = readProjectFile("backend/tests/module11/module11.repository.test.ts");
  const serviceTests = readProjectFile("backend/tests/module11/module11.service.test.ts");
  const integrationTests = readProjectFile("backend/tests/module11/module11.integration.test.ts");
  const helpers = readProjectFile("backend/tests/module11/module11.test-helpers.ts");
  const runner = readProjectFile("backend/scripts/run-module11-tests.mjs");
  const packageJson = readProjectFile("backend/package.json");
  const backendCi = readProjectFile("backend/.github/workflows/ci.yml");

  for (const proof of [
    "persists immutable Order snapshots and keeps customer/seller reads scoped",
    "supports source lookup, row locks, admin filtering, and service-approved lifecycle writes",
    "lists only overdue linked Orders that match the Payments maintenance state filter",
    "listOverduePaymentOrderCandidates",
    "findOrderByCheckoutAttemptId",
    "findSellerOrderInScope",
    "lockOrderItemsByOrderId",
    "findStatusHistoryBySource",
    "markOrderPaymentCaptured",
    "updateOrderItemCancellation",
  ]) {
    requireText(repositoryTests, proof, "Orders repository test proof");
  }

  for (const proof of [
    "creates one immutable parent Order plus deterministic reconciled Seller Orders from Checkout",
    "commits remaining reservations and moves Seller Orders to pending acceptance",
    "releases reserved quantity and derives child/parent cancellation state in the same transaction",
    "replays a completed customer cancellation without opening another transaction",
    "keeps seller acceptance scoped and treats an already-processing Seller Order as an exact retry",
  ]) {
    requireText(serviceTests, proof, "Orders service test proof");
  }

  for (const proof of [
    "materializes one immutable Customer Order with deterministic multi-seller split and exact money reconciliation",
    "enforces customer and seller isolation plus admin scoped search",
    "supports replay-safe pre-capture partial/full cancellation and Inventory reconciliation",
    "confirms payment exactly once, commits reservations, gates seller acceptance, and blocks post-capture cancellation",
    "rolls back partial reservation commits when payment confirmation hits a later invalid reservation",
    "countOrdersForAttempt",
    "readOrderItemReservations",
  ]) {
    requireText(
      integrationTests + helpers,
      proof,
      "Orders Pass 6 integration/reconciliation proof",
    );
  }

  for (const proof of [
    "test:module11:migrations",
    "test:module11:specs",
    "test:regression:contracts",
    "test:module10:specs",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, proof, "Orders Pass 6 cumulative backend runner");
  }

  requireText(packageJson, '"test:module11:specs": "vitest run tests/module11"', "Module 11 Pass 6 specs command");
  requireText(packageJson, '"test:module11": "node scripts/run-module11-tests.mjs"', "Module 11 Pass 6 runner command");
  requireText(backendCi, "npm run test:module11:migrations", "Module 11 migration CI gate");
  requireText(backendCi, "npm run test:module11:specs", "Module 11 backend CI gate");

  const serviceTestCommand =
    '"test:module11:service": "vitest run tests/module11/module11.schemas.test.ts ' +
    'tests/module11/module11.prerequisite-services.test.ts tests/module11/module11.repository.test.ts ' +
    'tests/module11/module11.service.test.ts"';
  requireText(packageJson, serviceTestCommand, "Module 11 Pass 4 npm test command");
  requireText(
    packageJson,
    '"test:module11:http": "vitest run tests/module11/module11.schemas.test.ts',
    "Module 11 Pass 5 HTTP test command",
  );
  requireText(
    packageJson,
    "tests/module11/module11.http.test.ts",
    "Module 11 Pass 5 HTTP test file",
  );
}


/** Confirms Pass 7 React/TanStack/Zod Orders behavior remains intact for the final E2E release. */
function verifyPass7Frontend() {
  const api = readProjectFile("frontend/src/features/orders/api/orders.api.ts");
  const hooks = readProjectFile("frontend/src/features/orders/hooks/use-orders.ts");
  const schemas = readProjectFile("frontend/src/features/orders/schemas/orders.schemas.ts");
  const cancellation = readProjectFile("frontend/src/features/orders/forms/order-cancellation.form.tsx");
  const customerList = readProjectFile("frontend/src/features/orders/pages/customer-orders.page.tsx");
  const customerDetail = readProjectFile("frontend/src/features/orders/pages/customer-order-detail.page.tsx");
  const sellerList = readProjectFile("frontend/src/features/orders/pages/seller-orders.page.tsx");
  const sellerDetail = readProjectFile("frontend/src/features/orders/pages/seller-order-detail.page.tsx");
  const adminPage = readProjectFile("frontend/src/features/orders/pages/admin-orders.page.tsx");
  const routes = readProjectFile("frontend/src/app/routes/orders.routes.tsx");
  const router = readProjectFile("frontend/src/app/router/router.tsx");
  const tests = readProjectFile("frontend/tests/module11-orders.test.tsx");
  const packageJson = readProjectFile("frontend/package.json");

  for (const fragment of [
    'apiClient.get("/orders"',
    'apiClient.get(`/orders/${orderId}`)',
    'apiClient.post(`/orders/${orderId}/cancel`',
    'apiClient.get("/seller/orders"',
    'apiClient.get(`/seller/orders/${sellerOrderId}`)',
    'apiClient.post(`/seller/orders/${sellerOrderId}/accept`, {})',
    'apiClient.get("/admin/orders"',
    'apiClient.post(`/admin/orders/${orderId}/cancel`',
  ]) {
    requireText(api, fragment, "Orders Pass 7 frontend API");
  }

  requireText(api, '"Idempotency-Key": idempotencyKey', "Orders cancellation idempotency header");
  requireText(hooks, "useQuery({", "Orders TanStack Query reads");
  requireText(hooks, "useMutation({", "Orders TanStack Query writes");
  requireText(schemas, "customerOrderDetailSchema", "Orders customer response validation");
  requireText(schemas, "sellerOrderDetailSchema", "Orders seller response validation");
  requireText(cancellation, "useForm({", "Orders TanStack Form cancellation flow");
  requireText(cancellation, "orderCancellationFormSchema", "Orders Zod cancellation validation");
  requireText(customerList, 'title="Your Orders"', "Orders parent/child UI separation");
  requireText(customerDetail, "Order timeline", "Orders customer detail timeline");
  requireText(sellerList, "Seller Order queue", "Orders seller queue");
  requireText(sellerDetail, "Accept Seller Order", "Orders seller acceptance command");
  requireText(adminPage, "Order support", "Orders admin search/support view");

  for (const fragment of [
    'path: "/orders"',
    'path: "/orders/$orderId"',
    'path: "/seller/orders"',
    'path: "/seller/orders/$sellerOrderId"',
    'path: "/admin/orders"',
  ]) {
    requireText(routes, fragment, "Orders Pass 7 route");
  }

  for (const registration of [
    "customerOrdersRoute",
    "customerOrderDetailRoute",
    "sellerOrdersRoute",
    "sellerOrderDetailRoute",
    "adminOrdersRoute",
  ]) {
    requireText(router, registration, "Orders router registration");
  }

  for (const proof of [
    "renders customer parent Order history without treating Seller Orders as the customer list model",
    "renders immutable customer Order detail and sends a partial cancellation with a retry key",
    "blocks customer Order reads before calling the API when orders.read_own is missing",
    "renders only seller-scoped Seller Orders and accepts one paid fulfillment unit without client status fields",
    "hides Seller Order acceptance when the actor has read permission but not seller.orders.manage",
    "searches admin Orders with allow-listed filters and performs privileged whole-Order cancellation",
    "shows the safe request ID when customer Order history fails",
  ]) {
    requireText(tests, proof, "Orders Pass 7 RTL/MSW proof");
  }

  requireText(
    packageJson,
    '"test:module11": "vitest run tests/module11-orders.test.tsx"',
    "Orders Pass 7 focused frontend test command",
  );
  rejectText(api, "/internal/orders", "Orders frontend trusted-internal boundary");
}

/** Confirms Pass 8 adds the real browser workflow, reconciliation check, and full release verifier. */
function verifyPass8E2eRelease() {
  const e2e = readProjectFile("frontend/e2e/module11.spec.ts");
  const e2eRunner = readProjectFile("frontend/e2e/run-e2e-ci.mjs");
  const frontendPackage = readProjectFile("frontend/package.json");
  const releaseData = readProjectFile("backend/scripts/verify-module11-release-data.mjs");
  const backendPackage = readProjectFile("backend/package.json");
  const releaseVerifier = readProjectFile("scripts/verify-module11.mjs");
  const module10E2e = readProjectFile("frontend/e2e/module10.spec.ts");

  for (const proof of [
    "creates one multi-seller parent Order, preserves immutable snapshots, and accepts only seller-scoped units",
    "cancels one pre-capture item quantity in the UI, safely replays it, and releases exact reserved stock",
    "x-internal-api-key",
    "SELLER_ORDER_SCOPE_FORBIDDEN",
    "Module 11 Mutated Product Name",
    "Accept Seller Order",
    "Order status timeline",
  ]) {
    requireText(e2e, proof, "Orders Pass 8 Playwright proof");
  }

  for (const runnerProof of [
    '"e2e/module11.spec.ts"',
    '"/api/v1/orders"',
    '"/api/v1/internal/orders/{id}/payment-confirmed"',
    '"test:module11:release-data"',
    "Run Playwright Foundation through Module",
    "E2E_INTERNAL_API_KEY",
  ]) {
    requireText(e2eRunner, runnerProof, "Orders cumulative E2E runner");
  }

  requireText(
    frontendPackage,
    '"test:e2e:module11": "playwright test e2e/module11.spec.ts"',
    "Orders focused Playwright command",
  );
  requireText(
    backendPackage,
    '"test:module11:release-data": "node scripts/verify-module11-release-data.mjs"',
    "Orders release-data command",
  );

  for (const reconciliationProof of [
    "Parent Order to Seller Order aggregate reconciliation",
    "Seller Order to immutable item aggregate reconciliation",
    "Checkout attempt to Customer Order one-to-one link",
    "Module 11 immutable Product snapshot proof",
    "Module 11 partial cancellation release proof",
    "Module 11 captured/processing lifecycle proof",
  ]) {
    requireText(releaseData, reconciliationProof, "Orders post-E2E reconciliation proof");
  }

  for (const verifierProof of [
    '"verify-module11-static.mjs"',
    '["run", "test:module11"]',
    '["run", "test:e2e:ci"]',
    "Module 11 Orders full release verification completed successfully.",
  ]) {
    requireText(releaseVerifier, verifierProof, "Orders final release verifier");
  }

  requireText(module10E2e, "expect(attempt.orderId).toMatch", "Checkout-to-Orders affected E2E path");
  // Later dependency-ordered modules may now exist; Module 11 release proof must stay forward-compatible.
}

verifyCheckoutPrerequisite();
verifyIndependentProjects();
verifyOrdersContractPatch();
verifyPassBoundary();
verifyPersistenceFoundation();
verifyPass2ContractsAndPrerequisites();
verifyOrdersRepository();
verifyOrdersService();
verifyPass5HttpAndCheckoutIntegration();
verifyPass6BackendTests();
verifyPass7Frontend();
verifyPass8E2eRelease();

console.log("Module 11 Pass 8 E2E and final release verification passed.");

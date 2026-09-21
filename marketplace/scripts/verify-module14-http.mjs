import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required source file and reports the exact missing Pass 5 path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Module 14 Pass 5 file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

/** Requires one permanent HTTP/RBAC/OpenAPI fragment. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one route or authority fragment that the frozen Module 14 contract forbids. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Confirms thin controllers validate boundaries and delegate all business decisions to the service. */
function verifyController() {
  const controller = read(
    "backend/src/modules/returns-refunds/returns-refunds.controller.ts",
  );
  for (const expected of [
    "export class ReturnsRefundsController",
    "createReturnRequest = async (",
    "listCustomerReturns = async (",
    "listSellerReturns = async (",
    "approveReturn = async (",
    "rejectReturn = async (",
    "receiveReturn = async (",
    "issueRefund = async (",
    "listAdminReturns = async (",
    "returnOrderIdParamsSchema.parse(request.params)",
    "createReturnRequestBodySchema.parse(request.body)",
    "customerReturnListQuerySchema.parse(request.query)",
    "sellerReturnListQuerySchema.parse(request.query)",
    "returnRequestIdParamsSchema.parse(request.params)",
    "returnRefundIdempotencyHeadersSchema.parse(request.headers)",
    "adminReturnListQuerySchema.parse(request.query)",
  ]) {
    requireText(controller, expected, "Module 14 controller");
  }

  for (const forbidden of [
    "ReturnsRefundsRepository",
    "db.",
    "withTransaction(",
    "refundPayment(",
    "restockStock(",
  ]) {
    rejectText(controller, forbidden, "Thin Module 14 controller boundary");
  }
}

/** Confirms the runtime and OpenAPI expose exactly the eight frozen Module 14 operations. */
function verifyRoutesAndOpenApi() {
  const routes = read(
    "backend/src/modules/returns-refunds/returns-refunds.routes.ts",
  );
  for (const expected of [
    "export function createOrderReturnsRouter(",
    "export function createReturnsRouter(",
    "export function createSellerReturnsRouter(",
    "export function createAdminReturnsRouter(",
    '"/:orderId/returns"',
    '"/:id/refund"',
    '"/:id/approve"',
    '"/:id/reject"',
    '"/:id/receive"',
    "requirePermission(RETURNS_PERMISSION.CREATE_OWN)",
    "requirePermission(RETURNS_PERMISSION.READ_OWN)",
    "requirePermission(RETURNS_PERMISSION.SELLER_MANAGE)",
    "requirePermission(RETURNS_PERMISSION.ADMIN_MANAGE)",
    "requirePermission(RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE)",
    '"/api/v1/orders/{orderId}/returns"',
    '"/api/v1/returns"',
    '"/api/v1/seller/returns"',
    '"/api/v1/seller/returns/{id}/approve"',
    '"/api/v1/seller/returns/{id}/reject"',
    '"/api/v1/seller/returns/{id}/receive"',
    '"/api/v1/returns/{id}/refund"',
    '"/api/v1/admin/returns"',
    'name: "Idempotency-Key"',
    "returnRefundIdempotencyHeadersSchema",
    "...Object.values(RETURNS_ERROR_CODE)",
  ]) {
    requireText(routes, expected, "Module 14 routes/OpenAPI");
  }

  for (const forbidden of [
    'router.delete(',
    '"/api/v1/returns/{id}"',
    '"/api/v1/returns/{id}/status"',
    '"/api/v1/returns/{id}/restock"',
    '"/api/v1/returns/{id}/dispute-notes"',
  ]) {
    rejectText(routes, forbidden, "Unapproved Module 14 HTTP surface");
  }
}

/** Confirms Module 14 is mounted through composed service boundaries rather than repository shortcuts. */
function verifyApplicationComposition() {
  const app = read("backend/src/app.ts");
  for (const expected of [
    "ReturnsRefundsController",
    "ReturnsRefundsService",
    "createOrderReturnsRouter(returnsRefundsController)",
    "createReturnsRouter(returnsRefundsController)",
    "createSellerReturnsRouter(returnsRefundsController)",
    "createAdminReturnsRouter(returnsRefundsController)",
    "administration: administrationService",
    "payments: paymentsService",
    "inventory: inventoryService",
    "commissions: commissionsService",
    "ordersUsingTransaction: (transaction) => OrdersService.using(transaction)",
    "shippingUsingTransaction: (transaction) => ShippingService.using(transaction)",
    'app.use(`${API_V1_PREFIX}/orders`, orderReturnsRouter);',
    'app.use(`${API_V1_PREFIX}/returns`, returnsRouter);',
    'app.use(`${API_V1_PREFIX}/seller/returns`, sellerReturnsRouter);',
    'app.use(`${API_V1_PREFIX}/admin/returns`, adminReturnsRouter);',
  ]) {
    requireText(app, expected, "Module 14 application composition");
  }
}

/** Confirms all Module 14 permissions are seeded into the intended existing system roles. */
function verifyRbacComposition() {
  const seed = read("backend/src/database/seeds/platform-rbac.seed.ts");
  for (const expected of [
    "RETURNS_PERMISSION_CATALOG",
    "...RETURNS_PERMISSION_CATALOG",
    "RETURNS_PERMISSION.CREATE_OWN",
    "RETURNS_PERMISSION.READ_OWN",
    "RETURNS_PERMISSION.SELLER_MANAGE",
  ]) {
    requireText(seed, expected, "Module 14 RBAC seed composition");
  }

  // Platform super-admin receives the full platform catalog, including admin Return/refund permissions.
  requireText(seed, "PLATFORM_PERMISSION_CATALOG", "Module 14 platform-admin RBAC composition");
}

/** Confirms central OpenAPI registration and regression surface lock include Module 14. */
function verifyCentralContracts() {
  const openApi = read("backend/src/http/openapi/openapi.document.ts");
  const regression = read(
    "backend/tests/regression/implemented-api-contracts.test.ts",
  );
  const schema = read(
    "backend/src/modules/returns-refunds/returns-refunds.schema.ts",
  );
  const moduleIndex = read(
    "backend/src/modules/returns-refunds/index.ts",
  );

  requireText(openApi, "returnsRefundsOpenApiPaths", "Central OpenAPI document");
  requireText(openApi, "Returns, Refunds & Disputes", "Module 14 OpenAPI tag");
  requireText(regression, "returnsRefundsOpenApiPaths", "API regression contract");
  requireText(regression, "exactly the eight approved operations", "API regression contract");
  requireText(regression, 'name: "Idempotency-Key"', "API regression refund contract");
  requireText(regression, 'expect(module14OpenApi).toContain(\'"history"\')', "Module 14 history OpenAPI proof");
  requireText(schema, "history: z.array(returnStatusHistoryResponseSchema).optional()", "Module 14 response contract");
  requireText(moduleIndex, 'export * from "./returns-refunds.routes.js";', "Module 14 public index");
}

verifyController();
verifyRoutesAndOpenApi();
verifyApplicationComposition();
verifyRbacComposition();
verifyCentralContracts();
console.log("Module 14 HTTP/RBAC/OpenAPI verification passed.");

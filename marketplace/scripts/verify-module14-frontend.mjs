import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required Module 14 frontend file and reports its exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Required Module 14 React file is missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

/** Requires one durable React feature fragment. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one browser API/authority fragment that Module 14 does not expose. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Confirms the React feature uses only the eight approved Module 14 backend operations. */
function verifyApiSurface() {
  const api = read("frontend/src/features/returns-refunds/api/returns-refunds.api.ts");
  for (const expected of [
    'apiClient.post(`/orders/${orderId}/returns`',
    'apiClient.get("/returns"',
    'apiClient.get("/seller/returns"',
    'apiClient.post(`/seller/returns/${returnId}/approve`',
    'apiClient.post(`/seller/returns/${returnId}/reject`',
    'apiClient.post(`/seller/returns/${returnId}/receive`',
    'apiClient.post(`/returns/${returnId}/refund`',
    'apiClient.get("/admin/returns"',
    'headers: { "Idempotency-Key": idempotencyKey }',
  ]) {
    requireText(api, expected, "Module 14 frontend API");
  }

  for (const forbidden of [
    "/dispute-notes",
    "/restock",
    "/status",
    "refundAmount:",
    "restockQty:",
    "sellerId:",
  ]) {
    rejectText(api, forbidden, "Module 14 frontend API authority");
  }
}

/** Confirms Query owns server state and TanStack Form + Zod own Return form state. */
function verifyStateAndForms() {
  const hooks = read("frontend/src/features/returns-refunds/hooks/use-returns-refunds.ts");
  const requestForm = read("frontend/src/features/returns-refunds/forms/return-request.form.tsx");
  const inspectionForm = read("frontend/src/features/returns-refunds/forms/return-inspection.form.tsx");
  const refundForm = read("frontend/src/features/returns-refunds/forms/return-refund.form.tsx");
  const schemas = read("frontend/src/features/returns-refunds/schemas/returns-refunds.schemas.ts");

  requireText(hooks, "useQuery({", "Module 14 TanStack Query reads");
  requireText(hooks, "useMutation({", "Module 14 TanStack Query commands");
  requireText(requestForm, "useForm({", "Module 14 Return Request form");
  requireText(requestForm, "returnRequestFormSchema", "Module 14 Return Request Zod validation");
  requireText(inspectionForm, "receiveReturnFormSchema", "Module 14 inspection Zod validation");
  requireText(refundForm, "useStableIdempotencyKey", "Module 14 retry-stable idempotency controller");
  requireText(refundForm, "commandKey.keyFor(fingerprint)", "Module 14 refund retry key reuse");
  requireText(schemas, "returnMoneySchema", "Module 14 scale-4 response contract");
  requireText(schemas, "refundAmount: returnMoneySchema", "Module 14 refund response parsing");
  requireText(schemas, "restockQty: z.number().int().nonnegative()", "Module 14 restock response parsing");
  requireText(schemas, "returnStatusHistorySchema", "Module 14 Return history parser contract");
  requireText(
    schemas,
    "history: z.array(returnStatusHistorySchema).optional()",
    "Module 14 additive Return history parsing",
  );
}

/** Confirms customer, seller, and admin pages cover the required Module 14 workflows. */
function verifyPagesAndRoutes() {
  const createPage = read("frontend/src/features/returns-refunds/pages/customer-create-return.page.tsx");
  const customerPage = read("frontend/src/features/returns-refunds/pages/customer-returns.page.tsx");
  const sellerPage = read("frontend/src/features/returns-refunds/pages/seller-returns.page.tsx");
  const adminPage = read("frontend/src/features/returns-refunds/pages/admin-returns.page.tsx");
  const timeline = read("frontend/src/features/returns-refunds/components/return-timeline.tsx");
  const routes = read("frontend/src/app/routes/returns-refunds.routes.tsx");
  const router = read("frontend/src/app/router/router.tsx");

  for (const expected of [
    "deliveredByItem",
    "reservedByItem",
    "ReturnRequestForm",
  ]) {
    requireText(createPage, expected, "Module 14 customer Return wizard");
  }
  requireText(customerPage, "Return timeline", "Module 14 customer timeline");
  requireText(customerPage, "Refund and restock breakdown", "Module 14 customer refund breakdown");
  requireText(sellerPage, "ApproveReturnForm", "Module 14 seller approval");
  requireText(sellerPage, "RejectReturnForm", "Module 14 seller rejection");
  requireText(sellerPage, "ReturnInspectionForm", "Module 14 seller inspection");
  requireText(adminPage, "Returns & dispute queue", "Module 14 admin dispute view");
  requireText(adminPage, "ReturnRefundForm", "Module 14 privileged refund UI");
  requireText(adminPage, "it does not expose dispute-note CRUD", "Module 14 dispute-note scope honesty");
  requireText(timeline, "const history = value.history ?? []", "Module 14 persisted lifecycle timeline");
  requireText(timeline, "at: entry.changedAt", "Module 14 lifecycle timestamps");
  requireText(timeline, "reason: entry.reason", "Module 14 lifecycle reasons");
  rejectText(timeline, '{ label: "Received", at: null', "Module 14 placeholder lifecycle timeline");
  rejectText(timeline, '{ label: "Closed", at: null', "Module 14 placeholder lifecycle timeline");

  for (const expected of [
    'path: "/returns"',
    'path: "/orders/$orderId/returns/$sellerOrderId/new"',
    'path: "/seller/returns"',
    'path: "/admin/returns"',
  ]) {
    requireText(routes, expected, "Module 14 frontend route");
  }
  for (const expected of [
    "customerReturnsRoute",
    "customerCreateReturnRoute",
    "sellerReturnsRoute",
    "adminReturnsRoute",
  ]) {
    requireText(router, expected, "Module 14 router registration");
  }
}

/** Confirms focused RTL/MSW proof and CI/package wiring remain present after later release passes. */
function verifyTestsAndPassBoundary() {
  const tests = read("frontend/tests/module14-returns-refunds.test.tsx");
  const ci = read("frontend/.github/workflows/ci.yml");
  const packageJson = JSON.parse(read("frontend/package.json"));

  for (const expected of [
    "potentially delivered quantity",
    "explicit server-owned commands",
    "retry-safe key",
    "readable seller permission state",
    "renders persisted Return lifecycle timestamps and reasons instead of placeholder states",
    "Warehouse inspection complete.",
    "not.toHaveProperty(\"refundAmount\")",
    "not.toHaveProperty(\"restockQty\")",
  ]) {
    requireText(tests, expected, "Module 14 RTL/MSW proof");
  }

  if (packageJson.scripts?.["test:module14"] !== "vitest run tests/module14-returns-refunds.test.tsx") {
    throw new Error("Frontend package.json must expose the focused Module 14 RTL/MSW suite.");
  }
  requireText(ci, "Run Module 14 Returns/refunds frontend tests", "Module 14 frontend CI step");
  requireText(ci, "run: npm run test:module14", "Module 14 frontend CI command");

}

verifyApiSurface();
verifyStateAndForms();
verifyPagesAndRoutes();
verifyTestsAndPassBoundary();
console.log("Module 14 React feature verification passed; later Playwright/release-data proof may coexist.");

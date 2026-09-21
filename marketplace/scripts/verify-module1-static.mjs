import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required Module 1 file and reports the exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 1 file is missing: ${relativePath}`);
  }
  const source = readFileSync(absolutePath, "utf8");
  return relativePath.endsWith("package.json")
    ? JSON.stringify(JSON.parse(source.replace(/^\uFEFF/u, "")), null, 2)
    : source;
}

/** Requires one source fragment that proves a fixed Module 1 contract. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms the append-only Dashboard persistence layer remains intact. */
function verifyDatabasePass() {
  const schema = read("backend/src/database/schema/dashboard.ts");
  const migration = read("backend/drizzle/0034_dashboard.sql");
  const migrations = readdirSync(path.join(root, "backend", "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();

  if (!migrations.includes("0034_dashboard.sql")) {
    throw new Error("Module 1 requires the immutable 0034_dashboard.sql migration in append-only history.");
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const expectedPrefix = String(index).padStart(4, "0");
    if (!migrations[index].startsWith(`${expectedPrefix}_`)) {
      throw new Error(`Migration history must remain contiguous; expected ${expectedPrefix}_*.sql, found ${migrations[index]}.`);
    }
  }
  for (const tableName of ["dashboard_preferences", "dashboard_saved_filters"]) {
    requireText(schema, `"${tableName}"`, "Module 1 Drizzle schema");
    requireText(migration, `"${tableName}"`, "Module 1 migration");
  }
}

/** Confirms Dashboard boundary contracts and central RBAC composition remain stable. */
function verifyContractPass() {
  const constants = read("backend/src/modules/dashboard/dashboard.constants.ts");
  const schema = read("backend/src/modules/dashboard/dashboard.schema.ts");
  const index = read("backend/src/modules/dashboard/index.ts");
  const rbacSeed = read("backend/src/database/seeds/platform-rbac.seed.ts");
  const tests = read("backend/tests/module1/module1.schemas.test.ts");
  const packageJson = JSON.parse(read("backend/package.json"));

  for (const expected of [
    "dashboard.read",
    "dashboard.finance.read",
    "dashboard.seller.read",
    "dashboard.manage_preferences",
    "DASHBOARD_SCOPE_FORBIDDEN",
    "DASHBOARD_WIDGET_UNAVAILABLE",
    "INVALID_DASHBOARD_FILTER",
    "/api/v1/dashboard/summary",
    "/api/v1/dashboard/orders",
    "/api/v1/dashboard/sellers",
    "/api/v1/dashboard/alerts",
    "/api/v1/dashboard/preferences",
    "dashboard.preferences_updated",
  ]) {
    requireText(constants, expected, "Module 1 constants");
  }

  for (const expected of [
    "dashboardSummaryQuerySchema",
    "dashboardOrdersQuerySchema",
    "dashboardSellersQuerySchema",
    "dashboardAlertsQuerySchema",
    "updateDashboardPreferencesBodySchema",
    "dashboardSummaryResponseSchema",
    "dashboardOrdersResponseSchema",
    "dashboardSellersResponseSchema",
    "dashboardAlertsResponseSchema",
    "dashboardPreferencesResponseSchema",
    "categoryId: uuidSchema.optional()",
    "dashboardWidgetCodeSchema",
  ]) {
    requireText(schema, expected, "Module 1 Zod contracts");
  }

  requireText(index, 'export * from "./dashboard.constants.js";', "Module 1 index");
  requireText(index, 'export * from "./dashboard.schema.js";', "Module 1 index");
  requireText(rbacSeed, "DASHBOARD_PERMISSION_CATALOG", "Platform RBAC composition");
  requireText(rbacSeed, "DASHBOARD_PERMISSION.SELLER_READ", "Seller Dashboard RBAC grants");
  requireText(tests, "Module 1 Dashboard contracts", "Module 1 contract tests");

  if (packageJson.scripts?.["test:module1:contracts"] !==
      "vitest run tests/module1/module1.schemas.test.ts") {
    throw new Error("Backend package.json must expose test:module1:contracts.");
  }
}

/** Confirms Pass 3 repository code keeps ownership filters and business decisions in the correct layer. */
function verifyRepositoryPass() {
  const repository = read("backend/src/modules/dashboard/dashboard.repository.ts");
  const index = read("backend/src/modules/dashboard/index.ts");
  const tests = read("backend/tests/module1/module1.repository.test.ts");
  const packageJson = JSON.parse(read("backend/package.json"));

  for (const expected of [
    "export interface DashboardReadScope",
    "export type DashboardInventoryReadFilter",
    "export type DashboardSellerStoreDateReadFilter",
    "export type DashboardSellerDateReadFilter",
    "findStoreScope",
    "findPreferencesByUserId",
    "listSavedFiltersByUserId",
    "upsertPreferences",
    "replaceSavedFilters",
    "countLowStockVariants",
    "countOpenReturns",
    "listLowStockSources",
    "countFulfillmentSources",
    "listFulfillmentSources",
    "listReturnSources",
    "countPayoutSources",
    "listPayoutSources",
    "sellerScopeCondition",
    "storeScopeCondition",
  ]) {
    requireText(repository, expected, "Module 1 repository");
  }

  requireText(index, 'export * from "./dashboard.repository.js";', "Module 1 index");
  requireText(tests, "Module 1 Dashboard repository boundaries", "Module 1 repository tests");
  requireText(tests, "foreignSellerScope", "Module 1 seller-isolation repository test");
  requireText(tests, "foreignStoreScope", "Module 1 store-isolation repository test");

  if (repository.includes("DASHBOARD_PERMISSION") || repository.includes("RequestContext")) {
    throw new Error("Dashboard repository must not make authorization decisions.");
  }
  if (repository.includes("dashboard.service") || repository.includes("dashboard.controller")) {
    throw new Error("Dashboard repository must not depend on higher HTTP/business layers.");
  }
  if (repository.includes("../reports/") || repository.includes("ReportsRepository") || repository.includes("ReportsService")) {
    throw new Error("Dashboard repository must not duplicate or couple to Module 20 report business definitions.");
  }
  if (packageJson.scripts?.["test:module1:repository"] !==
      "vitest run tests/module1/module1.schemas.test.ts tests/module1/module1.repository.test.ts") {
    throw new Error("Backend package.json must expose test:module1:repository.");
  }

}

/** Confirms Pass 4 owns Dashboard business orchestration without bypassing Module 20 KPI definitions. */
function verifyServicePass() {
  const service = read("backend/src/modules/dashboard/dashboard.service.ts");
  const index = read("backend/src/modules/dashboard/index.ts");
  const tests = read("backend/tests/module1/module1.service.test.ts");
  const packageJson = JSON.parse(read("backend/package.json"));

  for (const expected of [
    "export class DashboardService",
    "getSummary",
    "getOrders",
    "getSellers",
    "getAlerts",
    "updatePreferences",
    "resolveReadScope",
    "reportContext",
    "loadAllSalesRows",
    "DASHBOARD_OUTBOX_EVENT.PREFERENCES_UPDATED",
    "DASHBOARD_PERMISSION.FINANCE_READ",
    "assertSellerReadPermission",
    "DASHBOARD_PERMISSION.SELLER_READ",
    "REPORTS_PERMISSION.SALES_READ",
    "REPORTS_PERMISSION.SELLER_READ",
    "REPORTS_PERMISSION.FINANCE_READ",
    "AuditService.using",
    "OutboxService.using",
    "withTransaction",
  ]) {
    requireText(service, expected, "Module 1 service");
  }

  requireText(index, 'export * from "./dashboard.service.js";', "Module 1 index");
  requireText(tests, "Module 1 Dashboard service", "Module 1 service tests");
  requireText(tests, "DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN", "Module 1 service isolation test");
  requireText(tests, "dashboard.preferences_updated", "Module 1 preference audit/outbox test");

  if (service.includes("../../database/db") || service.includes(".select(") || service.includes(".insert(")) {
    throw new Error("Dashboard service must not bypass repository/service boundaries with direct SQL access.");
  }
  if (!service.includes('from "../reports/reports.service.js"')) {
    throw new Error("Dashboard service must reuse Module 20 report business definitions.");
  }
  if (packageJson.scripts?.["test:module1:service"] !==
      "vitest run tests/module1/module1.service.test.ts") {
    throw new Error("Backend package.json must expose test:module1:service.");
  }

}

/** Confirms Pass 5 exposes only the five documented Dashboard operations with RBAC and OpenAPI parity. */
function verifyHttpPass() {
  const controller = read("backend/src/modules/dashboard/dashboard.controller.ts");
  const routes = read("backend/src/modules/dashboard/dashboard.routes.ts");
  const index = read("backend/src/modules/dashboard/index.ts");
  const app = read("backend/src/app.ts");
  const openApi = read("backend/src/http/openapi/openapi.document.ts");

  for (const expected of [
    "export class DashboardController",
    "getSummary",
    "getOrders",
    "getSellers",
    "getAlerts",
    "updatePreferences",
    "parseDashboardQuery",
    "DASHBOARD_ERROR_CODE.FILTER_INVALID",
    "getRequestContext",
    "successResponse",
  ]) {
    requireText(controller, expected, "Module 1 controller");
  }

  for (const expected of [
    "export function createDashboardRouter",
    'router.get(\n    "/summary"',
    'router.get(\n    "/orders"',
    'router.get(\n    "/sellers"',
    'router.get(\n    "/alerts"',
    'router.patch(\n    "/preferences"',
    "DASHBOARD_PERMISSION.READ",
    "DASHBOARD_PERMISSION.SELLER_READ",
    "DASHBOARD_PERMISSION.MANAGE_PREFERENCES",
    "export const dashboardOpenApiPaths",
    "dashboardSummaryResponseSchema",
    "dashboardOrdersResponseSchema",
    "dashboardSellersResponseSchema",
    "dashboardAlertsResponseSchema",
    "dashboardPreferencesResponseSchema",
  ]) {
    requireText(routes, expected, "Module 1 routes/OpenAPI");
  }

  for (const documentedPath of [
    "/api/v1/dashboard/summary",
    "/api/v1/dashboard/orders",
    "/api/v1/dashboard/sellers",
    "/api/v1/dashboard/alerts",
    "/api/v1/dashboard/preferences",
  ]) {
    requireText(read("backend/src/modules/dashboard/dashboard.constants.ts"), documentedPath, "Module 1 documented paths");
  }

  requireText(index, 'export * from "./dashboard.controller.js";', "Module 1 index");
  requireText(index, 'export * from "./dashboard.routes.js";', "Module 1 index");
  requireText(app, "DashboardService", "Express Dashboard composition");
  requireText(app, "DashboardController", "Express Dashboard composition");
  requireText(app, "createDashboardRouter", "Express Dashboard composition");
  requireText(app, 'app.use(`${API_V1_PREFIX}/dashboard`, dashboardRouter);', "Express Dashboard mount");
  requireText(openApi, "dashboardOpenApiPaths", "Central OpenAPI Dashboard registration");
  requireText(openApi, 'name: "Dashboard"', "Central OpenAPI Dashboard tag");

  if (routes.includes("router.post(") || routes.includes("router.put(") || routes.includes("router.delete(")) {
    throw new Error("Dashboard routes must not invent undocumented POST/PUT/DELETE CRUD operations.");
  }
  if (existsSync(path.join(root, "backend/src/modules/dashboard/dashboard.types.ts"))) {
    throw new Error("Module 1 must not add an unnecessary dashboard.types.ts file.");
  }
}


/** Confirms Pass 6 adds direct repository/service/HTTP/integration proof and a provisioned backend runner. */
function verifyBackendTestsPass() {
  const http = read("backend/tests/module1/module1.http.test.ts");
  const integration = read("backend/tests/module1/module1.integration.test.ts");
  const helpers = read("backend/tests/module1/module1.test-helpers.ts");
  const runner = read("backend/scripts/run-module1-tests.mjs");
  const packageJson = JSON.parse(read("backend/package.json"));
  const ci = read("backend/.github/workflows/ci.yml");

  for (const expected of [
    "Module 1 Dashboard HTTP/RBAC integration",
    "requires authentication and Dashboard permission before private reads",
    "rejects Seller B reads and preference writes against Seller A scope",
    "returns the stable Dashboard error codes for malformed and unsupported filters",
    "persists only the current user's preferences and commits audit/outbox in the same successful command",
    "rejects a mixed-scope preference payload before any Dashboard write is committed",
    "keeps OpenAPI parity with exactly the documented Dashboard paths and methods",
  ]) {
    requireText(http, expected, "Module 1 HTTP tests");
  }

  for (const expected of [
    "Module 1 Dashboard cross-module integration",
    "matches Dashboard seller GMV/order KPIs to the stable Module 20 Sales source",
    "keeps one parent Order count while its seller-order GMV is aggregated exactly once in the Dashboard trend",
    "returns finance fields only to the platform actor while preserving separate money concepts",
  ]) {
    requireText(integration, expected, "Module 1 integration tests");
  }

  requireText(helpers, "resetModule1HttpTables", "Module 1 test helpers");
  requireText(helpers, "countDashboardAuditActions", "Module 1 test helpers");
  requireText(helpers, "countDashboardOutboxEvents", "Module 1 test helpers");
  requireText(runner, '"test:module1:specs"', "Module 1 backend runner");
  requireText(runner, '"test:regression:contracts"', "Module 1 backend runner");
  requireText(runner, '"typecheck"', "Module 1 backend runner");
  requireText(runner, '"lint"', "Module 1 backend runner");
  requireText(runner, '"build"', "Module 1 backend runner");

  const expectedScripts = {
    "test:module1:http": "vitest run tests/module1/module1.http.test.ts",
    "test:module1:integration": "vitest run tests/module1/module1.integration.test.ts",
    "test:module1:specs": "vitest run tests/module1",
    "test:module1": "node scripts/run-module1-tests.mjs",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      throw new Error(`Backend package.json must expose ${name} as ${command}.`);
    }
  }

  if (!ci.includes("npm run test:module1:specs")) {
    throw new Error("Backend CI must execute the complete Module 1 backend test suite.");
  }
}

/** Confirms the React Dashboard owns the documented five-route client surface and required role-aware widgets. */
function verifyFrontendPass() {
  const api = read("frontend/src/features/dashboard/api/dashboard.api.ts");
  const hooks = read("frontend/src/features/dashboard/hooks/use-dashboard.ts");
  const filterForm = read("frontend/src/features/dashboard/forms/dashboard-filter.form.tsx");
  const preferencesForm = read("frontend/src/features/dashboard/forms/dashboard-preferences.form.tsx");
  const savedFilters = read("frontend/src/features/dashboard/components/saved-dashboard-filters.tsx");
  const page = read("frontend/src/features/dashboard/pages/dashboard.page.tsx");
  const routes = read("frontend/src/app/routes/dashboard.routes.tsx");
  const router = read("frontend/src/app/router/router.tsx");
  const tests = read("frontend/tests/module1-dashboard.test.tsx");
  const packageJson = JSON.parse(read("frontend/package.json"));
  const ci = read("frontend/.github/workflows/ci.yml");

  for (const expected of [
    'apiClient.get("/dashboard/summary"',
    'apiClient.get("/dashboard/orders"',
    'apiClient.get("/dashboard/sellers"',
    'apiClient.get("/dashboard/alerts"',
    'apiClient.patch("/dashboard/preferences"',
  ]) {
    requireText(api, expected, "Module 1 frontend API");
  }

  for (const expected of [
    "useDashboardSummaryQuery",
    "useDashboardOrdersQuery",
    "useDashboardSellersQuery",
    "useDashboardAlertsQuery",
    "useUpdateDashboardPreferencesMutation",
    "useQuery({",
    "useMutation({",
  ]) {
    requireText(hooks, expected, "Module 1 frontend hooks");
  }

  requireText(filterForm, "dashboardFilterFormSchema", "Module 1 Dashboard filter form");
  requireText(filterForm, 'user.accountType === "platform_admin"', "Module 1 seller filter guard");
  requireText(preferencesForm, "dashboardPreferencesFormSchema", "Module 1 preferences form");
  requireText(savedFilters, "PATCH /dashboard/preferences", "Module 1 saved-filter command boundary");

  for (const expected of [
    "DashboardKpiCards",
    "DashboardOrdersTrend",
    "DashboardSellerTable",
    "DashboardOperationalAlerts",
    "DashboardRefundReturnSummary",
    "DashboardCommissionPayoutSummary",
    "SavedDashboardFilters",
    "DashboardPreferencesForm",
    "DASHBOARD_PERMISSION.FINANCE_READ",
  ]) {
    requireText(page, expected, "Module 1 Dashboard page");
  }

  requireText(routes, 'path: "/dashboard"', "Module 1 frontend route");
  requireText(router, "dashboardRoute", "Module 1 frontend router registration");
  requireText(tests, "Module 1 Dashboard React feature", "Module 1 frontend tests");
  requireText(tests, "keeps seller identity server-derived", "Module 1 frontend seller-isolation proof");
  requireText(tests, "single documented preferences command", "Module 1 frontend preference proof");
  requireText(tests, "widget-unavailable state", "Module 1 frontend unavailable-widget proof");

  if (packageJson.scripts?.["test:module1"] !== "vitest run tests/module1-dashboard.test.tsx") {
    throw new Error("Frontend package.json must expose test:module1 for the Dashboard RTL/MSW suite.");
  }
  requireText(ci, "npm run test:module1", "Frontend Module 1 CI gate");
}


/** Confirms Pass 8 browser coverage, reconciliation, and the final release gate are wired. */
function verifyFinalReleasePass() {
  const e2eSpec = read("frontend/e2e/module1.spec.ts");
  const e2eRunner = read("frontend/e2e/run-e2e-ci.mjs");
  const frontendPackage = JSON.parse(read("frontend/package.json"));
  const releaseData = read("backend/scripts/verify-module1-release-data.mjs");
  const backendPackage = JSON.parse(read("backend/package.json"));
  const releaseRunner = read("scripts/run-current-release-gate.mjs");

  for (const proof of [
    "Module 1 Dashboard E2E",
    "finance concepts kept separately labeled",
    "stable Module 20 Sales source",
    "bounded Dashboard filters and drills down",
    "Seller A cannot request Seller B Dashboard data",
    "saves Dashboard preferences and one user-owned saved filter",
    "unsupported historical category filtering",
    "exactly the five documented Dashboard methods",
  ]) {
    requireText(e2eSpec, proof, "Module 1 Playwright suite");
  }

  for (const proof of [
    '"e2e/module1.spec.ts"',
    '"test:module1:release-data"',
    "Run Playwright Foundation through Module 1 in dependency order",
  ]) {
    requireText(e2eRunner, proof, "Module 1 provisioned release runner");
  }

  for (const route of [
    '"/api/v1/dashboard/summary"',
    '"/api/v1/dashboard/orders"',
    '"/api/v1/dashboard/sellers"',
    '"/api/v1/dashboard/alerts"',
    '"/api/v1/dashboard/preferences"',
  ]) {
    requireText(e2eRunner, route, "Module 1 live OpenAPI release check");
  }

  if (frontendPackage.scripts?.["test:e2e:module1"] !== "playwright test e2e/module1.spec.ts") {
    throw new Error("Frontend package.json must expose test:e2e:module1.");
  }
  if (
    backendPackage.scripts?.["test:module1:release-data"] !==
    "node scripts/verify-module1-release-data.mjs"
  ) {
    throw new Error("Backend package.json must expose test:module1:release-data.");
  }

  for (const proof of [
    "Module 1 E2E administrator preference snapshot",
    "Module 1 E2E administrator saved filter",
    "Module 1 denied cross-seller saved-filter write",
    "Module 1 Dashboard preference audit lifecycle",
    "Module 1 Dashboard preference outbox lifecycle",
    "Module 1 duplicate Dashboard preference ownership",
    "Module 1 orphaned saved-filter ownership",
    "Module 1 malformed persisted Dashboard preference JSON",
    "Module 1 malformed persisted saved-filter JSON",
  ]) {
    requireText(releaseData, proof, "Module 1 post-E2E reconciliation");
  }

  requireText(
    releaseRunner,
    "Current marketplace release gate passed through Module 1 Pass 8 E2E/regression verification.",
    "Final marketplace release runner",
  );
}

/** Runs the current source-only Module 1 gate. */
function main() {
  verifyDatabasePass();
  verifyContractPass();
  verifyRepositoryPass();
  verifyServicePass();
  verifyHttpPass();
  verifyBackendTestsPass();
  verifyFrontendPass();
  verifyFinalReleasePass();
  console.log("Module 1 Dashboard Pass 8 E2E/regression static verification passed.");
}

main();

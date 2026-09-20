import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const implementedModules = [
  "administration",
  "documents-audit",
  "customers",
  "sellers",
  "catalog-taxonomy",
  "products",
  "inventory",
  "search-discovery",
  "cart-wishlist",
  "promotions",
  "shipping",
  "checkout",
  "orders",
  "payments",
  "commissions",
  "returns-refunds",
  "seller-wallet-payouts",
  "reviews",
  "notifications",
  "reports",
  "dashboard",
];

const requiredDependencies = [
  "express",
  "zod",
  "drizzle-orm",
  "pg",
  "argon2",
  "bullmq",
  "ioredis",
  "jose",
  "pino",
  "helmet",
  "cors",
  "express-rate-limit",
  "stripe",
  "socket.io",
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "pino-http",
  "swagger-ui-express",
  "cookie-parser",
];

/** Reads one UTF-8 project file and fails with a focused path when it is missing. */
function read(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required backend release file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
}

/** Confirms every implemented backend module keeps the required layered files. */
function verifyModuleStructure() {
  for (const moduleName of implementedModules) {
    const moduleRoot = path.join(projectRoot, "src", "modules", moduleName);
    const requiredFiles = [
      `${moduleName}.routes.ts`,
      `${moduleName}.controller.ts`,
      `${moduleName}.service.ts`,
      `${moduleName}.repository.ts`,
      `${moduleName}.schema.ts`,
      "index.ts",
    ];

    for (const fileName of requiredFiles) {
      if (!existsSync(path.join(moduleRoot, fileName))) {
        throw new Error(`Backend module ${moduleName} is missing ${fileName}.`);
      }
    }
  }
}

/** Confirms Foundation and provider folders keep the documented backend architecture without empty compatibility wrappers. */
function verifyFoundationStructure() {
  const requiredPaths = [
    "src/config",
    "src/database/schema",
    "src/common/middleware",
    "src/common/policies",
    "src/common/errors",
    "src/common/logger",
    "src/common/idempotency",
    "src/common/outbox",
    "src/common/storage",
    "src/common/jobs",
    "src/common/realtime",
    "src/integrations/email",
    "src/integrations/payments",
    "src/app.ts",
    "src/server.ts",
  ];

  for (const relativePath of requiredPaths) {
    if (!existsSync(path.join(projectRoot, relativePath))) {
      throw new Error(`Required backend architecture path is missing: ${relativePath}`);
    }
  }

  for (const stalePath of [
    "src/integrations/notifications",
    "src/common/realtime/index.ts",
    "src/integrations/email/index.ts",
  ]) {
    if (existsSync(path.join(projectRoot, stalePath))) {
      throw new Error(`Unnecessary or misleading backend architecture path must stay removed: ${stalePath}`);
    }
  }
}

/** Confirms the backend keeps the required technology stack and independent npm policy. */
function verifyPackageContract() {
  const packageJson = JSON.parse(read("package.json"));
  const allDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  for (const dependency of requiredDependencies) {
    if (!allDependencies[dependency]) {
      throw new Error(`Required backend dependency is missing: ${dependency}`);
    }
  }

  if (packageJson.packageManager !== "npm@10.9.2") {
    throw new Error("Backend packageManager must remain npm@10.9.2.");
  }

  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (String(command).includes("../scripts")) {
      throw new Error(`Backend script ${name} depends on a parent/root scripts folder.`);
    }
  }

  const npmrc = read(".npmrc");
  if (!npmrc.includes("package-lock=true") || !npmrc.includes("engine-strict=true")) {
    throw new Error("Backend .npmrc must keep package-lock and engine enforcement enabled.");
  }
}

/** Confirms the append-only migration chain remains complete through the current module head. */
function verifyMigrationChain() {
  const migrations = readdirSync(path.join(projectRoot, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();

  if (migrations.length !== 37) {
    throw new Error(`Expected 37 backend migrations, found ${migrations.length}.`);
  }
  if (migrations.at(-1) !== "0036_product_moderation_workflow.sql") {
    throw new Error(`Unexpected migration head: ${migrations.at(-1) ?? "none"}.`);
  }

  migrations.forEach((name, index) => {
    const expectedPrefix = String(index).padStart(4, "0");
    if (!name.startsWith(`${expectedPrefix}_`)) {
      throw new Error(`Migration sequence gap at ${name}; expected prefix ${expectedPrefix}.`);
    }
  });
}


/** Confirms the Module 1 Dashboard database-only pass stays minimal and migration-verifiable. */
function verifyModule1DatabasePass() {
  const schema = read("src/database/schema/dashboard.ts");
  const schemaIndex = read("src/database/schema/index.ts");
  const relations = read("src/database/relations.ts");
  const migration = read("drizzle/0034_dashboard.sql");
  const migrationVerifier = read("scripts/verify-module1-migrations.mjs");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const tableName of ["dashboard_preferences", "dashboard_saved_filters"]) {
    if (!schema.includes(`"${tableName}"`) || !migration.includes(`"${tableName}"`)) {
      throw new Error(`Module 1 database pass is missing table ${tableName}.`);
    }
  }

  for (const proof of [
    'export * from "./dashboard.js";',
  ]) {
    if (!schemaIndex.includes(proof)) {
      throw new Error(`Module 1 central schema export is missing ${proof}.`);
    }
  }

  for (const proof of [
    "dashboardPreference: one(dashboardPreferences)",
    "dashboardSavedFilters: many(dashboardSavedFilters)",
    "dashboardDefaultPreferences: many(dashboardPreferences)",
    "export const dashboardPreferencesRelations",
    "export const dashboardSavedFiltersRelations",
  ]) {
    if (!relations.includes(proof)) {
      throw new Error(`Module 1 relation metadata is missing ${proof}.`);
    }
  }

  for (const forbiddenTable of [
    "dashboard_kpis",
    "dashboard_metrics",
    "dashboard_order_totals",
    "dashboard_finance_totals",
  ]) {
    if (schema.includes(`"${forbiddenTable}"`) || migration.includes(`"${forbiddenTable}"`)) {
      throw new Error(`Module 1 must not create duplicate source-of-truth table ${forbiddenTable}.`);
    }
  }

  if (!migrationVerifier.includes('const module1Migration = "0034_dashboard.sql"')) {
    throw new Error("Module 1 migration verifier is not pinned to migration 0034.");
  }
  if (packageJson.scripts?.["test:module1:migrations"] !== "node scripts/verify-module1-migrations.mjs") {
    throw new Error("Module 1 migration verification command is missing or changed.");
  }
  if (!ci.includes("npm run test:module1:migrations")) {
    throw new Error("Backend CI must execute the Module 1 clean/upgrade migration verifier.");
  }
}


/** Confirms the Module 1 Dashboard contracts, permissions, validation, and RBAC composition are complete. */
function verifyModule1ContractPass() {
  const constants = read("src/modules/dashboard/dashboard.constants.ts");
  const schema = read("src/modules/dashboard/dashboard.schema.ts");
  const index = read("src/modules/dashboard/index.ts");
  const rbacSeed = read("src/database/seeds/platform-rbac.seed.ts");
  const tests = read("tests/module1/module1.schemas.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const permission of [
    "dashboard.read",
    "dashboard.finance.read",
    "dashboard.seller.read",
    "dashboard.manage_preferences",
  ]) {
    if (!constants.includes(permission)) {
      throw new Error(`Module 1 permission contract is missing ${permission}.`);
    }
  }

  for (const errorCode of [
    "DASHBOARD_SCOPE_FORBIDDEN",
    "DASHBOARD_WIDGET_UNAVAILABLE",
    "INVALID_DASHBOARD_FILTER",
  ]) {
    if (!constants.includes(errorCode)) {
      throw new Error(`Module 1 error contract is missing ${errorCode}.`);
    }
  }

  for (const route of [
    "/api/v1/dashboard/summary",
    "/api/v1/dashboard/orders",
    "/api/v1/dashboard/sellers",
    "/api/v1/dashboard/alerts",
    "/api/v1/dashboard/preferences",
  ]) {
    if (!constants.includes(route)) {
      throw new Error(`Module 1 route contract is missing ${route}.`);
    }
  }

  for (const widget of [
    "executive_kpis",
    "orders_trend",
    "seller_performance",
    "operational_alerts",
    "refund_return_summary",
    "commission_payout_summary",
  ]) {
    if (!constants.includes(widget)) {
      throw new Error(`Module 1 widget allow-list is missing ${widget}.`);
    }
  }

  for (const proof of [
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
    "sellerId: uuidSchema.optional()",
    "storeId: uuidSchema.optional()",
    "categoryId: uuidSchema.optional()",
    "MAX_DATE_RANGE_DAYS",
    "dashboardWidgetCodeSchema",
  ]) {
    if (!schema.includes(proof)) {
      throw new Error(`Module 1 schema contract is missing ${proof}.`);
    }
  }

  if (!index.includes('export * from "./dashboard.constants.js";') ||
      !index.includes('export * from "./dashboard.schema.js";')) {
    throw new Error("Module 1 index must expose the Dashboard contract boundary only at this stage.");
  }

  if (!rbacSeed.includes("DASHBOARD_PERMISSION_CATALOG")) {
    throw new Error("Platform RBAC seed must compose the Module 1 Dashboard permission catalog.");
  }
  for (const permissionProof of [
    "DASHBOARD_PERMISSION.READ",
    "DASHBOARD_PERMISSION.SELLER_READ",
    "DASHBOARD_PERMISSION.MANAGE_PREFERENCES",
  ]) {
    if (!rbacSeed.includes(permissionProof)) {
      throw new Error(`Seller system roles must receive ${permissionProof}.`);
    }
  }

  const sellerOwnerSection = rbacSeed.slice(
    rbacSeed.indexOf("const SELLER_OWNER_PLATFORM_PERMISSION_CODES"),
    rbacSeed.indexOf("const SELLER_MANAGER_PLATFORM_PERMISSION_CODES"),
  );
  if (sellerOwnerSection.includes("DASHBOARD_PERMISSION.FINANCE_READ")) {
    throw new Error("Seller owners must not receive platform finance Dashboard permission by default.");
  }

  if (!tests.includes("Module 1 Dashboard contracts") ||
      !tests.includes("rejects unknown Dashboard widget codes") ||
      !tests.includes("requires at least one field in the Dashboard preferences patch")) {
    throw new Error("Module 1 contract tests are incomplete.");
  }

  if (packageJson.scripts?.["test:module1:contracts"] !==
      "vitest run tests/module1/module1.schemas.test.ts") {
    throw new Error("Module 1 contract test command is missing or changed.");
  }
  if (!ci.includes("npm run test:module1:contracts")) {
    throw new Error("Backend CI must execute the Module 1 Dashboard contract tests.");
  }


}

/** Confirms the Module 1 repository stays scope-aware data access without HTTP or business-policy ownership. */
function verifyModule1RepositoryPass() {
  const repository = read("src/modules/dashboard/dashboard.repository.ts");
  const index = read("src/modules/dashboard/index.ts");
  const tests = read("tests/module1/module1.repository.test.ts");
  const packageJson = JSON.parse(read("package.json"));

  for (const proof of [
    "export interface DashboardReadScope",
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
  ]) {
    if (!repository.includes(proof)) {
      throw new Error(`Module 1 repository is missing ${proof}.`);
    }
  }

  if (repository.includes("DASHBOARD_PERMISSION") || repository.includes("RequestContext")) {
    throw new Error("Module 1 repository must not make Dashboard authorization decisions.");
  }
  if (repository.includes("ReportsService") || repository.includes("ReportsRepository")) {
    throw new Error("Module 1 repository must not duplicate Module 20 report business definitions.");
  }
  if (!index.includes('export * from "./dashboard.repository.js";')) {
    throw new Error("Module 1 index must export the Dashboard repository boundary.");
  }
  if (!tests.includes("Module 1 Dashboard repository boundaries")) {
    throw new Error("Module 1 repository proof is missing.");
  }
  if (packageJson.scripts?.["test:module1:repository"] !==
      "vitest run tests/module1/module1.schemas.test.ts tests/module1/module1.repository.test.ts") {
    throw new Error("Module 1 repository test command is missing or changed.");
  }
}

/** Confirms the Module 1 service owns Dashboard authorization, source orchestration and preference side effects. */
function verifyModule1ServicePass() {
  const service = read("src/modules/dashboard/dashboard.service.ts");
  const index = read("src/modules/dashboard/index.ts");
  const tests = read("tests/module1/module1.service.test.ts");
  const packageJson = JSON.parse(read("package.json"));

  for (const proof of [
    "export class DashboardService",
    "getSummary",
    "getOrders",
    "getSellers",
    "getAlerts",
    "updatePreferences",
    "resolveReadScope",
    "assertSellerReadPermission",
    "DASHBOARD_PERMISSION.FINANCE_READ",
    "DASHBOARD_PERMISSION.SELLER_READ",
    "DASHBOARD_OUTBOX_EVENT.PREFERENCES_UPDATED",
    "AuditService.using",
    "OutboxService.using",
    "withTransaction",
  ]) {
    if (!service.includes(proof)) {
      throw new Error(`Module 1 service is missing ${proof}.`);
    }
  }

  if (service.includes("../../database/db") || service.includes(".select(") || service.includes(".insert(")) {
    throw new Error("Module 1 service must not bypass repository/service boundaries with direct SQL access.");
  }
  if (!service.includes('from "../reports/reports.service.js"')) {
    throw new Error("Module 1 service must reuse Module 20 Reports rather than reimplementing KPI definitions.");
  }
  if (!index.includes('export * from "./dashboard.service.js";')) {
    throw new Error("Module 1 index must export the Dashboard service boundary.");
  }
  if (!tests.includes("Module 1 Dashboard service")) {
    throw new Error("Module 1 service proof is missing.");
  }
  if (packageJson.scripts?.["test:module1:service"] !==
      "vitest run tests/module1/module1.service.test.ts") {
    throw new Error("Module 1 service test command is missing or changed.");
  }
}

/** Confirms the Module 1 HTTP layer exposes exactly five authenticated/RBAC-protected routes with OpenAPI registration. */
function verifyModule1HttpPass() {
  const controller = read("src/modules/dashboard/dashboard.controller.ts");
  const routes = read("src/modules/dashboard/dashboard.routes.ts");
  const index = read("src/modules/dashboard/index.ts");
  const app = read("src/app.ts");
  const openApi = read("src/http/openapi/openapi.document.ts");

  for (const proof of [
    "export class DashboardController",
    "getSummary",
    "getOrders",
    "getSellers",
    "getAlerts",
    "updatePreferences",
    "parseDashboardQuery",
    "DASHBOARD_ERROR_CODE.FILTER_INVALID",
  ]) {
    if (!controller.includes(proof)) {
      throw new Error(`Module 1 controller is missing ${proof}.`);
    }
  }

  for (const proof of [
    "export function createDashboardRouter",
    '"/summary"',
    '"/orders"',
    '"/sellers"',
    '"/alerts"',
    '"/preferences"',
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
    if (!routes.includes(proof)) {
      throw new Error(`Module 1 routes/OpenAPI are missing ${proof}.`);
    }
  }

  if (routes.includes("router.post(") || routes.includes("router.put(") || routes.includes("router.delete(")) {
    throw new Error("Module 1 must not invent undocumented Dashboard CRUD operations.");
  }
  if (!index.includes('export * from "./dashboard.controller.js";') ||
      !index.includes('export * from "./dashboard.routes.js";')) {
    throw new Error("Module 1 index must export the Dashboard HTTP boundary.");
  }
  for (const proof of [
    "DashboardService",
    "DashboardController",
    "createDashboardRouter",
    'app.use(`${API_V1_PREFIX}/dashboard`, dashboardRouter);',
  ]) {
    if (!app.includes(proof)) {
      throw new Error(`Module 1 Express composition is missing ${proof}.`);
    }
  }
  if (!openApi.includes("dashboardOpenApiPaths") || !openApi.includes('name: "Dashboard"')) {
    throw new Error("Module 1 OpenAPI paths/tag are not centrally registered.");
  }
  if (existsSync(path.join(projectRoot, "src/modules/dashboard/dashboard.types.ts"))) {
    throw new Error("Module 1 must not create an unnecessary dashboard.types.ts file.");
  }
}

/** Confirms the current Module 20 database layer remains wired through the Pass 6 backend-test stage. */
function verifyModule20DatabasePass() {
  const schema = read("src/database/schema/reports.ts");
  const schemaIndex = read("src/database/schema/index.ts");
  const relations = read("src/database/relations.ts");
  const migration = read("drizzle/0033_reports_analytics.sql");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const tableName of [
    "report_definitions",
    "report_runs",
    "saved_report_filters",
  ]) {
    if (!schema.includes(`"${tableName}"`) || !migration.includes(`"${tableName}"`)) {
      throw new Error(`Module 20 database pass is missing table ${tableName}.`);
    }
  }

  for (const proof of [
    'export * from "./reports.js";',
  ]) {
    if (!schemaIndex.includes(proof)) {
      throw new Error(`Module 20 central schema export is missing ${proof}.`);
    }
  }

  for (const proof of [
    "reportDefinitionsRelations",
    "reportRunsRelations",
    "savedReportFiltersRelations",
  ]) {
    if (!relations.includes(proof)) {
      throw new Error(`Module 20 relation metadata is missing ${proof}.`);
    }
  }

  if (
    packageJson.scripts?.["test:module20:migrations"] !==
    "node scripts/verify-module20-migrations.mjs"
  ) {
    throw new Error("Module 20 migration verification command is missing or changed.");
  }
  read("scripts/verify-module20-migrations.mjs");
  if (!ci.includes("npm run test:module20:migrations")) {
    throw new Error("Backend CI must execute the Module 20 clean/upgrade migration verifier.");
  }

}

/** Confirms the Module 20 Pass 6 cumulative contract/service/HTTP layer and backend regression wiring. */
function verifyModule20ContractPass() {
  const constants = read("src/modules/reports/reports.constants.ts");
  const schema = read("src/modules/reports/reports.schema.ts");
  const index = read("src/modules/reports/index.ts");
  const reportSeed = read("src/database/seeds/reports.seed.ts");
  const rbacSeed = read("src/database/seeds/platform-rbac.seed.ts");
  const tests = read("tests/module20/module20.schemas.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");
  const repository = read("src/modules/reports/reports.repository.ts");
  const service = read("src/modules/reports/reports.service.ts");
  const jobs = read("src/modules/reports/reports.jobs.ts");
  const exportRenderer = read("src/modules/reports/reports.export.ts");
  const storageContract = read("src/common/storage/storage.contract.ts");
  const documentsService = read("src/modules/documents-audit/documents-audit.service.ts");
  const notificationPolicy = read("src/modules/notifications/notifications.policy.ts");
  const app = read("src/app.ts");
  const server = read("src/server.ts");

  for (const proof of [
    "reports.sales.read",
    "reports.inventory.read",
    "reports.finance.read",
    "reports.seller.read",
    "reports.export",
    "REPORT_NOT_FOUND",
    "REPORT_SCOPE_FORBIDDEN",
    "REPORT_FILTER_INVALID",
    "REPORT_EXPORT_FAILED",
    "audit_log",
    "report.run_requested",
    "/api/v1/reports/catalog",
    "/api/v1/reports/runs/:id",
  ]) {
    if (!constants.includes(proof)) {
      throw new Error(`Module 20 constants are missing ${proof}.`);
    }
  }

  for (const proof of [
    "salesReportQuerySchema",
    "sellersReportQuerySchema",
    "inventoryReportQuerySchema",
    "refundsReportQuerySchema",
    "commissionsReportQuerySchema",
    "payoutsReportQuerySchema",
    "auditLogReportFilterSchema",
    "createReportRunBodySchema",
    "reportRunResponseSchema",
    "nonNegativeDecimalStringSchema",
  ]) {
    if (!schema.includes(proof)) {
      throw new Error(`Module 20 Zod contracts are missing ${proof}.`);
    }
  }

  for (const proof of [
    "reports.constants.js",
    "reports.schema.js",
    "reports.repository.js",
    "reports.export.js",
    "reports.service.js",
    "reports.jobs.js",
  ]) {
    if (!index.includes(proof)) {
      throw new Error(`Module 20 service-stage index is missing ${proof}.`);
    }
  }
  if (!reportSeed.includes("REPORT_DEFINITION_CATALOG") || !reportSeed.includes("onConflictDoUpdate")) {
    throw new Error("Module 20 report-definition seed is missing or not idempotent.");
  }
  if (!rbacSeed.includes("REPORTS_PERMISSION_CATALOG") || !rbacSeed.includes("REPORTS_PERMISSION.EXPORT")) {
    throw new Error("Platform RBAC composition is missing Module 20 permissions.");
  }
  if (!tests.includes("Module 20 fixed contract values")) {
    throw new Error("Module 20 focused contract tests are missing.");
  }
  for (const expected of [
    "listSalesRows",
    "listSellerSalesAggregates",
    "listInventoryRows",
    "listRefundRows",
    "listCommissionRows",
    "listPayoutRows",
    "listAuditExportRows",
    "createReportRun",
    "markReportRunCompleted",
  ]) {
    if (!repository.includes(expected)) throw new Error(`Module 20 repository is missing ${expected}.`);
  }
  for (const expected of [
    "getCatalog",
    "getSalesReport",
    "getSellersReport",
    "getInventoryReport",
    "getRefundsReport",
    "getCommissionsReport",
    "getPayoutsReport",
    "createReportRun",
    "getReportRun",
    "processReportRun",
    "recordReportRunFailure",
  ]) {
    if (!service.includes(expected)) throw new Error(`Module 20 service is missing ${expected}.`);
  }
  if (!jobs.includes("startReportsRuntime") || !jobs.includes("REPORTS_JOB.SOURCE_EVENT_QUEUE")) {
    throw new Error("Module 20 asynchronous report runtime is missing.");
  }
  if (!exportRenderer.includes("renderReportExport")) throw new Error("Module 20 export renderer is missing.");
  if (!storageContract.includes("putObject")) throw new Error("ObjectStorage must support server-generated bytes.");
  if (!documentsService.includes("storeGeneratedDocument") || !documentsService.includes("getGeneratedDocumentDownload")) {
    throw new Error("Module 21 generated-document service boundary is missing.");
  }
  if (!notificationPolicy.includes("REPORTS_OUTBOX_EVENT.GENERATED") || !notificationPolicy.includes("REPORTS_OUTBOX_EVENT.FAILED")) {
    throw new Error("Module 18 notification policy must map report ready/failed lifecycle events.");
  }
  if (!app.includes("const reportsService = new ReportsService") || !server.includes("startReportsRuntime(reportsService)")) {
    throw new Error("Module 20 service/runtime composition is missing.");
  }

  if (packageJson.scripts?.["test:module20:contracts"] !== "vitest run tests/module20/module20.schemas.test.ts") {
    throw new Error("Module 20 contract test package command is missing or changed.");
  }
  if (packageJson.scripts?.["db:seed:module20"] !== "tsx src/database/seeds/reports.seed.ts") {
    throw new Error("Module 20 report-definition seed command is missing or changed.");
  }
  if (!ci.includes("npm run test:module20:contracts")) {
    throw new Error("Backend CI must execute the Module 20 contract tests.");
  }

  if (existsSync(path.join(projectRoot, "src/modules/reports/reports.types.ts"))) {
    throw new Error("Module 20 must not add an unnecessary reports.types.ts barrel.");
  }

  for (const relativePath of [
    "tests/module20/module20.repository.test.ts",
    "tests/module20/module20.service.test.ts",
    "tests/module20/module20.export.test.ts",
    "tests/module20/module20.jobs.test.ts",
    "tests/module20/module20.http.test.ts",
    "tests/module20/module20.integration.test.ts",
    "tests/module20/module20.test-helpers.ts",
    "scripts/run-module20-tests.mjs",
  ]) {
    read(relativePath);
  }
  if (packageJson.scripts?.["test:module20:specs"] !== "vitest run tests/module20") {
    throw new Error("Module 20 complete backend spec command is missing or changed.");
  }
  if (packageJson.scripts?.["test:module20"] !== "node scripts/run-module20-tests.mjs") {
    throw new Error("Module 20 complete Docker-backed verifier command is missing or changed.");
  }
  if (!ci.includes("npm run test:module20:specs")) {
    throw new Error("Backend CI must execute the complete Module 20 backend specs.");
  }
}


/** Confirms the current Module 18 database pass remains wired without pretending later module layers exist. */
function verifyModule18DatabasePass() {
  const schema = read("src/database/schema/notifications.ts");
  const migration = read("drizzle/0032_notifications.sql");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const tableName of [
    "notification_templates",
    "notifications",
    "notification_deliveries",
    "notification_preferences",
  ]) {
    if (!schema.includes(`"${tableName}"`) || !migration.includes(`"${tableName}"`)) {
      throw new Error(`Module 18 database pass is missing table ${tableName}.`);
    }
  }

  if (
    packageJson.scripts?.["test:module18:migrations"] !==
    "node scripts/verify-module18-migrations.mjs"
  ) {
    throw new Error("Module 18 migration verification command is missing or changed.");
  }
  read("scripts/verify-module18-migrations.mjs");
  if (!ci.includes("npm run test:module18:migrations")) {
    throw new Error("Backend CI must execute the Module 18 clean/upgrade migration verifier.");
  }
}



/** Confirms Module 1 Pass 6 adds complete backend HTTP/integration proof and a provisioned runner. */
function verifyModule1BackendTestsPass() {
  const http = read("tests/module1/module1.http.test.ts");
  const integration = read("tests/module1/module1.integration.test.ts");
  const helpers = read("tests/module1/module1.test-helpers.ts");
  const runner = read("scripts/run-module1-tests.mjs");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const proof of [
    "Module 1 Dashboard HTTP/RBAC integration",
    "requires authentication and Dashboard permission before private reads",
    "rejects Seller B reads and preference writes against Seller A scope",
    "returns the stable Dashboard error codes for malformed and unsupported filters",
    "persists only the current user's preferences and commits audit/outbox in the same successful command",
    "rejects a mixed-scope preference payload before any Dashboard write is committed",
    "keeps OpenAPI parity with exactly the documented Dashboard paths and methods",
  ]) {
    if (!http.includes(proof)) throw new Error(`Module 1 HTTP tests are missing ${proof}.`);
  }

  for (const proof of [
    "Module 1 Dashboard cross-module integration",
    "matches Dashboard seller GMV/order KPIs to the stable Module 20 Sales source",
    "keeps one parent Order count while its seller-order GMV is aggregated exactly once in the Dashboard trend",
    "returns finance fields only to the platform actor while preserving separate money concepts",
  ]) {
    if (!integration.includes(proof)) throw new Error(`Module 1 integration tests are missing ${proof}.`);
  }

  for (const proof of [
    "resetModule1HttpTables",
    "countDashboardAuditActions",
    "countDashboardOutboxEvents",
  ]) {
    if (!helpers.includes(proof)) throw new Error(`Module 1 test helpers are missing ${proof}.`);
  }

  const expectedScripts = {
    "test:module1:http": "vitest run tests/module1/module1.http.test.ts",
    "test:module1:integration": "vitest run tests/module1/module1.integration.test.ts",
    "test:module1:specs": "vitest run tests/module1",
    "test:module1": "node scripts/run-module1-tests.mjs",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      throw new Error(`Module 1 backend test command ${name} is missing or changed.`);
    }
  }

  for (const proof of [
    '"test:module1:specs"',
    '"test:regression:contracts"',
    '"typecheck"',
    '"lint"',
    '"build"',
  ]) {
    if (!runner.includes(proof)) throw new Error(`Module 1 backend runner is missing ${proof}.`);
  }
  if (!ci.includes("npm run test:module1:specs")) {
    throw new Error("Backend CI must execute the complete Module 1 backend test suite.");
  }
}


/** Confirms the backend owns the final Module 1 post-browser reconciliation command. */
function verifyModule1ReleaseDataPass() {
  const releaseData = read("scripts/verify-module1-release-data.mjs");
  const packageJson = JSON.parse(read("package.json"));

  for (const proof of [
    "Module 1 E2E administrator preference snapshot",
    "Module 1 E2E administrator saved filter",
    "Module 1 denied cross-seller saved-filter write",
    "Module 1 Dashboard preference audit lifecycle",
    "Module 1 Dashboard preference outbox lifecycle",
    "Module 1 duplicate Dashboard preference ownership",
  ]) {
    if (!releaseData.includes(proof)) {
      throw new Error(`Module 1 release-data verifier is missing ${proof}.`);
    }
  }

  if (
    packageJson.scripts?.["test:module1:release-data"] !==
    "node scripts/verify-module1-release-data.mjs"
  ) {
    throw new Error("Module 1 release-data package command is missing or changed.");
  }
}

/** Confirms the Module 18 contract pass is present and wired. */
function verifyModule18ContractPass() {
  const constants = read("src/modules/notifications/notifications.constants.ts");
  const schema = read("src/modules/notifications/notifications.schema.ts");
  const index = read("src/modules/notifications/index.ts");
  const rbacSeed = read("src/database/seeds/platform-rbac.seed.ts");
  const tests = read("tests/module18/module18.schemas.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const proof of [
    "notifications.read_own",
    "notifications.preferences.manage_own",
    "admin.notifications.read",
    "admin.notifications.retry",
    "NOTIFICATION_NOT_FOUND",
    "NOTIFICATION_TEMPLATE_MISSING",
    "NOTIFICATION_DELIVERY_FAILED",
    "NOTIFICATION_SCOPE_FORBIDDEN",
  ]) {
    if (!constants.includes(proof)) throw new Error(`Module 18 constants are missing ${proof}.`);
  }

  for (const proof of [
    "notificationsListQuerySchema",
    "updateNotificationPreferencesBodySchema",
    "adminNotificationDeliveryResponseSchema",
    "notificationsListMetaSchema",
  ]) {
    if (!schema.includes(proof)) throw new Error(`Module 18 schema is missing ${proof}.`);
  }

  if (!index.includes("notifications.constants.js") || !index.includes("notifications.schema.js")) {
    throw new Error("Module 18 index must export the current constants and schema contracts.");
  }
  if (!rbacSeed.includes("NOTIFICATIONS_PERMISSION_CATALOG")) {
    throw new Error("Platform RBAC seed must compose the Module 18 permission catalog.");
  }
  if (!tests.includes("Module 18 fixed contract values")) {
    throw new Error("Module 18 focused contract tests are missing.");
  }
  if (
    packageJson.scripts?.["test:module18:contracts"] !==
    "vitest run tests/module18/module18.schemas.test.ts"
  ) {
    throw new Error("Module 18 contract test package command is missing or changed.");
  }
  if (!ci.includes("npm run test:module18:contracts")) {
    throw new Error("Backend CI must execute the Module 18 contract tests.");
  }
}


/** Confirms the Module 18 repository pass is present and independently wired. */
function verifyModule18RepositoryPass() {
  const repository = read("src/modules/notifications/notifications.repository.ts");
  const index = read("src/modules/notifications/index.ts");
  const tests = read("tests/module18/module18.repository.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const proof of [
    "listOwnedNotifications",
    "markOwnedNotificationRead",
    "markAllOwnedNotificationsRead",
    "replaceUserPreferences",
    "ensureTemplate",
    "findActiveTemplate",
    "createDeliveryIfMissing",
    "attachNotificationToDelivery",
    "findDeliveryByIdForUpdate",
    "updateDeliveryState",
    "listFailedDeliveries",
  ]) {
    if (!repository.includes(proof)) throw new Error(`Module 18 repository is missing ${proof}.`);
  }

  if (!index.includes("notifications.repository.js")) {
    throw new Error("Module 18 index must export the repository pass.");
  }
  if (!tests.includes("Module 18 Notifications repository boundaries")) {
    throw new Error("Module 18 focused repository tests are missing.");
  }
  if (
    packageJson.scripts?.["test:module18:repository"] !==
    "vitest run tests/module18/module18.schemas.test.ts tests/module18/module18.repository.test.ts"
  ) {
    throw new Error("Module 18 repository test package command is missing or changed.");
  }
  if (!ci.includes("npm run test:module18:repository")) {
    throw new Error("Backend CI must execute the Module 18 repository tests.");
  }
}

/** Confirms the Module 18 service pass is present and independently wired inside the backend repository. */
function verifyModule18ServicePass() {
  const service = read("src/modules/notifications/notifications.service.ts");
  const administration = read("src/modules/administration/administration.service.ts");
  const index = read("src/modules/notifications/index.ts");
  const tests = read("tests/module18/module18.service.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const proof of [
    "class NotificationsService",
    "dispatchCommittedEvent",
    "prepareDispatchTarget",
    "markNotificationRead",
    "updatePreferences",
    "retryFailedDelivery",
    "NOTIFICATIONS_OUTBOX_EVENT.QUEUED",
    "NOTIFICATIONS_AUDIT_ACTION.DELIVERY_RETRY_REQUESTED",
  ]) {
    if (!service.includes(proof)) throw new Error(`Module 18 service is missing ${proof}.`);
  }
  if (!administration.includes("resolveNotificationRecipient")) {
    throw new Error("Module 2 service must expose the narrow Notification recipient identity boundary.");
  }
  if (!index.includes("notifications.service.js")) {
    throw new Error("Module 18 index must export the service pass.");
  }
  if (!tests.includes("Module 18 Notifications service invariants")) {
    throw new Error("Module 18 focused service tests are missing.");
  }
  if (
    packageJson.scripts?.["test:module18:service"] !==
    "vitest run tests/module18/module18.schemas.test.ts tests/module18/module18.repository.test.ts tests/module18/module18.service.test.ts"
  ) {
    throw new Error("Module 18 service test package command is missing or changed.");
  }
  if (!ci.includes("npm run test:module18:service")) {
    throw new Error("Backend CI must execute the Module 18 service tests.");
  }
}


/** Confirms the Module 18 HTTP pass exposes only the seven documented authenticated operations. */
function verifyModule18HttpPass() {
  const controller = read("src/modules/notifications/notifications.controller.ts");
  const routes = read("src/modules/notifications/notifications.routes.ts");
  const index = read("src/modules/notifications/index.ts");
  const app = read("src/app.ts");
  const openApi = read("src/http/openapi/openapi.document.ts");

  for (const handler of [
    "listNotifications",
    "markNotificationRead",
    "markAllNotificationsRead",
    "getPreferences",
    "updatePreferences",
    "listFailedDeliveries",
    "retryFailedDelivery",
  ]) {
    if (!controller.includes(handler)) throw new Error(`Module 18 controller is missing ${handler}.`);
  }

  for (const proof of [
    "createNotificationsRouter",
    "createAdminNotificationDeliveriesRouter",
    "requirePermission(NOTIFICATIONS_PERMISSION.READ_OWN)",
    "requirePermission(NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN)",
    "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_READ)",
    "requirePermission(NOTIFICATIONS_PERMISSION.ADMIN_RETRY)",
    '"/api/v1/notifications"',
    '"/api/v1/notifications/{id}/read"',
    '"/api/v1/notifications/read-all"',
    '"/api/v1/notifications/preferences"',
    '"/api/v1/admin/notification-deliveries"',
    '"/api/v1/admin/notification-deliveries/{id}/retry"',
  ]) {
    if (!routes.includes(proof)) throw new Error(`Module 18 routes/OpenAPI are missing ${proof}.`);
  }

  if (!index.includes("notifications.controller.js") || !index.includes("notifications.routes.js")) {
    throw new Error("Module 18 index must export the controller and routes HTTP pass.");
  }
  for (const proof of [
    "new NotificationsService({",
    "emailProvider: notificationEmailProvider",
    "new NotificationsController(notificationsService)",
    "createNotificationsRouter(notificationsController)",
    "createAdminNotificationDeliveriesRouter(",
    "`${API_V1_PREFIX}/notifications`",
    "`${API_V1_PREFIX}/admin/notification-deliveries`",
  ]) {
    if (!app.includes(proof)) throw new Error(`Application composition is missing Module 18 proof: ${proof}.`);
  }
  if (!openApi.includes("...notificationsOpenApiPaths") || !openApi.includes('name: "Notifications"')) {
    throw new Error("Central OpenAPI document must register the Module 18 route registry and tag.");
  }
}

/** Confirms the Module 18 background runtime/provider pass is wired inside this independent backend repository. */
function verifyModule18RuntimePass() {
  const constants = read("src/modules/notifications/notifications.constants.ts");
  const policy = read("src/modules/notifications/notifications.policy.ts");
  const jobs = read("src/modules/notifications/notifications.jobs.ts");
  const service = read("src/modules/notifications/notifications.service.ts");
  const provider = read("src/integrations/email/resend-email-provider.adapter.ts");
  const factory = read("src/integrations/email/notification-email-provider.factory.ts");
  const app = read("src/app.ts");
  const server = read("src/server.ts");
  const providerTests = read("tests/module18/module18.provider.test.ts");
  const jobsTests = read("tests/module18/module18.jobs.test.ts");
  const integrationTests = read("tests/module18/module18.integration.test.ts");
  const httpTests = read("tests/module18/module18.http.test.ts");
  const packageJson = JSON.parse(read("package.json"));
  const ci = read(".github/workflows/ci.yml");

  for (const proof of ["NOTIFICATIONS_JOB", "NOTIFICATIONS_PROVIDER_ERROR_CODE"]) {
    if (!constants.includes(proof)) throw new Error(`Module 18 runtime constants are missing ${proof}.`);
  }
  for (const proof of ["DefaultNotificationDispatchPolicy", "DEFAULT_NOTIFICATION_TEMPLATES"]) {
    if (!policy.includes(proof)) throw new Error(`Module 18 source policy is missing ${proof}.`);
  }
  for (const proof of ["startNotificationsRuntime", "processQueuedDelivery", "recordDeliveryFailure"]) {
    if (!jobs.includes(proof) && !service.includes(proof)) {
      throw new Error(`Module 18 runtime is missing ${proof}.`);
    }
  }
  if (!provider.includes('"Idempotency-Key": input.idempotencyKey')) {
    throw new Error("Module 18 Resend adapter must preserve provider idempotency by delivery id.");
  }
  if (!factory.includes("DeterministicNotificationEmailProvider")) {
    throw new Error("Module 18 provider factory must expose the network-free deterministic test adapter.");
  }
  if (!app.includes("createNotificationEmailProvider") || !server.includes("startNotificationsRuntime(notificationsService)")) {
    throw new Error("Module 18 provider/service/background runtime composition is incomplete.");
  }
  if (!server.includes("NOTIFICATIONS_JOB.SOURCE_EVENT_QUEUE")) {
    throw new Error("Foundation outbox fan-out must include the Module 18 independent source-event queue.");
  }
  if (!providerTests.includes("Module 18 email provider adapters") ||
      !jobsTests.includes("Module 18 Notification BullMQ runtime") ||
      !integrationTests.includes("Module 18 Notification runtime integration") ||
      !httpTests.includes("Module 18 Notification HTTP/RBAC integration")) {
    throw new Error("Module 18 runtime/provider/HTTP integration tests are incomplete.");
  }
  const expectedModule18RuntimeCommand = [
    "vitest run",
    "tests/module18/module18.provider.test.ts",
    "tests/module18/module18.jobs.test.ts",
    "tests/module18/module18.policy.test.ts",
    "tests/module18/module18.startup.test.ts",
  ].join(" ");
  if (packageJson.scripts?.["test:module18:runtime"] !== expectedModule18RuntimeCommand) {
    throw new Error("Module 18 runtime test command is missing or changed.");
  }
  if (packageJson.scripts?.["test:module18:specs"] !== "vitest run tests/module18") {
    throw new Error("Module 18 complete backend spec command is missing or changed.");
  }
  if (packageJson.scripts?.["test:module18"] !== "node scripts/run-module18-tests.mjs") {
    throw new Error("Module 18 complete Docker-backed verifier command is missing or changed.");
  }
  read("scripts/run-module18-tests.mjs");
  if (!ci.includes("npm run test:module18:runtime") || !ci.includes("npm run test:module18:specs")) {
    throw new Error("Backend CI must execute the Module 18 runtime and complete backend spec suites.");
  }
}

/** Confirms the backend owns the deterministic Module 18 browser fixture and post-E2E reconciliation commands. */
function verifyModule18ReleaseDataPass() {
  const seed = read("src/database/seeds/module18-e2e.seed.ts");
  const releaseData = read("scripts/verify-module18-release-data.mjs");
  const packageJson = JSON.parse(read("package.json"));

  for (const proof of [
    "seedModule18E2eFailedDelivery",
    "MODULE18_E2E_FAILED_DELIVERY_ID",
    'eventType: "seller.approved"',
    'status: "failed"',
    "destinationMasked: maskEmail(administrator.email)",
  ]) {
    if (!seed.includes(proof)) throw new Error(`Module 18 E2E seed is missing ${proof}.`);
  }

  for (const proof of [
    "Module 18 seller-approved in-app notification",
    "Module 18 seller-rejected in-app notification",
    "Module 18 privileged retry audit evidence",
    "Module 18 deterministic provider reconciliation",
    "Module 18 event/recipient/channel idempotency",
  ]) {
    if (!releaseData.includes(proof)) throw new Error(`Module 18 release-data verifier is missing ${proof}.`);
  }

  if (packageJson.scripts?.["db:seed:module18-e2e"] !== "tsx src/database/seeds/module18-e2e.seed.ts") {
    throw new Error("Module 18 E2E seed package command is missing or changed.");
  }
  if (packageJson.scripts?.["test:module18:release-data"] !== "node scripts/verify-module18-release-data.mjs") {
    throw new Error("Module 18 release-data package command is missing or changed.");
  }
}

/** Confirms backend source does not import or depend on the independent frontend project. */
function verifyRepositoryIndependence() {
  const forbiddenFragments = ["marketplace-frontend", "../marketplace-frontend"];
  const filesToCheck = [
    "src/app.ts",
    "src/server.ts",
    "src/http/openapi/openapi.document.ts",
    "tests/regression/implemented-api-contracts.test.ts",
  ];

  for (const relativePath of filesToCheck) {
    const source = read(relativePath);
    for (const fragment of forbiddenFragments) {
      if (source.includes(fragment)) {
        throw new Error(`${relativePath} must not depend on the frontend project.`);
      }
    }
  }
}

/** Confirms the backend keeps the central runtime, OpenAPI, and regression contract entry points. */
function verifyCoreReleaseFiles() {
  for (const relativePath of [
    "src/app.ts",
    "src/server.ts",
    "src/database/db.ts",
    "src/http/openapi/openapi.document.ts",
    "tests/regression/implemented-api-contracts.test.ts",
    "Dockerfile",
    ".github/workflows/ci.yml",
  ]) {
    read(relativePath);
  }
}

/** Runs the dependency-free backend release structure gate. */
function main() {
  verifyModuleStructure();
  verifyFoundationStructure();
  verifyPackageContract();
  verifyMigrationChain();
  verifyModule1DatabasePass();
  verifyModule1ContractPass();
  verifyModule1RepositoryPass();
  verifyModule1ServicePass();
  verifyModule1HttpPass();
  verifyModule1BackendTestsPass();
  verifyModule1ReleaseDataPass();
  verifyModule18DatabasePass();
  verifyModule20DatabasePass();
  verifyModule20ContractPass();
  verifyModule18ContractPass();
  verifyModule18RepositoryPass();
  verifyModule18ServicePass();
  verifyModule18HttpPass();
  verifyModule18RuntimePass();
  verifyModule18ReleaseDataPass();
  verifyRepositoryIndependence();
  verifyCoreReleaseFiles();
  console.log("Backend independent-repository static release gate passed.");
}

main();

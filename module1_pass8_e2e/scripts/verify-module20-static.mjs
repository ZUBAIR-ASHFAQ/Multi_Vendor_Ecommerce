import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads one required Module 20 frontend-stage file and reports its exact missing path. */
function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 20 frontend-stage file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Requires one source fragment that proves a fixed Module 20 contract. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Confirms the append-only Module 20 persistence layer from Pass 1 remains intact. */
function verifyDatabasePass() {
  const schema = read("marketplace-backend/src/database/schema/reports.ts");
  const schemaIndex = read("marketplace-backend/src/database/schema/index.ts");
  const relations = read("marketplace-backend/src/database/relations.ts");
  const migration = read("marketplace-backend/drizzle/0033_reports_analytics.sql");
  const packageJson = JSON.parse(read("marketplace-backend/package.json"));
  const ci = read("marketplace-backend/.github/workflows/ci.yml");
  const migrations = readdirSync(path.join(root, "marketplace-backend", "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();

  if (migrations.length < 34 || migrations[33] !== "0033_reports_analytics.sql") {
    throw new Error(
      `Module 20 requires its first 34 contiguous migrations to end at 0033_reports_analytics.sql; found ${migrations.length} migrations with ${migrations[33] ?? "none"} at position 0033.`,
    );
  }
  migrations.forEach((name, index) => {
    const expectedPrefix = String(index).padStart(4, "0");
    if (!name.startsWith(`${expectedPrefix}_`)) {
      throw new Error(`Migration sequence gap at ${name}; expected prefix ${expectedPrefix}.`);
    }
  });

  for (const tableName of ["report_definitions", "report_runs", "saved_report_filters"]) {
    requireText(schema, `"${tableName}"`, "Module 20 Drizzle schema");
    requireText(migration, `"${tableName}"`, "Module 20 migration");
  }
  requireText(schemaIndex, 'export * from "./reports.js";', "Central Drizzle schema index");
  for (const proof of [
    "reportDefinitionsRelations",
    "reportRunsRelations",
    "savedReportFiltersRelations",
  ]) {
    requireText(relations, proof, "Central Drizzle relations");
  }
  if (
    packageJson.scripts?.["test:module20:migrations"] !==
    "node scripts/verify-module20-migrations.mjs"
  ) {
    throw new Error("Backend package.json must expose test:module20:migrations.");
  }
  requireText(ci, "npm run test:module20:migrations", "Backend CI");
}

/** Confirms Pass 6 preserves contracts/HTTP behavior and adds the required backend regression proof. */
function verifyContractPass() {
  const constants = read("marketplace-backend/src/modules/reports/reports.constants.ts");
  const schema = read("marketplace-backend/src/modules/reports/reports.schema.ts");
  const index = read("marketplace-backend/src/modules/reports/index.ts");
  const rbacSeed = read("marketplace-backend/src/database/seeds/platform-rbac.seed.ts");
  const reportSeed = read("marketplace-backend/src/database/seeds/reports.seed.ts");
  const tests = read("marketplace-backend/tests/module20/module20.schemas.test.ts");
  const packageJson = JSON.parse(read("marketplace-backend/package.json"));
  const ci = read("marketplace-backend/.github/workflows/ci.yml");
  const e2eRunner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const releaseRunner = read("scripts/run-current-release-gate.mjs");
  const repository = read("marketplace-backend/src/modules/reports/reports.repository.ts");
  const service = read("marketplace-backend/src/modules/reports/reports.service.ts");
  const jobs = read("marketplace-backend/src/modules/reports/reports.jobs.ts");
  const exportRenderer = read("marketplace-backend/src/modules/reports/reports.export.ts");
  const storageContract = read("marketplace-backend/src/common/storage/storage.contract.ts");
  const documentsService = read("marketplace-backend/src/modules/documents-audit/documents-audit.service.ts");
  const notificationPolicy = read("marketplace-backend/src/modules/notifications/notifications.policy.ts");
  const app = read("marketplace-backend/src/app.ts");
  const server = read("marketplace-backend/src/server.ts");
  const controller = read("marketplace-backend/src/modules/reports/reports.controller.ts");
  const routes = read("marketplace-backend/src/modules/reports/reports.routes.ts");
  const openApi = read("marketplace-backend/src/http/openapi/openapi.document.ts");

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
    "report.run_requested",
    "report.generated",
    "report.failed",
    "/api/v1/reports/catalog",
    "/api/v1/reports/sales",
    "/api/v1/reports/sellers",
    "/api/v1/reports/inventory",
    "/api/v1/reports/refunds",
    "/api/v1/reports/commissions",
    "/api/v1/reports/payouts",
    "/api/v1/reports/runs",
    "/api/v1/reports/runs/:id",
    "audit_log",
    "DOCUMENT_AUDIT_PERMISSION.AUDIT_READ",
    "DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT",
    "MAX_DATE_RANGE_DAYS: 366",
  ]) {
    requireText(constants, proof, "Module 20 constants");
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
    "salesReportResponseSchema",
    "sellersReportResponseSchema",
    "inventoryReportResponseSchema",
    "refundsReportResponseSchema",
    "commissionsReportResponseSchema",
    "payoutsReportResponseSchema",
    "nonNegativeDecimalStringSchema",
    "GMV, captured cash, and refunds",
    "Aging is not exposed",
  ]) {
    requireText(schema, proof, "Module 20 Zod contracts");
  }

  requireText(index, 'export * from "./reports.constants.js";', "Module 20 contract index");
  requireText(index, 'export * from "./reports.schema.js";', "Module 20 contract index");
  for (const proof of [
    'export * from "./reports.repository.js";',
    'export * from "./reports.export.js";',
    'export * from "./reports.service.js";',
    'export * from "./reports.jobs.js";',
    'export * from "./reports.controller.js";',
    'export * from "./reports.routes.js";',
  ]) {
    requireText(index, proof, "Module 20 service-stage index");
  }
  requireText(reportSeed, "REPORT_DEFINITION_CATALOG", "Module 20 report-definition seed");
  requireText(reportSeed, "onConflictDoUpdate", "Module 20 report-definition seed");

  for (const proof of [
    "REPORTS_PERMISSION_CATALOG",
    "REPORTS_PERMISSION.SALES_READ",
    "REPORTS_PERMISSION.INVENTORY_READ",
    "REPORTS_PERMISSION.FINANCE_READ",
    "REPORTS_PERMISSION.SELLER_READ",
    "REPORTS_PERMISSION.EXPORT",
  ]) {
    requireText(rbacSeed, proof, "Platform RBAC composition");
  }

  for (const proof of [
    "Module 20 fixed contract values",
    "approved audit-log export definition",
    "Module 20 query and export boundaries",
    "exact-money and privacy-safe responses",
  ]) {
    requireText(tests, proof, "Module 20 contract tests");
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
    "markReportRunFailed",
  ]) {
    requireText(repository, expected, "Module 20 repository");
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
    "REPORTS_OUTBOX_EVENT.RUN_REQUESTED",
    "REPORTS_OUTBOX_EVENT.GENERATED",
    "REPORTS_OUTBOX_EVENT.FAILED",
    "WALLET_BALANCE_BUCKET.NEGATIVE",
  ]) {
    requireText(service, expected, "Module 20 service");
  }
  requireText(jobs, "startReportsRuntime", "Module 20 jobs");
  requireText(jobs, "REPORTS_JOB.SOURCE_EVENT_QUEUE", "Module 20 jobs");
  requireText(exportRenderer, "renderReportExport", "Module 20 export renderer");
  requireText(storageContract, "putObject", "Provider-neutral object storage contract");
  requireText(documentsService, "storeGeneratedDocument", "Module 21 generated-document boundary");
  requireText(documentsService, "getGeneratedDocumentDownload", "Module 21 generated-document boundary");
  requireText(notificationPolicy, "REPORTS_OUTBOX_EVENT.GENERATED", "Module 18 report notification policy");
  requireText(notificationPolicy, "REPORTS_OUTBOX_EVENT.FAILED", "Module 18 report notification policy");
  requireText(app, "const reportsService = new ReportsService", "Application composition");
  requireText(server, "startReportsRuntime(reportsService)", "Server runtime composition");
  requireText(server, "REPORTS_JOB.SOURCE_EVENT_QUEUE", "Outbox fan-out destinations");

  for (const proof of [
    "getCatalog",
    "getSalesReport",
    "getSellersReport",
    "getInventoryReport",
    "getRefundsReport",
    "getCommissionsReport",
    "getPayoutsReport",
    "createReportRun",
    "getReportRun",
    "successResponse",
    "salesReportQuerySchema.parse(request.query)",
    "createReportRunBodySchema.parse(request.body)",
    "reportRunIdParamsSchema.parse(request.params)",
  ]) {
    requireText(controller, proof, "Module 20 controller");
  }

  for (const proof of [
    "createReportsRouter",
    "router.use(authenticationMiddleware)",
    "requirePermission(REPORTS_PERMISSION.SALES_READ)",
    "requirePermission(REPORTS_PERMISSION.SELLER_READ)",
    "requirePermission(REPORTS_PERMISSION.INVENTORY_READ)",
    "requirePermission(REPORTS_PERMISSION.FINANCE_READ)",
    "requirePermission(REPORTS_PERMISSION.EXPORT)",
    'router.get("/catalog", controller.getCatalog)',
    '"/runs"',
    '"/runs/:id"',
    "reportsOpenApiPaths",
    '"/api/v1/reports/catalog"',
    '"/api/v1/reports/sales"',
    '"/api/v1/reports/sellers"',
    '"/api/v1/reports/inventory"',
    '"/api/v1/reports/refunds"',
    '"/api/v1/reports/commissions"',
    '"/api/v1/reports/payouts"',
    '"/api/v1/reports/runs"',
    '"/api/v1/reports/runs/{id}"',
  ]) {
    requireText(routes, proof, "Module 20 routes/OpenAPI");
  }

  requireText(app, "ReportsController", "Application Reports HTTP composition");
  requireText(app, "createReportsRouter", "Application Reports HTTP composition");
  requireText(app, "`${API_V1_PREFIX}/reports`", "Application Reports mount");
  requireText(openApi, "reportsOpenApiPaths", "Central OpenAPI Reports registry");
  requireText(openApi, 'name: "Reports & Analytics"', "Central OpenAPI Reports tag");

  if (
    packageJson.scripts?.["test:module20:contracts"] !==
    "vitest run tests/module20/module20.schemas.test.ts"
  ) {
    throw new Error("Backend package.json must expose test:module20:contracts.");
  }
  if (packageJson.scripts?.["db:seed:module20"] !== "tsx src/database/seeds/reports.seed.ts") {
    throw new Error("Backend package.json must expose db:seed:module20.");
  }
  requireText(ci, "npm run test:module20:contracts", "Backend CI");
  requireText(e2eRunner, '"test:module20:contracts"', "Provisioned E2E release runner");
  requireText(
    releaseRunner,
    "Current marketplace release gate passed through Module 1 Pass 8 E2E/regression verification.",
    "Current-stage release runner",
  );

  const unnecessaryBackendTypes = "marketplace-backend/src/modules/reports/reports.types.ts";
  if (existsSync(path.join(root, unnecessaryBackendTypes))) {
    throw new Error(`Module 20 must not create an empty/manual duplicate types file: ${unnecessaryBackendTypes}`);
  }

  if (routes.includes("/api/v1/audit/export")) {
    throw new Error("Module 20 must not add the superseded /api/v1/audit/export route.");
  }
}



/** Confirms the Module 20 React feature covers all approved reads and asynchronous export behavior. */
function verifyFrontendPass() {
  const api = read("marketplace-frontend/src/features/reports/api/reports.api.ts");
  const hooks = read("marketplace-frontend/src/features/reports/hooks/use-reports.ts");
  const form = read("marketplace-frontend/src/features/reports/forms/report-filter.form.tsx");
  const catalog = read("marketplace-frontend/src/features/reports/pages/report-catalog.page.tsx");
  const sales = read("marketplace-frontend/src/features/reports/pages/sales-report.page.tsx");
  const inventory = read("marketplace-frontend/src/features/reports/pages/inventory-report.page.tsx");
  const runPage = read("marketplace-frontend/src/features/reports/pages/report-run.page.tsx");
  const routes = read("marketplace-frontend/src/app/routes/reports.routes.tsx");
  const router = read("marketplace-frontend/src/app/router/router.tsx");
  const auditPage = read("marketplace-frontend/src/features/documents-audit/pages/audit.page.tsx");
  const tests = read("marketplace-frontend/tests/module20-reports.test.tsx");
  const packageJson = JSON.parse(read("marketplace-frontend/package.json"));
  const ci = read("marketplace-frontend/.github/workflows/ci.yml");

  for (const endpoint of [
    '"/reports/catalog"',
    '"/reports/sales"',
    '"/reports/sellers"',
    '"/reports/inventory"',
    '"/reports/refunds"',
    '"/reports/commissions"',
    '"/reports/payouts"',
    '"/reports/runs"',
    '`/reports/runs/${runId}`',
  ]) {
    requireText(api, endpoint, "Module 20 frontend API");
  }
  requireText(hooks, "useReportRunQuery", "Module 20 export polling hook");
  requireText(form, "useForm({", "Module 20 TanStack Form filters");
  requireText(form, "reportFilterFormSchema", "Module 20 Zod filters");
  requireText(catalog, "Report catalog", "Module 20 report catalog");
  requireText(sales, "GMV, captured customer cash, and refunds remain separate", "Module 20 financial separation UI");
  requireText(inventory, "mutate stock.", "Module 20 read-only Inventory UI");
  requireText(runPage, "Download export", "Module 20 signed-download UI");
  requireText(auditPage, "REPORT_CODE.AUDIT_LOG", "Module 20 audit-export UI integration");

  for (const route of [
    'path: "/reports"',
    'path: "/reports/sales"',
    'path: "/reports/sellers"',
    'path: "/reports/inventory"',
    'path: "/reports/refunds"',
    'path: "/reports/commissions"',
    'path: "/reports/payouts"',
    'path: "/reports/runs/$runId"',
  ]) {
    requireText(routes, route, "Module 20 frontend routes");
  }
  requireText(router, "reportsCatalogRoute", "Module 20 router registration");
  requireText(tests, "Module 20 Reports & Analytics React feature", "Module 20 RTL/MSW suite");

  if (packageJson.scripts?.["test:module20"] !== "vitest run tests/module20-reports.test.tsx") {
    throw new Error("Frontend package.json must expose test:module20.");
  }
  requireText(ci, "npm run test:module20", "Frontend Module 20 CI gate");
}

/** Confirms Module 20 Pass 6 has repository/service/runtime/HTTP/integration proof and release wiring. */
function verifyBackendTestsPass() {
  const repositoryTests = read("marketplace-backend/tests/module20/module20.repository.test.ts");
  const serviceTests = read("marketplace-backend/tests/module20/module20.service.test.ts");
  const exportTests = read("marketplace-backend/tests/module20/module20.export.test.ts");
  const jobsTests = read("marketplace-backend/tests/module20/module20.jobs.test.ts");
  const httpTests = read("marketplace-backend/tests/module20/module20.http.test.ts");
  const integrationTests = read("marketplace-backend/tests/module20/module20.integration.test.ts");
  const helpers = read("marketplace-backend/tests/module20/module20.test-helpers.ts");
  const runner = read("marketplace-backend/scripts/run-module20-tests.mjs");
  const packageJson = JSON.parse(read("marketplace-backend/package.json"));
  const ci = read("marketplace-backend/.github/workflows/ci.yml");
  const e2eRunner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");

  for (const [source, proof, label] of [
    [repositoryTests, "enforces seller/store scope in SQL", "Module 20 repository tests"],
    [repositoryTests, "persists asynchronous run transitions monotonically", "Module 20 repository tests"],
    [serviceTests, "keeps GMV, captured customer cash, and refunds separate", "Module 20 service tests"],
    [serviceTests, "returns a signed download only to the report requester after completion", "Module 20 service tests"],
    [httpTests, "denies missing report permission and rejects Seller B access to Seller A report scope", "Module 20 HTTP tests"],
    [httpTests, "creates and reads a requester-owned export run while hiding it from another seller", "Module 20 HTTP tests"],
    [integrationTests, "queues, generates, stores, downloads, and replays one export without duplicating terminal effects", "Module 20 integration tests"],
    [integrationTests, "records only the final export failure and keeps failure notification replay-safe", "Module 20 integration tests"],
    [jobsTests, "Module 20 Reports BullMQ runtime", "Module 20 jobs tests"],
    [exportTests, "Module 20 report export renderer", "Module 20 export tests"],
    [helpers, "ReportsDatabaseDocumentStub", "Module 20 test helpers"],
    [runner, "Module 20 Reports & Analytics backend verification completed successfully.", "Module 20 backend runner"],
  ]) {
    requireText(source, proof, label);
  }

  const expectedScripts = {
    "test:module20:repository": "vitest run tests/module20/module20.repository.test.ts",
    "test:module20:service": "vitest run tests/module20/module20.service.test.ts",
    "test:module20:runtime": "vitest run tests/module20/module20.export.test.ts tests/module20/module20.jobs.test.ts",
    "test:module20:http": "vitest run tests/module20/module20.http.test.ts",
    "test:module20:integration": "vitest run tests/module20/module20.integration.test.ts",
    "test:module20:specs": "vitest run tests/module20",
    "test:module20": "node scripts/run-module20-tests.mjs",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      throw new Error(`Backend package.json is missing or changed Module 20 script ${name}.`);
    }
  }
  requireText(ci, "npm run test:module20:specs", "Backend CI");
  requireText(e2eRunner, '"test:module20:specs"', "Provisioned E2E release runner");
}


/** Confirms the final Module 20 browser workflow and post-browser reconciliation are release-wired. */
function verifyFinalReleasePass() {
  const e2eSpec = read("marketplace-frontend/e2e/module20.spec.ts");
  const e2eRunner = read("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const frontendPackage = JSON.parse(read("marketplace-frontend/package.json"));
  const releaseData = read("marketplace-backend/scripts/verify-module20-release-data.mjs");
  const backendPackage = JSON.parse(read("marketplace-backend/package.json"));

  for (const proof of [
    "Module 20 Reports & Analytics E2E",
    "permission-filtered catalog",
    "REPORT_SCOPE_FORBIDDEN",
    "Download export",
    "report-run ownership",
    "exactly the nine approved Reports operations",
  ]) {
    requireText(e2eSpec, proof, "Module 20 Playwright suite");
  }

  for (const proof of [
    '"db:seed:module20"',
    '"e2e/module20.spec.ts"',
    '"test:module20:release-data"',
    "Run Playwright Foundation through Module 1 in dependency order",
  ]) {
    requireText(e2eRunner, proof, "Module 20 provisioned release runner");
  }

  for (const route of [
    '"/api/v1/reports/catalog"',
    '"/api/v1/reports/sales"',
    '"/api/v1/reports/sellers"',
    '"/api/v1/reports/inventory"',
    '"/api/v1/reports/refunds"',
    '"/api/v1/reports/commissions"',
    '"/api/v1/reports/payouts"',
    '"/api/v1/reports/runs"',
    '"/api/v1/reports/runs/{id}"',
  ]) {
    requireText(e2eRunner, route, "Module 20 live OpenAPI release check");
  }

  if (
    frontendPackage.scripts?.["test:e2e:module20"] !==
    "playwright test e2e/module20.spec.ts"
  ) {
    throw new Error("Frontend package.json must expose test:e2e:module20.");
  }
  if (
    backendPackage.scripts?.["test:module20:release-data"] !==
    "node scripts/verify-module20-release-data.mjs"
  ) {
    throw new Error("Backend package.json must expose test:module20:release-data.");
  }

  for (const proof of [
    "approved active report catalog",
    "completed CSV Sales export",
    "completed PDF Sales export",
    "generated-file ownership and purpose reconciliation",
    "request/generated outbox lifecycle reconciliation",
    "request/generated audit lifecycle reconciliation",
    "report-ready in-app notification",
    "duplicate generated file ownership",
  ]) {
    requireText(releaseData, proof, "Module 20 post-E2E reconciliation");
  }
}

verifyDatabasePass();
verifyContractPass();
verifyBackendTestsPass();
verifyFrontendPass();
verifyFinalReleasePass();
console.log("Module 20 Reports & Analytics Pass 8 E2E/regression static verification passed.");

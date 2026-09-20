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
  return readFileSync(absolutePath, "utf8");
}

/** Requires a known text fragment in one source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects text that would violate the selected Module 19 architecture. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Runs the accepted Module 7 structural gate before any Search work starts. */
function verifyModule7Prerequisite() {
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-module7-static.mjs")], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Module 7 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}


/** Runs the permanent cumulative backend-test regression gate. */
function verifyBackendTestContractGate() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-backend-test-contracts.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Backend test-contract verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Runs the permanent frontend feature/readability contract gate. */
function verifyFrontendFeatureContractGate() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-frontend-feature-contracts.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Frontend feature-contract verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Runs the permanent whole-application HTTP/OpenAPI parity gate. */
function verifyHttpContractGate() {
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-http-contracts.mjs")], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `HTTP/OpenAPI contract verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

/** Confirms frontend and backend remain independent projects on the required stack. */
function verifyTopologyAndStack() {
  for (const forbiddenRootFile of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenRootFile))) {
      throw new Error(`Independent-project topology violated by ${forbiddenRootFile}.`);
    }
  }

  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));

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

  for (const forbiddenSearchDependency of [
    "@elastic/elasticsearch",
    "elasticsearch",
    "meilisearch",
    "algoliasearch",
    "typesense",
  ]) {
    if (backendPackage.dependencies?.[forbiddenSearchDependency]) {
      throw new Error(
        `Module 19 must use PostgreSQL FTS + pg_trgm by default, not ${forbiddenSearchDependency}.`,
      );
    }
  }
}

/** Confirms the durable event/job primitives required by eventual Search synchronization already exist. */
function verifyFoundationSearchReadiness() {
  const transaction = readProjectFile("marketplace-backend/src/database/transaction.ts");
  const outboxService = readProjectFile(
    "marketplace-backend/src/common/outbox/outbox.service.ts",
  );
  const eventPublisher = readProjectFile(
    "marketplace-backend/src/common/outbox/bullmq-event.publisher.ts",
  );
  const queueFactory = readProjectFile(
    "marketplace-backend/src/common/jobs/queue.factory.ts",
  );
  const pagination = readProjectFile(
    "marketplace-backend/src/common/schemas/pagination.schema.ts",
  );
  const apiEnvelope = readProjectFile(
    "marketplace-backend/src/common/schemas/api-envelope.schema.ts",
  );

  requireText(transaction, "withTransaction", "Foundation transaction helper");
  requireText(outboxService, "async enqueue", "Foundation outbox service");
  requireText(eventPublisher, "jobId: eventId", "Retry-safe BullMQ outbox publisher");
  requireText(queueFactory, "createQueue", "Foundation BullMQ queue factory");
  requireText(queueFactory, "createWorker", "Foundation BullMQ worker factory");
  requireText(pagination, "paginationQuerySchema", "Shared pagination contract");
  requireText(apiEnvelope, "apiSuccessSchema", "Shared API envelope contract");
}

/** Confirms Catalog, Product, and Inventory expose the upstream data/events Search depends on. */
function verifySourceModuleReadiness() {
  const catalogConstants = readProjectFile(
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.constants.ts",
  );
  const productConstants = readProjectFile(
    "marketplace-backend/src/modules/products/products.constants.ts",
  );
  const productService = readProjectFile(
    "marketplace-backend/src/modules/products/products.service.ts",
  );
  const inventoryConstants = readProjectFile(
    "marketplace-backend/src/modules/inventory/inventory.constants.ts",
  );
  const inventoryService = readProjectFile(
    "marketplace-backend/src/modules/inventory/inventory.service.ts",
  );

  for (const eventCode of [
    "category.updated",
    "brand.updated",
    "attribute.updated",
    "category.attributes_changed",
  ]) {
    requireText(catalogConstants, eventCode, "Catalog Search source event");
  }

  for (const eventCode of [
    "product.created",
    "product.updated",
    "product.price_changed",
    "product.published",
    "product.unpublished",
  ]) {
    requireText(productConstants, eventCode, "Product Search source event");
  }

  for (const eventCode of [
    "inventory.adjusted",
    "inventory.reserved",
    "inventory.reservation_released",
    "inventory.shipped",
  ]) {
    requireText(inventoryConstants, eventCode, "Inventory Search source event");
  }

  requireText(productService, "getPublicProduct", "Public-safe Product service boundary");
  requireText(productService, "findPublicProductById", "Search/Product public-by-ID service boundary");
  requireText(productService, "findProductIdByVariantId", "Inventory-event Product resolution boundary");
  requireText(
    inventoryService,
    "resolveVariantSellerStoreForCommand",
    "Inventory/Product ownership service boundary",
  );
  requireText(
    inventoryService,
    "hasAvailableStockForVariants",
    "Search/Inventory public availability service boundary",
  );
}

/** Verifies the PostgreSQL Search read model and append-only migration contract. */
function verifySearchDatabase() {
  const drizzleDir = join(root, "marketplace-backend/drizzle");
  const migrations = readdirSync(drizzleDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  const searchMigrationIndex = migrations.indexOf("0012_search_discovery.sql");
  const searchRemediationIndex = migrations.indexOf("0013_search_reindex_error_code.sql");
  if (searchMigrationIndex < 0 || searchRemediationIndex !== searchMigrationIndex + 1) {
    throw new Error(
      "Module 19 migrations 0012 and 0013 must remain present and consecutive in append-only history.",
    );
  }

  const schema = readProjectFile(
    "marketplace-backend/src/database/schema/search-discovery.ts",
  );
  const schemaIndex = readProjectFile("marketplace-backend/src/database/schema/index.ts");
  const relations = readProjectFile("marketplace-backend/src/database/relations.ts");
  const migration = readProjectFile(
    "marketplace-backend/drizzle/0012_search_discovery.sql",
  );
  const repositoryRemediationMigration = readProjectFile(
    "marketplace-backend/drizzle/0013_search_reindex_error_code.sql",
  );
  const migrationVerifier = readProjectFile(
    "marketplace-backend/scripts/verify-module19-migrations.mjs",
  );
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));

  for (const tableName of [
    "product_search_documents",
    "search_synonyms",
    "search_reindex_runs",
  ]) {
    requireText(schema, `\"${tableName}\"`, "Module 19 Drizzle schema");
    requireText(migration, `CREATE TABLE \"${tableName}\"`, "Module 19 migration");
  }

  for (const databaseFeature of [
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "product_search_documents_fts_idx",
    "to_tsvector('simple'",
    "product_search_documents_trgm_idx",
    "gin_trgm_ops",
    "product_search_documents_attributes_idx",
    "jsonb_path_ops",
    "search_synonyms_term_uq",
    "search_reindex_runs_active_scope_uq",
  ]) {
    requireText(migration, databaseFeature, "Module 19 Search database feature");
  }

  for (const integrityGuard of [
    "product_search_documents_price_range_check",
    "product_search_documents_rating_avg_check",
    "product_search_documents_attributes_object_check",
    "search_synonyms_term_normalized_check",
    "search_synonyms_values_array_check",
    "search_reindex_runs_status_check",
    "search_reindex_runs_state_check",
  ]) {
    requireText(migration, integrityGuard, "Module 19 database integrity guard");
  }

  for (const fieldName of [
    "searchableText",
    "categoryPath",
    "brand",
    "minPrice",
    "maxPrice",
    "ratingAvg",
    "ratingCount",
    "inStock",
    "filterableAttributes",
  ]) {
    requireText(schema, `${fieldName}:`, "Product Search document field");
  }

  requireText(schema, 'errorCode: varchar("error_code"', "Search reindex stable error-code persistence");
  rejectText(schema, 'errorMessage: text("error_message")', "Search reindex persistence contract");
  requireText(
    repositoryRemediationMigration,
    'RENAME COLUMN "error_message" TO "error_code"',
    "Append-only Search reindex persistence remediation",
  );

  requireText(
    schemaIndex,
    'export * from "./search-discovery.js";',
    "Search schema export registry",
  );
  requireText(
    relations,
    "productSearchDocumentsRelations",
    "Search document relations",
  );
  requireText(
    migrationVerifier,
    "Module 19 migration verification passed.",
    "Module 19 migration verifier",
  );
  requireText(
    migrationVerifier,
    "verifyModule7UpgradePath",
    "Module 7 to Module 19 upgrade verification",
  );

  if (
    backendPackage.scripts?.["test:module19:migrations"] !==
    "node scripts/verify-module19-migrations.mjs"
  ) {
    throw new Error(
      "Backend package is missing the permanent Module 19 migration verification command.",
    );
  }
}

/** Verifies bounded Search contracts, stable constants, inferred types, and RBAC composition. */
function verifySearchContracts() {
  const constants = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.constants.ts",
  );
  const schemas = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.schema.ts",
  );
  const platformRbac = readProjectFile(
    "marketplace-backend/src/database/seeds/platform-rbac.seed.ts",
  );

  for (const permission of ["search.public", "admin.search.manage"]) {
    requireText(constants, permission, "Search permission contract");
  }

  for (const errorCode of [
    "SEARCH_QUERY_INVALID",
    "SEARCH_INDEX_UNAVAILABLE",
    "SEARCH_REINDEX_RUNNING",
  ]) {
    requireText(constants, errorCode, "Search error contract");
  }

  for (const eventCode of [
    "search.document_updated",
    "search.reindex_started",
    "search.reindex_completed",
    "search.reindex_failed",
  ]) {
    requireText(constants, eventCode, "Search event contract");
  }

  for (const sortValue of [
    "relevance",
    "price_asc",
    "price_desc",
    "rating_desc",
    "newest",
  ]) {
    requireText(constants, `"${sortValue}"`, "Search Product sort allow-list");
  }

  for (const schemaName of [
    "searchProductsQuerySchema",
    "searchSuggestionsQuerySchema",
    "searchStoresQuerySchema",
    "searchReindexIdParamsSchema",
    "queueSearchReindexBodySchema",
    "searchProductCardResponseSchema",
    "searchFacetsResponseSchema",
    "searchProductsDataSchema",
    "searchSuggestionsDataSchema",
    "searchStoresDataSchema",
    "searchReindexRunResponseSchema",
  ]) {
    requireText(schemas, `export const ${schemaName}`, "Search Zod contract");
  }

  for (const filterName of [
    "categoryId",
    "brandId",
    "attribute",
    "minPrice",
    "maxPrice",
    "minRating",
    "inStock",
    "sort",
  ]) {
    requireText(schemas, `${filterName}:`, "Search Product filter contract");
  }

  requireText(schemas, "paginationQuerySchema", "Search shared pagination contract");
  requireText(schemas, "comparePriceStrings", "Exact Search price-range validation");
  requireText(schemas, "publicStoreResponseSchema", "Public-safe store Search response");
  requireText(schemas, "finishedAt", "Source-aligned Search reindex response");
  requireText(schemas, "errorCode", "Source-aligned Search reindex error response");
  rejectText(schemas, "sellerId:", "Public Search response privacy boundary");
  rejectText(schemas, "publicationStatus", "Public Search response privacy boundary");

  requireText(platformRbac, "SEARCH_PERMISSION_CATALOG", "Platform Search permission composition");
  requireText(platformRbac, "SEARCH_PERMISSION.PUBLIC", "Authenticated public Search permission grant");

  if (existsSync(join(root, "marketplace-backend/src/modules/search-discovery/search-discovery.types.ts"))) {
    throw new Error(
      "Do not create an unnecessary Search types file; infer types from Zod/Drizzle.",
    );
  }
}

/** Verifies Search repositories stay persistence-focused and expose only required lifecycle helpers. */
function verifySearchRepository() {
  const repository = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.repository.ts",
  );

  for (const methodName of [
    "findProductSearchDocument",
    "upsertProductSearchDocument",
    "deleteProductSearchDocument",
    "searchProducts",
    "getProductFacets",
    "searchSuggestions",
    "searchStores",
    "listActiveSynonymsByTerms",
    "createReindexRun",
    "findActiveReindexRun",
    "findReindexRunById",
    "markReindexRunRunning",
    "markReindexRunCompleted",
    "markReindexRunFailed",
    "listPublishedProductIdsForReindex",
  ]) {
    requireText(repository, `async ${methodName}`, "Search repository method");
  }

  for (const searchPrimitive of [
    "to_tsvector('simple'",
    "websearch_to_tsquery('simple'",
    "similarity(",
    "jsonb_each(",
    "jsonb_array_elements_text(",
  ]) {
    requireText(repository, searchPrimitive, "PostgreSQL Search repository primitive");
  }

  for (const publicGuard of [
    "PRODUCT_PUBLICATION_STATUS.PUBLISHED",
    "PRODUCT_STATUS.ACTIVE",
    "STORE_STATUS.ACTIVE",
    "SELLER_STATUS.ACTIVE",
    "SELLER_APPROVAL_STATUS.APPROVED",
    "CATALOG_STATUS.ACTIVE",
  ]) {
    requireText(repository, publicGuard, "Public Search visibility guard");
  }

  requireText(repository, "filterableAttributes} @>", "Allow-listed attribute facet filtering");
  requireText(repository, "onConflictDoUpdate", "Idempotent Search document upsert");
  requireText(repository, "SEARCH_REINDEX_STATUS.QUEUED", "Reindex persistence lifecycle");
  requireText(repository, "SEARCH_REINDEX_STATUS.RUNNING", "Reindex persistence lifecycle");
  requireText(repository, "errorCode", "Stable reindex failure persistence");
  requireText(repository, "DatabaseExecutor", "Transaction-ready Search repository executor");

  for (const forbiddenRepositoryImport of [
    "products.repository",
    "inventory.repository",
    "catalog-taxonomy.repository",
    "sellers.repository",
  ]) {
    rejectText(repository, forbiddenRepositoryImport, "Cross-module repository boundary");
  }

  rejectText(repository, "OutboxService", "Repository business-side-effect boundary");
  rejectText(repository, "AuditService", "Repository business-side-effect boundary");
  rejectText(repository, "createQueue", "Repository queue boundary");
  rejectText(repository, "createWorker", "Repository worker boundary");
}

/** Verifies Search service orchestration, source-service composition, durable events, and retry-safe reindex jobs. */
function verifySearchService() {
  const service = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.service.ts",
  );
  const jobs = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.jobs.ts",
  );
  const index = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/index.ts",
  );
  const repository = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.repository.ts",
  );

  for (const methodName of [
    "searchProducts",
    "searchSuggestions",
    "searchStores",
    "queueFullReindex",
    "getReindexStatus",
    "recoverQueuedReindexJob",
    "synchronizeProductDocument",
    "handleSourceEvent",
    "runFullReindex",
    "failReindexRun",
  ]) {
    requireText(service, `async ${methodName}`, "Search service method");
  }

  for (const sourceBoundary of [
    "ProductsService",
    "CatalogTaxonomyService",
    "InventoryService",
    "findPublicProductById",
    "findProductIdByVariantId",
    "hasAvailableStockForVariants",
  ]) {
    requireText(service, sourceBoundary, "Search source-module service boundary");
  }

  for (const servicePrimitive of [
    "withTransaction",
    "AuditService",
    "OutboxService",
    "SEARCH_OUTBOX_EVENT.DOCUMENT_UPDATED",
    "SEARCH_OUTBOX_EVENT.REINDEX_STARTED",
    "SEARCH_OUTBOX_EVENT.REINDEX_COMPLETED",
    "SEARCH_OUTBOX_EVENT.REINDEX_FAILED",
    "SEARCH_REINDEX_FAILURE_CODE.QUEUE_UNAVAILABLE",
    "SEARCH_REINDEX_FAILURE_CODE.PROCESSING_FAILED",
    "SEARCH_ERROR_CODE.SEARCH_INDEX_UNAVAILABLE",
    "SEARCH_ERROR_CODE.SEARCH_REINDEX_RUNNING",
    "SEARCH_ERROR_CODE.SEARCH_QUERY_INVALID",
  ]) {
    requireText(service, servicePrimitive, "Search service invariant");
  }

  for (const sourceEvent of [
    "product.published",
    "product.unpublished",
    "product.price_changed",
    "inventory.adjusted",
    "inventory.reserved",
    "inventory.reservation_released",
    "inventory.shipped",
    "category.updated",
    "brand.updated",
    "attribute.updated",
    "category.attributes_changed",
  ]) {
    requireText(service, sourceEvent, "Search eventual source-event synchronization");
  }

  requireText(service, "listActiveSynonymsByTerms", "Search active synonym expansion");
  requireText(service, "filterableAttributes", "Search derived filterable attribute composition");
  requireText(service, "ratingAvg: rating.average.toFixed(2)", "Future-ready rating aggregate composition");
  requireText(service, "if (!this.ratings) return { average: 0, count: 0 }", "Deferred Module 15 rating default");
  requireText(service, "searchDocumentMatches", "Idempotent Search document synchronization");
  requireText(service, "REINDEX_BATCH_SIZE", "Bounded full reindex batching");
  requireText(service, "deleteNonPublicProductSearchDocuments", "Full reindex stale-document cleanup");

  for (const forbiddenServiceImport of [
    "products.repository",
    "inventory.repository",
    "catalog-taxonomy.repository",
    "sellers.repository",
  ]) {
    rejectText(service, forbiddenServiceImport, "Cross-module Search service repository boundary");
  }

  for (const jobPrimitive of [
    "createQueue",
    "createWorker",
    "jobId: reindexRunId",
    "isFinalAttempt",
    "SEARCH_REINDEX_FAILURE_CODE.PROCESSING_FAILED",
  ]) {
    requireText(jobs, jobPrimitive, "Search BullMQ reindex job behavior");
  }

  requireText(repository, "deleteNonPublicProductSearchDocuments", "Search stale-document repository helper");
  requireText(repository, "markQueuedReindexRunFailed", "Search queue-failure repository helper");
  requireText(index, 'export * from "./search-discovery.service.js";', "Search service module export");
  requireText(index, 'export * from "./search-discovery.jobs.js";', "Search job module export");
}

/** Verifies the five required Search HTTP routes, thin controllers, and policy boundaries. */
function verifySearchHttp() {
  const controller = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.controller.ts",
  );
  const routes = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.routes.ts",
  );
  const constants = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/search-discovery.constants.ts",
  );
  const index = readProjectFile(
    "marketplace-backend/src/modules/search-discovery/index.ts",
  );
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const openApi = readProjectFile(
    "marketplace-backend/src/http/openapi/openapi.document.ts",
  );

  for (const methodName of [
    "searchProducts",
    "searchSuggestions",
    "searchStores",
    "queueFullReindex",
    "getReindexStatus",
  ]) {
    requireText(controller, `${methodName} = async`, "Search HTTP controller method");
  }

  requireText(controller, "searchService.searchQueryInvalid()", "Stable Search query validation error mapping");
  requireText(controller, "response.status(202)", "Queued Search reindex HTTP status");
  requireText(controller, "successResponse", "Canonical Search success envelope");
  rejectText(controller, "SearchDiscoveryRepository", "Thin Search controller boundary");
  rejectText(controller, "withTransaction", "Thin Search controller boundary");
  rejectText(controller, "OutboxService", "Thin Search controller boundary");

  for (const routeFragment of [
    'router.get("/products", controller.searchProducts)',
    'router.get("/suggestions", controller.searchSuggestions)',
    'router.get("/stores", controller.searchStores)',
    '"/reindex",',
    '"/reindex/:id",',
  ]) {
    requireText(routes, routeFragment, "Required Module 19 HTTP route");
  }

  requireText(routes, "optionalAuthenticationMiddleware", "Public Search optional authentication boundary");
  requireText(routes, "SEARCH_PERMISSION.PUBLIC", "Authenticated public Search permission precheck");
  requireText(routes, "authenticationMiddleware", "Admin Search authentication middleware");
  requireText(routes, "requirePermission(SEARCH_PERMISSION.ADMIN_MANAGE)", "Admin Search RBAC middleware");
  requireText(routes, "rateLimit({", "Admin Search dedicated rate limiting");
  requireText(routes, "SEARCH_REINDEX_RATE_LIMIT", "Search reindex rate-limit constants");
  requireText(routes, "ERROR_CODE.RATE_LIMITED", "Search reindex stable rate-limit error");
  requireText(constants, "export const SEARCH_REINDEX_RATE_LIMIT", "Search reindex HTTP rate-limit contract");

  for (const openApiPath of [
    '"/api/v1/search/products"',
    '"/api/v1/search/suggestions"',
    '"/api/v1/search/stores"',
    '"/api/v1/admin/search/reindex"',
    '"/api/v1/admin/search/reindex/{id}"',
  ]) {
    requireText(routes, openApiPath, "Module 19 OpenAPI path");
  }
  requireText(routes, 'security: [{ bearerAuth: [] }]', "Admin Search OpenAPI bearer security");
  requireText(controller, "searchProductsQuerySchema", "Search Product controller contract reuse");
  requireText(controller, "searchSuggestionsQuerySchema", "Search suggestions controller contract reuse");
  requireText(controller, "searchStoresQuerySchema", "Search Stores controller contract reuse");
  requireText(routes, "SEARCH_PRODUCT_SORT_VALUES", "Search Product OpenAPI sort allow-list reuse");
  requireText(routes, "SEARCH_STORE_SORT_VALUES", "Search Store OpenAPI sort allow-list reuse");
  requireText(routes, "PAGINATION.MAX_PAGE_SIZE", "Search OpenAPI pagination bound reuse");
  requireText(routes, "searchReindexRunResponseSchema", "Search reindex OpenAPI response contract reuse");

  requireText(index, 'export * from "./search-discovery.controller.js";', "Search controller module export");
  requireText(index, 'export * from "./search-discovery.routes.js";', "Search routes module export");

  requireText(app, "new SearchDiscoveryService({", "Search runtime service composition");
  requireText(app, "products: productsService", "Search/Product composed service boundary");
  requireText(app, "catalog: catalogTaxonomyService", "Search/Catalog composed service boundary");
  requireText(app, "inventory: inventoryService", "Search/Inventory composed service boundary");
  requireText(app, 'app.use(`${API_V1_PREFIX}/search`, publicSearchRouter)', "Public Search Express mount");
  requireText(app, 'app.use(`${API_V1_PREFIX}/admin/search`, adminSearchRouter)', "Admin Search Express mount");

  requireText(openApi, "searchDiscoveryOpenApiPaths", "Search OpenAPI document composition");
  requireText(openApi, 'name: "Search & Discovery"', "Search OpenAPI tag");
  requireText(openApi, "...searchDiscoveryOpenApiPaths", "Search OpenAPI path registration");
}

/** Verifies the required Search backend contracts, repository behavior, services, and API regression tests. */
function verifySearchBackendTests() {
  const testFiles = [
    "marketplace-backend/tests/module19/module19.schemas.test.ts",
    "marketplace-backend/tests/module19/module19.repository.test.ts",
    "marketplace-backend/tests/module19/module19.service.test.ts",
    "marketplace-backend/tests/module19/module19.integration.test.ts",
    "marketplace-backend/tests/module19/module19.test-helpers.ts",
  ];
  for (const relativePath of testFiles) {
    if (!existsSync(join(root, relativePath))) {
      throw new Error(`Module 19 backend test file is missing: ${relativePath}`);
    }
  }

  const schemas = readProjectFile(testFiles[0]);
  const repositoryTests = readProjectFile(testFiles[1]);
  const serviceTests = readProjectFile(testFiles[2]);
  const integrationTests = readProjectFile(testFiles[3]);
  const runner = readProjectFile("marketplace-backend/scripts/run-module19-tests.mjs");
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const ci = readProjectFile("marketplace-backend/.github/workflows/ci.yml");

  for (const proof of [
    "SEARCH_QUERY_INVALID",
    "raw_sql",
    "pageSize",
    "five required Search routes",
  ]) {
    requireText(schemas, proof, "Module 19 contract/OpenAPI test proof");
  }

  for (const proof of [
    "FTS/trigram",
    "wireless headphons",
    "attribute",
    "inStock",
    "one active full-catalog reindex",
  ]) {
    requireText(repositoryTests, proof, "Module 19 repository test proof");
  }

  for (const proof of [
    "sneakers OR shoes OR trainers",
    "SEARCH_INDEX_UNAVAILABLE",
    "inventory.adjusted",
    "category.updated",
    "admin.search.manage",
  ]) {
    requireText(serviceTests, proof, "Module 19 service test proof");
  }

  for (const proof of [
    "anonymous public Search",
    "SEARCH_REINDEX_RUNNING",
    "QUEUE_UNAVAILABLE",
    "REINDEX_STARTED",
    "REINDEX_COMPLETED",
    "sellerId",
  ]) {
    requireText(integrationTests, proof, "Module 19 API/reindex test proof");
  }

  requireText(runner, "test:module19:migrations", "Module 19 cumulative backend runner");
  requireText(runner, "test:module19:specs", "Module 19 cumulative backend runner");
  requireText(runner, "test:module7:specs", "Module 19 prerequisite regression runner");
  requireText(runner, "typecheck", "Module 19 backend quality gate");
  requireText(runner, "lint", "Module 19 backend quality gate");
  requireText(runner, "build", "Module 19 backend quality gate");

  if (backendPackage.scripts?.["test:module19:specs"] !== "vitest run tests/module19") {
    throw new Error("Backend package is missing the Module 19 Vitest command.");
  }
  if (backendPackage.scripts?.["test:module19"] !== "node scripts/run-module19-tests.mjs") {
    throw new Error("Backend package is missing the cumulative Module 19 backend command.");
  }

  requireText(ci, "Verify Module 19 clean and upgrade migrations", "Backend CI Module 19 migration gate");
  requireText(ci, "Run Module 19 tests", "Backend CI Module 19 test gate");

  const pathsThatMustNotExist = [
    "marketplace-backend/src/integrations/search",
  ];
  for (const relativePath of pathsThatMustNotExist) {
    if (existsSync(join(root, relativePath))) {
      throw new Error(`Unexpected Module 19 integration directory found: ${relativePath}`);
    }
  }
}

/** Verifies the required public Search frontend, API hooks, forms, components, and RTL tests. */
function verifySearchFrontend() {
  const requiredFiles = [
    "marketplace-frontend/src/features/search-discovery/search-discovery.constants.ts",
    "marketplace-frontend/src/features/search-discovery/schemas/search-discovery.schemas.ts",
    "marketplace-frontend/src/features/search-discovery/api/search-discovery.api.ts",
    "marketplace-frontend/src/features/search-discovery/hooks/search-discovery.query-keys.ts",
    "marketplace-frontend/src/features/search-discovery/hooks/use-search-discovery.ts",
    "marketplace-frontend/src/features/search-discovery/forms/search-filters.form.tsx",
    "marketplace-frontend/src/features/search-discovery/components/search-autocomplete.tsx",
    "marketplace-frontend/src/features/search-discovery/components/search-facets.tsx",
    "marketplace-frontend/src/features/search-discovery/components/search-product-card.tsx",
    "marketplace-frontend/src/features/search-discovery/components/search-pagination.tsx",
    "marketplace-frontend/src/features/search-discovery/pages/search-products.page.tsx",
    "marketplace-frontend/src/features/search-discovery/pages/search-stores.page.tsx",
    "marketplace-frontend/src/app/routes/search-discovery.routes.tsx",
    "marketplace-frontend/tests/module19-search-discovery.test.tsx",
  ];
  for (const relativePath of requiredFiles) {
    if (!existsSync(join(root, relativePath))) {
      throw new Error(`Module 19 frontend file is missing: ${relativePath}`);
    }
  }

  const schemas = readProjectFile(requiredFiles[1]);
  const api = readProjectFile(requiredFiles[2]);
  const hooks = readProjectFile(requiredFiles[4]);
  const form = readProjectFile(requiredFiles[5]);
  const autocomplete = readProjectFile(requiredFiles[6]);
  const facets = readProjectFile(requiredFiles[7]);
  const card = readProjectFile(requiredFiles[8]);
  const productsPage = readProjectFile(requiredFiles[10]);
  const storesPage = readProjectFile(requiredFiles[11]);
  const routes = readProjectFile(requiredFiles[12]);
  const tests = readProjectFile(requiredFiles[13]);
  const router = readProjectFile("marketplace-frontend/src/app/router/router.tsx");
  const shell = readProjectFile("marketplace-frontend/src/components/layout/app-shell.tsx");
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const ci = readProjectFile("marketplace-frontend/.github/workflows/ci.yml");

  for (const proof of [
    "searchProductsRouteSearchSchema",
    "searchFiltersFormSchema",
    "searchProductCardSchema",
    "searchFacetsSchema",
    "SearchProductsRouteSearch",
  ]) {
    requireText(schemas, proof, "Module 19 frontend Zod contract");
  }

  for (const endpoint of [
    '/search/products',
    '/search/suggestions',
    '/search/stores',
  ]) {
    requireText(api, endpoint, "Module 19 public Search API client");
  }
  requireText(api, "URLSearchParams", "Repeated attribute Search query serializer");
  rejectText(api, "/admin/search", "Public storefront Search client");

  requireText(hooks, "useQuery", "TanStack Query Search server state");
  requireText(hooks, "useDebouncedSearchText", "Bounded autocomplete request pacing");
  requireText(form, "useForm", "TanStack Form Search filters");
  requireText(form, "searchFiltersFormSchema", "Zod Search form validation");
  requireText(autocomplete, "useSearchSuggestionsQuery", "Search autocomplete UI");

  for (const proof of ["Categories", "Brands", "attributes", "Availability"]) {
    requireText(facets, proof, "Search facet UI");
  }
  requireText(card, 'to="/products/$slug"', "Search Product card source-detail link");
  requireText(card, "Search price and stock are discovery hints", "Search non-authoritative cache warning");
  requireText(productsPage, "Refreshing Search results", "Search stale-data state");
  requireText(productsPage, "No Products found", "Search empty state");
  requireText(productsPage, "INDEX_UNAVAILABLE", "Search unavailable state");
  requireText(storesPage, 'to="/stores/$slug"', "Public Store Search result link");

  requireText(routes, 'path: "/search"', "Product Search route");
  requireText(routes, 'path: "/search/stores"', "Store Search route");
  requireText(routes, "validateSearch", "URL-backed Search route validation");
  requireText(router, "searchProductsRoute", "Search router registration");
  requireText(router, "searchStoresRoute", "Store Search router registration");
  requireText(shell, 'to="/search"', "Storefront Search navigation");

  for (const proof of [
    "URL-backed category, attribute, sort, and pagination filters",
    "bounded autocomplete",
    "searches public stores",
  ]) {
    requireText(tests, proof, "Module 19 frontend test proof");
  }

  if (frontendPackage.scripts?.["test:module19"] !== "vitest run tests/module19-search-discovery.test.tsx") {
    throw new Error("Frontend package is missing the Module 19 focused Vitest command.");
  }
  requireText(ci, "Run Module 19 Search frontend tests", "Frontend CI Module 19 test gate");

  if (existsSync(join(root, "marketplace-frontend/src/features/search-discovery/types"))) {
    throw new Error("Module 19 frontend must infer its feature types from Zod instead of adding a redundant types directory.");
  }
}

/** Confirms the release stage wires the live Search runtime, browser workflow, integrity checks, and cumulative gate. */
function verifySearchRelease() {
  const requiredFiles = [
    "marketplace-backend/src/modules/search-discovery/search-discovery.runtime.ts",
    "marketplace-backend/scripts/verify-module19-release-data.mjs",
    "marketplace-frontend/e2e/module19.spec.ts",
    "scripts/verify-module19.mjs",
  ];
  for (const relativePath of requiredFiles) {
    if (!existsSync(join(root, relativePath))) {
      throw new Error(`Module 19 release file is missing: ${relativePath}`);
    }
  }

  const runtime = readProjectFile(requiredFiles[0]);
  const releaseData = readProjectFile(requiredFiles[1]);
  const e2e = readProjectFile(requiredFiles[2]);
  const releaseVerifier = readProjectFile(requiredFiles[3]);
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const server = readProjectFile("marketplace-backend/src/server.ts");
  const outboxRuntime = readProjectFile(
    "marketplace-backend/src/common/outbox/outbox-worker.ts",
  );
  const outboxPublisher = readProjectFile(
    "marketplace-backend/src/common/outbox/bullmq-event.publisher.ts",
  );
  const index = readProjectFile("marketplace-backend/src/modules/search-discovery/index.ts");
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));

  for (const proof of [
    "SEARCH_JOB.SOURCE_EVENT_QUEUE",
    "createSearchReindexWorker",
    "service.handleSourceEvent",
    "service.recoverQueuedReindexJob",
  ]) {
    requireText(runtime, proof, "Module 19 live Search runtime");
  }
  rejectText(runtime, "createOutboxDispatcher", "Search runtime Foundation boundary");
  rejectText(runtime, "dispatchOutboxBatch", "Search runtime Foundation boundary");
  requireText(index, 'export * from "./search-discovery.runtime.js";', "Search runtime module export");
  for (const proof of [
    "startOutboxRuntime",
    "destinationQueueNames",
    "new Set(destinationQueueNames)",
    "Foundation outbox dispatch failed",
  ]) {
    requireText(outboxRuntime, proof, "Foundation outbox runtime fan-out ownership");
  }
  for (const proof of [
    "this.queues.map",
    "jobId: eventId",
    "removeOnComplete",
  ]) {
    requireText(outboxPublisher, proof, "Foundation domain-event fan-out publisher");
  }
  requireText(app, "searchDiscoveryService = defaultComposition.searchDiscoveryService", "Shared HTTP/Search runtime composition");
  requireText(server, "startSearchDiscoveryRuntime(searchDiscoveryService)", "Search runtime server bootstrap");
  if (!/startOutboxRuntime\(\s*\[\s*SEARCH_JOB\.SOURCE_EVENT_QUEUE[\s,\S]*?\]\s*\)/u.test(server)) {
    throw new Error(
      "Foundation outbox fan-out bootstrap must include SEARCH_JOB.SOURCE_EVENT_QUEUE.",
    );
  }
  requireText(server, "await outboxRuntime.close()", "Foundation outbox graceful shutdown");
  requireText(server, "await searchRuntime.close()", "Search runtime graceful shutdown");

  for (const proof of [
    "searches, autocompletes, filters by facets/price/stock",
    "blocks invalid Search price filters with readable browser validation",
    "Request ID: e2e-search-request-123",
    "reflects source name, price, and availability changes",
    "completes the privileged full-reindex lifecycle",
    "removes an unpublished Product from Search",
    "sellerId",
    "publicationStatus",
  ]) {
    requireText(e2e, proof, "Module 19 Playwright proof");
  }

  for (const proof of [
    "Search stale public visibility",
    "Search source price range reconciliation",
    "Search Inventory availability reconciliation",
    "Search pre-Module-15 rating default",
    "Search active reindex leak",
    "pg_trgm",
    "product_search_documents_fts_idx",
  ]) {
    requireText(releaseData, proof, "Module 19 post-E2E integrity proof");
  }

  for (const proof of [
    "requireLocalReleasePrerequisites",
    "Docker Compose v2",
    "test:module19:migrations",
    "test:module19:specs",
    "e2e/module19.spec.ts",
    "test:module19:release-data",
    "marketplace-backend-module19-release",
    "marketplace-frontend-module19-release",
    "verifyLiveImplementedOpenApi",
  ]) {
    requireText(releaseVerifier, proof, "Module 19 full release verifier");
  }

  if (
    backendPackage.scripts?.["test:module19:release-data"] !==
    "node scripts/verify-module19-release-data.mjs"
  ) {
    throw new Error("Backend package is missing the Module 19 post-E2E integrity command.");
  }
  if (
    frontendPackage.scripts?.["test:e2e:module19"] !==
    "playwright test e2e/module19.spec.ts"
  ) {
    throw new Error("Frontend package is missing the focused Module 19 Playwright command.");
  }
}

/** Rejects generated build/test output and disposable pass-evidence files from the delivery. */
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

  /** Walks one directory without following dependency/build output. */
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

/** Runs the cumulative structural verification gate for the implemented Module 19 stage. */
function main() {
  verifyModule7Prerequisite();
  verifyBackendTestContractGate();
  verifyHttpContractGate();
  verifyFrontendFeatureContractGate();
  verifyTopologyAndStack();
  verifyFoundationSearchReadiness();
  verifySourceModuleReadiness();
  verifySearchDatabase();
  verifySearchContracts();
  verifySearchRepository();
  verifySearchService();
  verifySearchHttp();
  verifySearchBackendTests();
  verifySearchFrontend();
  verifySearchRelease();
  verifyNoDisposableArtifacts();
  console.log("Module 19 cumulative static verification passed.");
}

main();

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one UTF-8 project file and fails with a useful path when it is missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
}

/** Fails when required source text is missing. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Fails when forbidden source text is present. */
function forbidText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Confirms frontend and backend remain independent projects using the required stack. */
function verifyTopologyAndStack() {
  for (const forbiddenPath of ["package.json", "pnpm-workspace.yaml", "turbo.json"]) {
    if (existsSync(join(root, forbiddenPath))) {
      throw new Error(`Independent-project topology violated by ${forbiddenPath}.`);
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
}

/** Confirms Pass 1's five Product tables and append-only migration frontier are present. */
function verifyDatabasePass() {
  const schema = readProjectFile("marketplace-backend/src/database/schema/products.ts");
  const baseMigration = readProjectFile("marketplace-backend/drizzle/0009_product_management.sql");
  const integrityMigration = readProjectFile(
    "marketplace-backend/drizzle/0010_product_management_integrity.sql",
  );
  const schemaIndex = readProjectFile("marketplace-backend/src/database/schema/index.ts");
  const relations = readProjectFile("marketplace-backend/src/database/relations.ts");
  const packageJson = JSON.parse(readProjectFile("marketplace-backend/package.json"));

  for (const tableName of [
    '"products"',
    '"product_variants"',
    '"product_attribute_values"',
    '"product_media"',
    '"product_price_history"',
  ]) {
    requireText(schema, tableName, "Module 6 Drizzle schema");
    requireText(baseMigration, tableName, "Module 6 base migration");
  }
  requireText(schema, 'numeric("price", { precision: 18, scale: 2 })', "Variant money schema");
  requireText(
    baseMigration,
    "product_price_history_append_only_trigger",
    "Price-history immutability migration",
  );
  requireText(schema, 'uniqueIndex("products_slug_uq").on(table.slug)', "Global Product slug schema");
  requireText(schema, 'name: "products_store_seller_fk"', "Seller/store ownership schema");
  requireText(
    schema,
    'name: "product_attribute_values_value_attribute_fk"',
    "Attribute/value ownership schema",
  );
  requireText(
    integrityMigration,
    'CREATE UNIQUE INDEX "products_slug_uq"',
    "Global Product slug migration",
  );
  requireText(
    integrityMigration,
    'CONSTRAINT "products_store_seller_fk"',
    "Seller/store ownership migration",
  );
  requireText(
    integrityMigration,
    'product_variants_seller_store_sku_trigger',
    "Seller/store SKU integrity migration",
  );
  requireText(
    integrityMigration,
    'product_attribute_values_value_attribute_fk',
    "Attribute/value ownership migration",
  );
  requireText(schemaIndex, 'export * from "./products.js";', "Central schema registry");
  requireText(relations, "productsRelations", "Central Drizzle relations");
  requireText(relations, "productVariantsRelations", "Central Drizzle relations");
  requireText(
    JSON.stringify(packageJson.scripts),
    "test:module6:migrations",
    "Backend Module 6 migration command",
  );

  const migrations = readdirSync(join(root, "marketplace-backend/drizzle"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  const productMigrationIndex = migrations.indexOf("0009_product_management.sql");
  const integrityMigrationIndex = migrations.indexOf("0010_product_management_integrity.sql");
  if (productMigrationIndex < 0 || integrityMigrationIndex !== productMigrationIndex + 1) {
    throw new Error("Module 6 migrations 0009 and 0010 must remain present and consecutive.");
  }
}

/** Confirms the Pass 2 permission, error, event, and status constants match the controlling Module 6 contract. */
function verifyProductConstants() {
  const constants = readProjectFile(
    "marketplace-backend/src/modules/products/products.constants.ts",
  );

  for (const permission of [
    "products.public.read",
    "seller.products.read",
    "seller.products.create",
    "seller.products.update",
    "seller.products.publish",
    "admin.products.review",
  ]) {
    requireText(constants, permission, "Module 6 permission catalog");
  }

  for (const code of [
    "PRODUCT_NOT_FOUND",
    "DUPLICATE_SKU",
    "PRODUCT_NOT_PUBLISHABLE",
    "PRODUCT_SCOPE_FORBIDDEN",
    "INVALID_PRODUCT_ATTRIBUTE",
    "PRODUCT_SLUG_TAKEN",
    "PRODUCT_CURRENCY_UNSUPPORTED",
  ]) {
    requireText(constants, code, "Module 6 error catalog");
  }

  forbidText(constants, "DEFAULT_PAGE_SIZE", "Module 6 duplicate pagination constants");
  forbidText(constants, "MAX_PAGE_SIZE", "Module 6 duplicate pagination constants");

  for (const event of [
    "product.created",
    "product.updated",
    "product.price_changed",
    "product.published",
    "product.unpublished",
    "product.media_changed",
  ]) {
    requireText(constants, event, "Module 6 outbox event catalog");
  }
}

/** Confirms Pass 2 Zod contracts reuse shared API primitives and match database precision/privacy rules. */
function verifyProductContracts() {
  const schema = readProjectFile(
    "marketplace-backend/src/modules/products/products.schema.ts",
  );

  for (const contract of [
    "productPriceSchema",
    "productWeightSchema",
    "productAttributeNumberSchema",
    "publicProductListQuerySchema",
    "sellerProductListQuerySchema",
    "createProductBodySchema",
    "updateProductBodySchema",
    "createProductVariantBodySchema",
    "updateProductVariantBodySchema",
    "linkProductMediaBodySchema",
    "emptyProductCommandBodySchema",
    "productResponseSchema",
    "publicProductResponseSchema",
    "productVariantResponseSchema",
    "publicProductVariantResponseSchema",
    "productMediaResponseSchema",
    "publicProductMediaResponseSchema",
    "productPriceHistoryResponseSchema",
    "productDetailResponseSchema",
    "publicProductDetailResponseSchema",
    "publicProductListDataSchema",
    "sellerProductListDataSchema",
  ]) {
    requireText(schema, `export const ${contract}`, "Module 6 Zod contracts");
  }

  requireText(
    schema,
    'paginationQuerySchema } from "../../common/schemas/pagination.schema.js"',
    "Shared pagination contract",
  );
  requireText(schema, "boundedDecimalString(18, 2, true)", "NUMERIC(18,2) Product price contract");
  requireText(schema, "boundedDecimalString(12, 3, true)", "NUMERIC(12,3) Product weight contract");
  requireText(schema, "boundedDecimalString(24, 6)", "NUMERIC(24,6) Product attribute contract");
  requireText(
    schema,
    "Exactly one attribute value representation is required.",
    "Attribute boundary validation",
  );
  requireText(
    schema,
    "Each attribute may be supplied only once.",
    "Attribute duplicate validation",
  );
  requireText(
    schema,
    "MIME/media type is derived from Module 21 file metadata",
    "Server-derived Product media type contract",
  );
  requireText(
    schema,
    "pagination metadata belongs in the standard envelope's meta field",
    "Standard Product pagination response contract",
  );
  requireText(
    schema,
    "sellerId: true",
    "Public Product response privacy contract",
  );
  requireText(
    schema,
    "publicationStatus: true",
    "Public Product response lifecycle privacy contract",
  );
  forbidText(schema, "function pageNumberSchema", "Module 6 duplicate page-number helper");
  forbidText(schema, "function pageSizeSchema", "Module 6 duplicate page-size helper");
  forbidText(schema, "productListResponseSchema", "Embedded Product pagination response");

  const createBlock = schema.slice(
    schema.indexOf("export const createProductBodySchema"),
    schema.indexOf("export const updateProductBodySchema"),
  );
  for (const forbidden of ["sellerId:", "createdBy:", "publicationStatus:", "publishedAt:"]) {
    forbidText(createBlock, forbidden, "Create Product request contract");
  }

  const updateBlock = schema.slice(
    schema.indexOf("export const updateProductBodySchema"),
    schema.indexOf("export const createProductVariantBodySchema"),
  );
  for (const forbidden of ["sellerId:", "storeId:", "publicationStatus:", "publishedAt:"]) {
    forbidText(updateBlock, forbidden, "Update Product request contract");
  }

  const mediaBlock = schema.slice(
    schema.indexOf("export const linkProductMediaBodySchema"),
    schema.indexOf("export const emptyProductCommandBodySchema"),
  );
  forbidText(mediaBlock, "mediaType:", "Product media request contract");
}

/** Confirms Product permissions are composed into existing platform roles without changing Module 2 ownership. */
function verifyRbacComposition() {
  const seed = readProjectFile(
    "marketplace-backend/src/database/seeds/platform-rbac.seed.ts",
  );
  requireText(seed, "PRODUCT_PERMISSION_CATALOG", "Platform permission composition");
  requireText(seed, "PRODUCT_PERMISSION.SELLER_CREATE", "Seller Product permission grants");
  requireText(seed, "PRODUCT_PERMISSION.SELLER_PUBLISH", "Seller Product permission grants");
  requireText(seed, "PRODUCT_PERMISSION.PUBLIC_READ", "Public Product read grant");
}

/** Confirms every named Product repository helper/method has a nearby purpose comment. */
function verifyRepositoryFunctionComments(repository) {
  const lines = repository.split(/\r?\n/);
  const functionLine = /^(?:function\s+\w+|\s{2}(?:async\s+)?\w+\s*\()/;

  for (let index = 0; index < lines.length; index += 1) {
    if (!functionLine.test(lines[index])) continue;

    const nearby = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!nearby.includes("/**")) {
      throw new Error(`Product repository function is missing a purpose comment near line ${index + 1}.`);
    }
  }
}

/** Confirms Pass 3 exposes only scoped persistence operations needed by the upcoming Product service. */
function verifyRepositoryPass() {
  const repository = readProjectFile(
    "marketplace-backend/src/modules/products/products.repository.ts",
  );

  requireText(repository, "export class ProductsRepository", "Module 6 repository boundary");
  requireText(repository, "findProductByIdInSellerScope(", "Seller Product detail repository read");
  requireText(repository, "findProductByIdInSellerScopeForUpdate(", "Seller Product locking read");
  requireText(repository, "findProductByIdForAdminUpdate(", "Admin Product locking read");
  requireText(repository, "findProductIdBySlug(", "Global Product slug conflict read");
  forbidText(
    repository,
    "findProductIdBySellerStoreSlug(",
    "Obsolete seller/store-scoped Product slug lookup",
  );

  requireText(repository, ".innerJoin(stores, eq(stores.id, products.storeId))", "Public store visibility query");
  requireText(repository, ".innerJoin(sellers, eq(sellers.id, products.sellerId))", "Public seller visibility query");
  requireText(repository, "eq(stores.status, STORE_STATUS.ACTIVE)", "Public store lifecycle filter");
  requireText(repository, "eq(sellers.status, SELLER_STATUS.ACTIVE)", "Public seller lifecycle filter");
  requireText(
    repository,
    "eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED)",
    "Public seller approval filter",
  );

  const variantAttributeReplace = repository.slice(
    repository.indexOf("async replaceVariantAttributeValues("),
    repository.indexOf("async listMediaByProductId("),
  );
  requireText(
    variantAttributeReplace,
    "eq(productAttributeValues.productId, productId)",
    "Variant attribute replacement Product scope",
  );
  requireText(
    variantAttributeReplace,
    "eq(productAttributeValues.variantId, variantId)",
    "Variant attribute replacement Variant scope",
  );

  requireText(repository, "insert(productPriceHistory)", "Append-only price history persistence");
  forbidText(repository, "update(productPriceHistory)", "Append-only price history repository");
  forbidText(repository, "delete(productPriceHistory)", "Append-only price history repository");

  for (const forbidden of [
    "request-context",
    "common/policies",
    "common/audit",
    "common/outbox",
    "AppError",
    "PRODUCT_ERROR_CODE",
    "assertSellerPermission",
    "assertProductTaxonomyIsPublishable",
    "assertFileUsableForPurpose",
  ]) {
    forbidText(repository, forbidden, "Persistence-only Module 6 repository");
  }

  for (const forbiddenMethod of [
    "deleteProduct(",
    "deleteVariant(",
    "approveProduct(",
    "publishProduct(",
    "unpublishProduct(",
  ]) {
    forbidText(repository, forbiddenMethod, "Module 6 repository business-command surface");
  }

  verifyRepositoryFunctionComments(repository);
}

/** Confirms every named Product service/helper has a nearby purpose comment. */
function verifyServiceFunctionComments(service) {
  const lines = service.split(/\r?\n/);
  const functionLine = /^(?:function\s+\w+|\s{2}(?:private\s+)?(?:async\s+)?\w+\s*\()/;

  for (let index = 0; index < lines.length; index += 1) {
    if (!functionLine.test(lines[index])) continue;

    const nearby = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!nearby.includes("/**")) {
      throw new Error(`Product service function is missing a purpose comment near line ${index + 1}.`);
    }
  }
}

/** Confirms Pass 4 owns Product business logic in the service and keeps upstream modules behind service boundaries. */
function verifyServicePass() {
  const service = readProjectFile(
    "marketplace-backend/src/modules/products/products.service.ts",
  );
  const moduleIndex = readProjectFile(
    "marketplace-backend/src/modules/products/index.ts",
  );
  const catalogService = readProjectFile(
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.service.ts",
  );
  const sellersService = readProjectFile(
    "marketplace-backend/src/modules/sellers/sellers.service.ts",
  );
  const documentsService = readProjectFile(
    "marketplace-backend/src/modules/documents-audit/documents-audit.service.ts",
  );

  for (const method of [
    "listPublicProducts(",
    "getPublicProduct(",
    "listSellerProducts(",
    "getSellerProduct(",
    "createProduct(",
    "updateProduct(",
    "addVariant(",
    "updateVariant(",
    "linkMedia(",
    "publishProduct(",
    "unpublishProduct(",
    "approveProduct(",
  ]) {
    requireText(service, method, "Module 6 Product service surface");
  }

  for (const required of [
    "withTransaction",
    "AuditService.using(tx).record",
    "OutboxService.using(tx).enqueue",
    "PRODUCT_PERMISSION.SELLER_READ",
    "PRODUCT_PERMISSION.SELLER_CREATE",
    "PRODUCT_PERMISSION.SELLER_UPDATE",
    "PRODUCT_PERMISSION.SELLER_PUBLISH",
    "PRODUCT_PERMISSION.ADMIN_REVIEW",
    "assertProductTaxonomyValuesAreValid",
    "assertProductTaxonomyPublicationIsValid",
    "getUsableFileForPurpose",
    "DOCUMENT_PURPOSE.PRODUCT_MEDIA",
    "isSupportedCurrency",
    "assertStoreCommerceEligible",
    "createPriceHistory",
    "sameDecimal(existing.price, nextPrice)",
    "PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL",
    "PRODUCT_PUBLICATION_STATUS.PUBLISHED",
    "PRODUCT_PUBLICATION_STATUS.UNPUBLISHED",
  ]) {
    requireText(service, required, "Module 6 service invariant");
  }

  for (const forbidden of [
    "catalog-taxonomy.repository",
    "sellers.repository",
    "documents-audit.repository",
    "administration.repository",
    'from "express"',
  ]) {
    forbidText(service, forbidden, "Module 6 service boundary");
  }

  requireText(
    catalogService,
    "assertProductTaxonomyValuesAreValid(",
    "Module 5 Product draft taxonomy boundary",
  );
  requireText(
    catalogService,
    "assertProductTaxonomyPublicationIsValid(",
    "Module 5 Product publication taxonomy boundary",
  );
  requireText(
    sellersService,
    "resolveActiveStoreForSellerCommand(",
    "Module 4 Product seller/store boundary",
  );
  requireText(
    sellersService,
    "assertStoreCommerceEligible(",
    "Module 4 Product publication seller/store boundary",
  );
  requireText(
    documentsService,
    "getUsableFileForPurpose(",
    "Module 21 Product media metadata boundary",
  );
  requireText(moduleIndex, 'export * from "./products.service.js";', "Module 6 module boundary");
  requireText(
    service,
    'if (code === "23503") throw this.invalidProductAttribute();',
    "Stable Product taxonomy foreign-key error mapping",
  );

  verifyServiceFunctionComments(service);
}


/** Confirms every named Product controller method has a nearby purpose comment. */
function verifyControllerFunctionComments(controller) {
  const lines = controller.split(/\r?\n/);
  const functionLine = /^\s{2}\w+\s*=\s*async\s*\(/;

  for (let index = 0; index < lines.length; index += 1) {
    if (!functionLine.test(lines[index])) continue;

    const nearby = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!nearby.includes("/**")) {
      throw new Error(`Product controller function is missing a purpose comment near line ${index + 1}.`);
    }
  }
}

/** Confirms Pass 5 exposes the complete Product HTTP/RBAC/OpenAPI surface without bypassing service boundaries. */
function verifyHttpPass() {
  const controller = readProjectFile(
    "marketplace-backend/src/modules/products/products.controller.ts",
  );
  const routes = readProjectFile(
    "marketplace-backend/src/modules/products/products.routes.ts",
  );
  const moduleIndex = readProjectFile(
    "marketplace-backend/src/modules/products/index.ts",
  );
  const app = readProjectFile("marketplace-backend/src/app.ts");
  const openApi = readProjectFile(
    "marketplace-backend/src/http/openapi/openapi.document.ts",
  );

  for (const method of [
    "listPublicProducts = async",
    "getPublicProduct = async",
    "listSellerProducts = async",
    "getSellerProduct = async",
    "createProduct = async",
    "updateProduct = async",
    "addVariant = async",
    "updateVariant = async",
    "linkMedia = async",
    "publishProduct = async",
    "unpublishProduct = async",
    "approveProduct = async",
  ]) {
    requireText(controller, method, "Module 6 Product controller surface");
  }

  for (const forbidden of [
    "products.repository",
    "database/schema",
    "drizzle-orm",
    "withTransaction",
    "AuditService",
    "OutboxService",
  ]) {
    forbidText(controller, forbidden, "Thin Module 6 Product controller");
  }
  verifyControllerFunctionComments(controller);

  for (const permission of [
    "PRODUCT_PERMISSION.SELLER_READ",
    "PRODUCT_PERMISSION.SELLER_CREATE",
    "PRODUCT_PERMISSION.SELLER_UPDATE",
    "PRODUCT_PERMISSION.SELLER_PUBLISH",
    "PRODUCT_PERMISSION.ADMIN_REVIEW",
  ]) {
    requireText(routes, permission, "Module 6 route-level RBAC");
  }

  for (const route of [
    'router.get("/", controller.listPublicProducts)',
    'router.get("/:slug", controller.getPublicProduct)',
    'controller.listSellerProducts',
    'controller.getSellerProduct',
    'controller.createProduct',
    'controller.updateProduct',
    'controller.addVariant',
    'controller.updateVariant',
    'controller.linkMedia',
    'controller.publishProduct',
    'controller.unpublishProduct',
    'controller.listAdminProducts',
    'controller.getAdminProduct',
    'controller.approveProduct',
    'controller.rejectProduct',
  ]) {
    requireText(routes, route, "Module 6 route table");
  }

  for (const openApiPath of [
    '"/api/v1/products"',
    '"/api/v1/products/{slug}"',
    '"/api/v1/seller/products"',
    '"/api/v1/seller/products/{id}"',
    '"/api/v1/seller/products/{id}/variants"',
    '"/api/v1/seller/products/{id}/variants/{variantId}"',
    '"/api/v1/seller/products/{id}/media"',
    '"/api/v1/seller/products/{id}/publish"',
    '"/api/v1/seller/products/{id}/unpublish"',
    '"/api/v1/admin/products"',
    '"/api/v1/admin/products/{id}"',
    '"/api/v1/admin/products/{id}/approve"',
    '"/api/v1/admin/products/{id}/reject"',
  ]) {
    requireText(routes, openApiPath, "Module 6 OpenAPI path");
  }
  requireText(
    routes,
    "Explicit read required by the seller edit/variant/media/history workflow.",
    "Seller Product-detail audit remediation documentation",
  );
  requireText(routes, "paginatedSuccess(", "Standard Product pagination OpenAPI envelope");
  requireText(routes, "success(openApiSchema(productDetailResponseSchema))", "Product detail OpenAPI response");

  requireText(moduleIndex, 'export * from "./products.controller.js";', "Module 6 controller export");
  requireText(moduleIndex, 'export * from "./products.routes.js";', "Module 6 routes export");

  for (const mount of [
    '`${API_V1_PREFIX}/products`, publicProductsRouter',
    '`${API_V1_PREFIX}/seller/products`, sellerProductsRouter',
    '`${API_V1_PREFIX}/admin/products`, adminProductsRouter',
  ]) {
    requireText(app, mount, "Module 6 Express registration");
  }
  requireText(app, "new ProductsService({", "Module 6 runtime service composition");
  requireText(app, "documents: documentsService", "Module 21 Product media composition");
  requireText(app, "taxonomy: catalogTaxonomyService", "Module 5 Product taxonomy composition");
  requireText(app, "sellers: sellersService", "Module 4 Product seller composition");
  requireText(app, "currencies: administrationService", "Module 2 Product currency composition");
  requireText(
    app,
    "moderationRequired: appConfig.productModerationRequired",
    "Module 6 Product moderation runtime composition",
  );

  const environment = readProjectFile("marketplace-backend/src/config/env.ts");
  const appConfig = readProjectFile("marketplace-backend/src/config/app.config.ts");
  const envExample = readProjectFile("marketplace-backend/.env.example");
  requireText(environment, "PRODUCT_MODERATION_REQUIRED", "Typed Product moderation environment");
  requireText(appConfig, "productModerationRequired", "Product moderation application config");
  requireText(envExample, "PRODUCT_MODERATION_REQUIRED=true", "Product moderation environment example");

  requireText(openApi, "productsOpenApiPaths", "Global OpenAPI Product registration");
  requireText(openApi, '{ name: "Products"', "Global OpenAPI Product tag");
}


/** Confirms Pass 6 proves Product repository, service, HTTP, isolation, history, and regression behavior. */
function verifyBackendTestsPass() {
  const packageJson = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const runner = readProjectFile("marketplace-backend/scripts/run-module6-tests.mjs");
  const schemasTest = readProjectFile("marketplace-backend/tests/module6/module6.schemas.test.ts");
  const serviceTest = readProjectFile("marketplace-backend/tests/module6/module6.service.test.ts");
  const repositoryTest = readProjectFile("marketplace-backend/tests/module6/module6.repository.test.ts");
  const integrationTest = readProjectFile("marketplace-backend/tests/module6/module6.integration.test.ts");
  const helpers = readProjectFile("marketplace-backend/tests/module6/module6.test-helpers.ts");
  const backendCi = readProjectFile("marketplace-backend/.github/workflows/ci.yml");

  for (const scriptName of ["test:module6:migrations", "test:module6:specs", "test:module6"]) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`Backend Module 6 test script is missing: ${scriptName}`);
    }
  }

  for (const required of [
    "test:module6:migrations",
    "test:module6:specs",
    "test:foundation:specs",
    "test:module2:specs",
    "test:module21:specs",
    "test:module3:specs",
    "test:module4:specs",
    "test:module5:specs",
    "typecheck",
    "lint",
    "build",
  ]) {
    requireText(runner, required, "Module 6 backend runner");
  }

  for (const required of [
    "resetModule6Tables",
    "createProductSellerFixture",
    "createProductViaHttp",
    "createVariantViaHttp",
    "createConfirmedProductMediaFile",
    "countProductOutboxEvents",
    "countProductAuditActions",
  ]) {
    requireText(helpers, required, "Module 6 test helpers");
  }

  for (const required of [
    "PostgreSQL decimal precision",
    "server-owned Product fields",
    "Exactly one attribute value representation",
    "complete Module 6 HTTP contract",
  ]) {
    requireText(schemasTest, required, "Module 6 schema/OpenAPI tests");
  }

  for (const required of [
    "seller-scoped permission is absent",
    "outside the server-derived store scope",
    "unsupported variant currency",
    "non-image/video Product media",
    "platform review permission",
  ]) {
    requireText(serviceTest, required, "Module 6 service tests");
  }

  for (const required of [
    "global slug conflicts",
    "exact seller/store scope",
    "SKU conflicts only inside",
    "without deleting another variant",
    "price history append-only",
  ]) {
    requireText(repositoryTest, required, "Module 6 repository tests");
  }

  for (const required of [
    "seller-to-seller isolation",
    "globally unique Product slugs",
    "concurrent requests",
    "rolls the Product transaction back",
    "price history only for a real price change",
    "public visibility tied to lifecycle",
    "derives media type",
    "explicit admin approval command",
    "no generic delete routes",
  ]) {
    requireText(integrationTest, required, "Module 6 integration tests");
  }

  requireText(backendCi, "Verify Module 6 clean and upgrade migrations", "Backend CI Module 6 migration gate");
  requireText(backendCi, "Run Module 6 tests", "Backend CI Module 6 test gate");
}


/** Confirms Pass 7 implements the independent React Product feature without changing the required frontend stack. */
function verifyFrontendPass() {
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const router = readProjectFile("marketplace-frontend/src/app/router/router.tsx");
  const routes = readProjectFile("marketplace-frontend/src/app/routes/products.routes.tsx");
  const api = readProjectFile("marketplace-frontend/src/features/products/api/products.api.ts");
  const hooks = readProjectFile("marketplace-frontend/src/features/products/hooks/use-products.ts");
  const productForm = readProjectFile("marketplace-frontend/src/features/products/forms/product-form.tsx");
  const variantForm = readProjectFile("marketplace-frontend/src/features/products/forms/product-variant-form.tsx");
  const mediaForm = readProjectFile("marketplace-frontend/src/features/products/forms/product-media-form.tsx");
  const sellerList = readProjectFile("marketplace-frontend/src/features/products/pages/seller-products.page.tsx");
  const sellerCreate = readProjectFile("marketplace-frontend/src/features/products/pages/seller-product-create.page.tsx");
  const sellerEdit = readProjectFile("marketplace-frontend/src/features/products/pages/seller-product-edit.page.tsx");
  const adminList = readProjectFile("marketplace-frontend/src/features/products/pages/admin-products.page.tsx");
  const adminReview = readProjectFile("marketplace-frontend/src/features/products/pages/admin-product-review.page.tsx");
  const publicList = readProjectFile("marketplace-frontend/src/features/products/pages/public-products.page.tsx");
  const publicDetail = readProjectFile("marketplace-frontend/src/features/products/pages/public-product-detail.page.tsx");
  const productTests = readProjectFile("marketplace-frontend/tests/module6-products.test.tsx");
  const sellerLayout = readProjectFile("marketplace-frontend/src/features/sellers/components/seller-layout.tsx");
  const authNavigation = readProjectFile("marketplace-frontend/src/features/auth/auth.navigation.ts");
  const frontendCi = readProjectFile("marketplace-frontend/.github/workflows/ci.yml");

  if (!frontendPackage.scripts?.["test:module6"]) {
    throw new Error("Frontend Module 6 test script is missing: test:module6");
  }

  for (const routePath of [
    'path: "/products"',
    'path: "/products/$slug"',
    'path: "/seller/products"',
    'path: "/seller/products/new"',
    'path: "/seller/products/$productId"',
    'path: "/admin/products"',
    'path: "/admin/products/$productId"',
  ]) {
    requireText(routes, routePath, "Module 6 frontend route table");
  }
  for (const registration of [
    "publicProductsRoute",
    "publicProductDetailRoute",
    "sellerProductsRoute",
    "sellerProductCreateRoute",
    "sellerProductEditRoute",
    "adminProductsRoute",
    "adminProductReviewRoute",
  ]) {
    requireText(router, registration, "Module 6 router registration");
  }

  for (const endpoint of [
    'apiClient.get("/products"',
    'apiClient.get(`/products/${encodeURIComponent(slug)}`)',
    'apiClient.get("/seller/products"',
    'apiClient.get(`/seller/products/${id}`)',
    'apiClient.post("/seller/products", input)',
    'apiClient.patch(`/seller/products/${id}`, input)',
    'apiClient.post(`/seller/products/${productId}/variants`, input)',
    'apiClient.patch(`/seller/products/${productId}/variants/${variantId}`, input)',
    'apiClient.post(`/seller/products/${productId}/media`, input)',
    'apiClient.post(`/seller/products/${id}/publish`, {})',
    'apiClient.post(`/seller/products/${id}/unpublish`, {})',
    'apiClient.get("/admin/products"',
    'apiClient.get(`/admin/products/${id}`)',
    'apiClient.post(`/admin/products/${id}/approve`, {})',
    'apiClient.post(`/admin/products/${id}/reject`, input)',
  ]) {
    requireText(api, endpoint, "Module 6 frontend API client");
  }
  requireText(api, "Product pagination metadata is missing.", "Standard Product pagination handling");

  for (const required of [
    "usePublicProductsQuery",
    "usePublicProductQuery",
    "useSellerProductsQuery",
    "useSellerProductQuery",
    "useCreateProductMutation",
    "useUpdateProductMutation",
    "useAddProductVariantMutation",
    "useUpdateProductVariantMutation",
    "useUploadProductMediaMutation",
    "usePublishProductMutation",
    "useUnpublishProductMutation",
    "useAdminProductsQuery",
    "useAdminProductQuery",
    "useApproveProductMutation",
    "useRejectProductMutation",
  ]) {
    requireText(hooks, required, "Module 6 TanStack Query hooks");
  }
  requireText(hooks, "DOCUMENT_PURPOSE.PRODUCT_MEDIA", "Module 21 Product media upload integration");
  requireText(hooks, "documentsAuditApi.signUpload", "Signed Product media upload");
  requireText(hooks, "documentsAuditApi.confirmUpload", "Confirmed Product media upload");

  for (const required of [
    "useForm({",
    "ProductAttributeFields",
    "variantAxis={false}",
    "Product store",
    "Product category",
    "Product brand",
  ]) {
    requireText(productForm, required, "Product create/edit form");
  }
  for (const required of ["useForm({", "variantAxis", "Variant SKU", "Variant price", "Variant currency"]) {
    requireText(variantForm, required, "Product variant form");
  }
  for (const required of ["useForm({", "Product media file", 'accept="image/png,image/jpeg,image/webp"', "Upload and link media"]) {
    requireText(mediaForm, required, "Product media form");
  }

  for (const required of ["ProductPagination", "ProductStatusBadge", "Create Product", "No Products match these filters."]) {
    requireText(sellerList, required, "Seller Product list UI");
  }
  requireText(sellerCreate, "Create draft Product", "Seller Product create workflow");
  for (const required of [
    "Variants / SKUs",
    "Media manager",
    "Pricing history",
    "Publication",
    "Submit for review",
    "Unpublish",
    "Inventory quantities are intentionally not edited here",
  ]) {
    requireText(sellerEdit, required, "Seller Product edit workflow");
  }
  for (const required of ["Product approvals", "PENDING_APPROVAL", "Review"]) {
    requireText(adminList, required, "Admin Product approval queue");
  }
  for (const required of ["Approve and publish", "Reject and return to seller", "Rejection reason"]) {
    requireText(adminReview, required, "Admin Product review workflow");
  }
  requireText(publicList, "No published Products match these filters.", "Public Product empty state");
  requireText(publicDetail, "The current Product API exposes safe media metadata/file IDs", "Public media contract honesty");

  requireText(sellerLayout, 'to="/seller/products"', "Seller Product navigation");
  requireText(authNavigation, 'return "/seller/products";', "Seller Product post-login navigation");

  for (const proof of [
    "public Product catalog",
    "normalized draft Product",
    "adds a variant and publishes",
    "signed Module 21 workflow",
  ]) {
    requireText(productTests, proof, "Module 6 frontend tests");
  }
  requireText(frontendCi, "Run Module 6 Product frontend tests", "Frontend CI Module 6 test gate");

  for (const forbidden of ["redux", "zustand", "react-router-dom", "@prisma/client"]) {
    forbidText(JSON.stringify(frontendPackage), forbidden, "Module 6 frontend stack");
  }
}



/** Confirms Pass 8 adds the browser workflow and cumulative cross-project release gate without adding temporary evidence files. */
function verifyReleasePass() {
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const releaseGate = readProjectFile("scripts/verify-module6.mjs");
  const e2e = readProjectFile("marketplace-frontend/e2e/module6.spec.ts");
  const releaseData = readProjectFile(
    "marketplace-backend/scripts/verify-module6-release-data.mjs",
  );

  if (!frontendPackage.scripts?.["test:e2e:module6"]) {
    throw new Error("Frontend Module 6 Playwright script is missing: test:e2e:module6");
  }
  if (!backendPackage.scripts?.["test:module6:release-data"]) {
    throw new Error("Backend Module 6 post-E2E integrity script is missing: test:module6:release-data");
  }

  for (const required of [
    "scripts/verify-module6-static.mjs",
    "test:module6:migrations",
    "test:module6:specs",
    "e2e/module6.spec.ts",
    "test:module6:release-data",
    "product_media",
    'PRODUCT_MODERATION_REQUIRED: "false"',
    "verifyLiveImplementedOpenApi",
    '"/api/v1/seller/products/{id}/variants/{variantId}"',
    '"/api/v1/admin/products/{id}/approve"',
    "marketplace-backend-module6-release",
    "marketplace-frontend-module6-release",
  ]) {
    requireText(releaseGate, required, "Module 6 cumulative release gate");
  }

  for (const required of [
    "creates, publishes, changes price history, uploads media, and unpublishes a Product",
    "proves seller-to-seller Product isolation for private reads and writes",
    'getByLabel("Product media file")',
    'getByRole("button", { name: "Publish / submit" })',
    'getByRole("button", { name: "Edit variant" })',
    'getByRole("button", { name: "Unpublish" })',
    "privateRead.status()).toBe(404)",
    "forbiddenWrite.status()).toBe(404)",
  ]) {
    requireText(e2e, required, "Module 6 Playwright business workflow");
  }

  for (const required of [
    "Product seller/store ownership",
    "Global Product slug uniqueness",
    "Seller/store SKU uniqueness",
    "Product attribute option ownership",
    "Published Product active-variant invariant",
    "Product media confirmed-file invariant",
    "product_price_history_append_only_trigger",
    "product_variants_seller_store_sku_trigger",
  ]) {
    requireText(releaseData, required, "Module 6 post-E2E database integrity gate");
  }
}

/** Runs the cumulative dependency-free Module 6 verification gate. */
function main() {
  verifyTopologyAndStack();
  verifyDatabasePass();
  verifyProductConstants();
  verifyProductContracts();
  verifyRbacComposition();
  verifyRepositoryPass();
  verifyServicePass();
  verifyHttpPass();
  verifyBackendTestsPass();
  verifyFrontendPass();
  verifyReleasePass();
  console.log("Module 6 static verification passed.");
}

main();

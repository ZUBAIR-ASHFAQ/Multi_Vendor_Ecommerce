import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../README.md", import.meta.url)));

/** Throws a focused verification error when one required static invariant is false. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Returns whether one path exists in the delivery. */
async function pathExists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

/** Reads one UTF-8 source file from the delivery root. */
async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

/** Requires one source file to contain every listed verification marker. */
async function requireText(relativePath, markers) {
  const source = await read(relativePath);
  for (const marker of markers) {
    assertCondition(
      source.includes(marker),
      `${relativePath} is missing Module 5 marker: ${marker}`,
    );
  }
}

/** Verifies the Pass 1 database foundation still exists unchanged for later Module 5 passes. */
async function verifyDatabaseFoundation() {
  for (const file of [
    "marketplace-backend/src/database/schema/catalog.ts",
    "marketplace-backend/src/database/relations.ts",
    "marketplace-backend/drizzle/0008_catalog_taxonomy.sql",
    "marketplace-backend/scripts/verify-module5-migrations.mjs",
  ]) {
    assertCondition(await pathExists(file), `${file} is missing.`);
  }

  await requireText("marketplace-backend/src/database/schema/catalog.ts", [
    "export const categories = pgTable(",
    "export const brands = pgTable(",
    "export const attributes = pgTable(",
    "export const attributeValues = pgTable(",
    "export const categoryAttributes = pgTable(",
    'uniqueIndex("categories_slug_uq")',
    'uniqueIndex("brands_slug_uq")',
    'uniqueIndex("attributes_code_uq")',
    'check("categories_sort_order_check"',
    'check("attribute_values_sort_order_check"',
    'check("category_attributes_sort_order_check"',
  ]);

  await requireText("marketplace-backend/src/database/relations.ts", [
    "export const categoriesRelations = relations(",
    "export const attributesRelations = relations(",
    "export const attributeValuesRelations = relations(",
    "export const categoryAttributesRelations = relations(",
  ]);

  await requireText("marketplace-backend/drizzle/0008_catalog_taxonomy.sql", [
    'CREATE TABLE "categories"',
    'CREATE TABLE "brands"',
    'CREATE TABLE "attributes"',
    'CREATE TABLE "attribute_values"',
    'CREATE TABLE "category_attributes"',
    'CREATE UNIQUE INDEX "categories_slug_uq"',
    'CREATE UNIQUE INDEX "brands_slug_uq"',
    'CREATE UNIQUE INDEX "attributes_code_uq"',
    'ON DELETE RESTRICT',
  ]);

  await requireText("marketplace-backend/scripts/verify-module5-migrations.mjs", [
    "verifyColumnDefinitions",
    "verifyForeignKeyDeleteRules",
    '"categories_pkey"',
    '"brands_pkey"',
    '"attributes_pkey"',
    '"attribute_values_pkey"',
    '`${constraintName} must use ON DELETE RESTRICT.`',
    "verifyModule4UpgradePath",
  ]);
}

/** Verifies stable Module 5 permissions, errors, events, and database-aligned limits. */
async function verifyCatalogConstants() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.constants.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    'READ: "catalog.read"',
    'MANAGE_CATEGORIES: "catalog.manage_categories"',
    'MANAGE_BRANDS: "catalog.manage_brands"',
    'MANAGE_ATTRIBUTES: "catalog.manage_attributes"',
    'CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND"',
    'CATEGORY_CYCLE: "CATEGORY_CYCLE"',
    'DUPLICATE_CATALOG_CODE: "DUPLICATE_CATALOG_CODE"',
    'ATTRIBUTE_INVALID_FOR_CATEGORY: "ATTRIBUTE_INVALID_FOR_CATEGORY"',
    'CATEGORY_CREATED: "category.created"',
    'CATEGORY_UPDATED: "category.updated"',
    'BRAND_UPDATED: "brand.updated"',
    'ATTRIBUTE_UPDATED: "attribute.updated"',
    'CATEGORY_ATTRIBUTES_CHANGED: "category.attributes_changed"',
    "CATEGORY_SLUG_MAX_LENGTH: 160",
    "ATTRIBUTE_VALUE_MAX_LENGTH: 240",
    'CATALOG_VARIANT_AXIS_DATA_TYPE = "option"',
  ]);
}

/** Verifies Zod request/response contracts stay aligned with the approved Module 5 business surface. */
async function verifyCatalogContracts() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.schema.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    "createCategoryBodySchema",
    "categoryIdParamsSchema",
    "updateCategoryBodySchema",
    "createBrandBodySchema",
    "createAttributeBodySchema",
    "categoryAttributeMappingInputSchema",
    "replaceCategoryAttributesBodySchema",
    "categoryTreeNodeResponseSchema",
    "brandResponseSchema",
    "attributeValueResponseSchema",
    "attributeResponseSchema",
    "categoryAttributeMappingResponseSchema",
    "At least one editable category field is required",
    ".meta({ minProperties: 1 })",
    "Each attribute may appear only once in a category mapping",
    "values: z.array(createAttributeValueSchema).optional()",
    "Attribute values must be unique.",
    "semantic compatibility is deliberately enforced by the service rather than guessed here",
  ]);

  const source = await read(file);
  assertCondition(
    !source.includes("CATALOG_DATA_TYPE_VALUES") &&
      !source.includes("z.enum(CATALOG_DATA_TYPE"),
    "Module 5 must not invent a data-type allow-list that the controlling guide does not define.",
  );
}

/** Verifies Module 5 RBAC is composed downstream without making earlier modules import Module 5. */
async function verifyCatalogRbacComposition() {
  const seedFile = "marketplace-backend/src/database/seeds/platform-rbac.seed.ts";
  await requireText(seedFile, [
    "CATALOG_PERMISSION",
    "CATALOG_PERMISSION_CATALOG",
    "...CATALOG_PERMISSION_CATALOG",
    "SELLER_OWNER_PLATFORM_PERMISSION_CODES",
    "SELLER_MANAGER_PLATFORM_PERMISSION_CODES",
    "CATALOG_PERMISSION.READ",
  ]);

  for (const upstreamFile of [
    "marketplace-backend/src/modules/administration/administration.constants.ts",
    "marketplace-backend/src/modules/customers/customers.constants.ts",
    "marketplace-backend/src/modules/sellers/sellers.constants.ts",
  ]) {
    const source = await read(upstreamFile);
    assertCondition(
      !source.includes("catalog-taxonomy"),
      `${upstreamFile} must not import downstream Module 5 contracts.`,
    );
  }
}

/** Verifies the Pass 3 repository contains only required scoped persistence helpers. */
async function verifyCatalogRepository() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.repository.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    "export class CatalogTaxonomyRepository",
    "constructor(private readonly executor: DatabaseExecutor = db)",
    "async listCategories(",
    "async listCategoriesForUpdate(",
    "async findCategoryById(",
    "async findCategoryByIdForUpdate(",
    "async findCategoryIdBySlug(",
    "async createCategory(",
    "async updateCategory(",
    "async listBrands(",
    "async findBrandById(",
    "async findBrandIdBySlug(",
    "async createBrand(",
    "async listAttributes(",
    "async listAttributesByIds(",
    "async findAttributeIdByCode(",
    "async createAttribute(",
    "async createAttributeValues(",
    "async listAttributeValuesByAttributeIds(",
    "async listCategoryAttributes(",
    "async replaceCategoryAttributes(",
    '.for("update")',
    ".where(eq(categories.id, categoryId))",
    ".where(inArray(attributes.id, attributeIds))",
    ".delete(categoryAttributes)",
    "The service must call this method on a transaction-bound repository",
  ]);

  const source = await read(file);

  const expectedRepositoryMethods = [
    "listCategories",
    "listCategoriesForUpdate",
    "findCategoryById",
    "findCategoryByIdForUpdate",
    "findCategoryIdBySlug",
    "createCategory",
    "updateCategory",
    "listBrands",
    "findBrandById",
    "findBrandIdBySlug",
    "createBrand",
    "listAttributes",
    "listAttributesByIds",
    "findAttributeIdByCode",
    "createAttribute",
    "createAttributeValues",
    "listAttributeValuesByAttributeIds",
    "listCategoryAttributes",
    "replaceCategoryAttributes",
  ];

  /** Extracts public async repository methods so dead persistence helpers cannot accumulate silently. */
  const actualRepositoryMethods = Array.from(
    source.matchAll(/\n\s*async\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g),
    (match) => match[1],
  ).sort();

  assertCondition(
    JSON.stringify(actualRepositoryMethods) ===
      JSON.stringify([...expectedRepositoryMethods].sort()),
    `Pass 3 repository method surface changed. Expected ${expectedRepositoryMethods.join(", ")}; found ${actualRepositoryMethods.join(", ")}.`,
  );

  const serviceSource = await read(
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.service.ts",
  );
  for (const method of expectedRepositoryMethods) {
    assertCondition(
      serviceSource.includes(`repository.${method}(`) ||
        serviceSource.includes(`this.repository.${method}(`),
      `Pass 3 repository method has no Module 5 service consumer: ${method}`,
    );
  }

  for (const forbidden of [
    "AppError",
    "AuditService",
    "OutboxService",
    "assertPermission",
    "RequestContext",
    "express",
    "withTransaction",
    "deleteCategory(",
    "deleteBrand(",
    "deleteAttribute(",
    "updateBrand(",
    "updateAttribute(",
    "findAttributeById(",
  ]) {
    assertCondition(
      !source.includes(forbidden),
      `Pass 3 repository must not contain business/HTTP/dead CRUD concern: ${forbidden}`,
    );
  }
}

/** Verifies Pass 4 service rules, transaction ownership, audit/outbox behavior, and downstream publication validation. */
async function verifyCatalogService() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.service.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    "export class CatalogTaxonomyService",
    "async listCategories(",
    "async createCategory(",
    "async updateCategory(",
    "async listBrands(",
    "async createBrand(",
    "async listAttributes(",
    "async listCategoryAttributeMappings(",
    "async createAttribute(",
    "async replaceCategoryAttributes(",
    "async assertProductTaxonomyValuesAreValid(",
    "async assertProductTaxonomyPublicationIsValid(",
    "assertPermission(context, CATALOG_PERMISSION.MANAGE_CATEGORIES)",
    "assertPermission(context, CATALOG_PERMISSION.MANAGE_BRANDS)",
    "assertPermission(context, CATALOG_PERMISSION.MANAGE_ATTRIBUTES)",
    "await repository.listCategoriesForUpdate()",
    "this.assertCategoryParentIsValid",
    "this.assertAttributeDefinitionIsValid",
    "this.assertCategoryPathIsActive",
    "this.assertEveryMappedAttributeExists",
    "AuditService.using(tx).record",
    "OutboxService.using(tx).enqueue",
    "CATALOG_OUTBOX_EVENT.CATEGORY_ATTRIBUTES_CHANGED",
    "input.dataType !== CATALOG_VARIANT_AXIS_DATA_TYPE",
    "The selected category or one of its parent categories is not active.",
    "The controlling guide names brand.updated but does not define a separate brand.created event.",
    "The controlling guide names attribute.updated but does not define a separate attribute.created event.",
  ]);

  const source = await read(file);
  for (const forbidden of [
    'from "express"',
    "NextFunction",
    ".delete(categories)",
    ".delete(brands)",
    ".delete(attributes)",
    "variantAxisDataTypePolicy",
  ]) {
    assertCondition(
      !source.includes(forbidden),
      `Pass 4 service must not contain HTTP or destructive taxonomy persistence concern: ${forbidden}`,
    );
  }
}

/** Verifies Pass 5 thin controller methods parse Zod inputs and call only the Module 5 service. */
async function verifyCatalogController() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.controller.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    "export class CatalogTaxonomyController",
    "listCategories = async",
    "listCategoryAttributeMappings = async",
    "createCategory = async",
    "updateCategory = async",
    "listBrands = async",
    "createBrand = async",
    "listAttributes = async",
    "createAttribute = async",
    "replaceCategoryAttributes = async",
    "createCategoryBodySchema.parse(request.body)",
    "categoryIdParamsSchema.parse(request.params)",
    "updateCategoryBodySchema.parse(request.body)",
    "createBrandBodySchema.parse(request.body)",
    "createAttributeBodySchema.parse(request.body)",
    "replaceCategoryAttributesBodySchema.parse(request.body)",
    "getOptionalRequestContext(response)",
    "getRequestContext(response)",
    "successResponse(result, { requestId: getRequestId(response) })",
  ]);

  const source = await read(file);
  for (const forbidden of [
    "CatalogTaxonomyRepository",
    'from "drizzle-orm"',
    "db.",
    "withTransaction",
    "AuditService",
    "OutboxService",
  ]) {
    assertCondition(
      !source.includes(forbidden),
      `Pass 5 controller must stay thin and must not contain persistence/business concern: ${forbidden}`,
    );
  }
}

/** Verifies the audited Module 5 routers, RBAC prechecks, and Zod-derived OpenAPI paths. */
async function verifyCatalogRoutes() {
  const file =
    "marketplace-backend/src/modules/catalog-taxonomy/catalog-taxonomy.routes.ts";
  assertCondition(await pathExists(file), `${file} is missing.`);

  await requireText(file, [
    "export function createCatalogTaxonomyRouter",
    "router.use(optionalAuthenticationMiddleware)",
    'router.get("/categories", controller.listCategories)',
    'router.get("/brands", controller.listBrands)',
    'router.get("/attributes", controller.listAttributes)',
    "export function createAdminCatalogTaxonomyRouter",
    "router.use(authenticationMiddleware)",
    '"/categories",',
    "requirePermission(CATALOG_PERMISSION.MANAGE_CATEGORIES)",
    '"/categories/:id",',
    '"/brands",',
    "requirePermission(CATALOG_PERMISSION.MANAGE_BRANDS)",
    '"/attributes",',
    "requirePermission(CATALOG_PERMISSION.MANAGE_ATTRIBUTES)",
    '"/categories/:id/attributes",',
    "controller.replaceCategoryAttributes",
    "export const catalogTaxonomyOpenApiPaths",
    '"/api/v1/catalog/categories"',
    '"/api/v1/catalog/categories/{id}/attributes"',
    '"/api/v1/admin/catalog/categories"',
    '"/api/v1/admin/catalog/categories/{id}"',
    '"/api/v1/catalog/brands"',
    '"/api/v1/admin/catalog/brands"',
    '"/api/v1/catalog/attributes"',
    '"/api/v1/admin/catalog/attributes"',
    '"/api/v1/admin/catalog/categories/{id}/attributes"',
    "z.toJSONSchema(schema)",
    "categoryIdParamsSchema",
    "createCategoryBodySchema",
    "updateCategoryBodySchema",
    "createBrandBodySchema",
    "createAttributeBodySchema",
    "replaceCategoryAttributesBodySchema",
  ]);

  const source = await read(file);
  const routeRegistrations = source.match(/router\.(?:get|post|patch|put|delete)\(/g) ?? [];
  assertCondition(
    routeRegistrations.length === 9,
    `Module 5 must expose the eight source-defined operations plus one audited mapping-read operation; found ${routeRegistrations.length}.`,
  );
  const openApiPathKeys = source.match(/"\/api\/v1\/(?:catalog|admin\/catalog)[^"]*"\s*:\s*\{/g) ?? [];
  assertCondition(
    openApiPathKeys.length === 9,
    `Module 5 OpenAPI must expose the eight source-defined paths plus one audited mapping-read path; found ${openApiPathKeys.length}.`,
  );

  const forbiddenRoutes = [
    'router.delete(',
    'router.get("/categories/:id",',
    'router.patch("/brands/',
    'router.delete("/brands',
    'router.patch("/attributes/',
    'router.delete("/attributes',
  ];
  for (const forbidden of forbiddenRoutes) {
    assertCondition(
      !source.includes(forbidden),
      `Module 5 must not invent an unapproved generic CRUD route: ${forbidden}`,
    );
  }
}

/** Verifies optional authentication supports public catalog reads without weakening protected routes. */
async function verifyOptionalAuthentication() {
  const file =
    "marketplace-backend/src/common/middleware/authentication.middleware.ts";
  await requireText(file, [
    "function optionalBearerToken(request: Request): string | null",
    "export function getOptionalRequestContext",
    "export const optionalAuthenticationMiddleware",
    "if (!token)",
    "await runtimeAuthService.authenticateAccessToken",
  ]);

  const seedFile = "marketplace-backend/src/database/seeds/platform-rbac.seed.ts";
  await requireText(seedFile, [
    "CUSTOMER_SELF_SERVICE_PERMISSION_CODES",
    "CATALOG_PERMISSION.READ",
    "read-only public catalog access when authenticated",
  ]);
}

/** Verifies Module 5 routers are composed, mounted at the approved bases, and registered in OpenAPI. */
async function verifyCatalogRegistration() {
  await requireText("marketplace-backend/src/app.ts", [
    'from "./modules/catalog-taxonomy/index.js"',
    "new CatalogTaxonomyService()",
    "new CatalogTaxonomyController(",
    "createCatalogTaxonomyRouter(catalogTaxonomyController)",
    "createAdminCatalogTaxonomyRouter(",
    'app.use(`${API_V1_PREFIX}/catalog`, catalogTaxonomyRouter)',
    'app.use(`${API_V1_PREFIX}/admin/catalog`, adminCatalogTaxonomyRouter)',
  ]);

  await requireText("marketplace-backend/src/http/openapi/openapi.document.ts", [
    "catalogTaxonomyOpenApiPaths",
    'name: "Catalog Taxonomy"',
    "...catalogTaxonomyOpenApiPaths",
  ]);

  const indexFile =
    "marketplace-backend/src/modules/catalog-taxonomy/index.ts";
  await requireText(indexFile, [
    'export * from "./catalog-taxonomy.constants.js"',
    'export * from "./catalog-taxonomy.schema.js"',
    'export * from "./catalog-taxonomy.service.js"',
    'export * from "./catalog-taxonomy.controller.js"',
    'export * from "./catalog-taxonomy.routes.js"',
  ]);
  const indexSource = await read(indexFile);
  assertCondition(
    !indexSource.includes("catalog-taxonomy.repository"),
    "Module 5 public boundary must not export its repository and encourage service bypasses.",
  );
}


/** Verifies Pass 6 repository/service/API tests and the focused backend regression runner remain present. */
async function verifyCatalogBackendTests() {
  for (const file of [
    "marketplace-backend/tests/module5/module5.test-helpers.ts",
    "marketplace-backend/tests/module5/module5.schemas.test.ts",
    "marketplace-backend/tests/module5/module5.service.test.ts",
    "marketplace-backend/tests/module5/module5.repository.test.ts",
    "marketplace-backend/tests/module5/module5.integration.test.ts",
    "marketplace-backend/scripts/run-module5-tests.mjs",
  ]) {
    assertCondition(await pathExists(file), `${file} is missing.`);
  }

  await requireText("marketplace-backend/tests/module5/module5.integration.test.ts", [
    "prevents descendant cycles",
    "filters inactive branches",
    "rejects duplicate identifiers and invalid variant axes",
    "preserves the previous mapping when validation fails",
    "hides inactive mapped attributes from public readers",
    "approved seller to read taxonomy",
    "global catalog read-only across two independent seller scopes",
    "repeated create retries without duplicating catalog rows, audit rows, or outbox events",
    "later Product publication boundary",
    "active category belongs to an inactive ancestor branch",
    "eight source-defined operations plus the approved mapping-read operation",
    "CATALOG_ERROR_CODE.CATEGORY_CYCLE",
    "CATALOG_ERROR_CODE.DUPLICATE_CATALOG_CODE",
    "CATALOG_ERROR_CODE.ATTRIBUTE_INVALID_FOR_CATEGORY",
    "CATALOG_OUTBOX_EVENT.CATEGORY_ATTRIBUTES_CHANGED",
  ]);

  await requireText("marketplace-backend/tests/module5/module5.service.test.ts", [
    "rejects authenticated catalog reads",
    "rejects catalog writes before opening a transaction",
    "filters inactive category branches",
    "variant-axis attribute without value options",
    "value-backed option data type",
    "complete mappings to managers but hides inactive mapped attributes",
    "active child category has an inactive ancestor",
    "selected brand is missing or inactive",
    "required and category-scoped Product values",
  ]);

  await requireText("marketplace-backend/tests/module5/module5.repository.test.ts", [
    "deterministic sort/name order",
    "filters public brand and attribute reads",
    "exact lookup helpers used by the service",
    "loads attribute values in one batched read",
    "replaces one category mapping set",
  ]);

  const packageJson = JSON.parse(
    await read("marketplace-backend/package.json"),
  );
  assertCondition(
    packageJson.scripts?.["test:module5:specs"] === "vitest run tests/module5",
    "Backend package.json must expose the focused Module 5 Vitest suite.",
  );
  assertCondition(
    packageJson.scripts?.["test:module5"] === "node scripts/run-module5-tests.mjs",
    "Backend package.json must expose the complete Module 5 backend runner.",
  );

  await requireText("marketplace-backend/scripts/run-module5-tests.mjs", [
    '"test:module5:migrations"',
    '"test:module5:specs"',
    '"test:module2:specs"',
    '"test:module21:specs"',
    '"test:module3:specs"',
    '"test:module4:specs"',
    '"typecheck"',
    '"lint"',
    '"build"',
  ]);

  await requireText("marketplace-backend/.github/workflows/ci.yml", [
    "Prepare database for Module 5 tests",
    "Run Module 5 tests",
    "npm run test:module5:specs",
  ]);
}

/** Verifies Pass 7 frontend feature files, route registration, permissions, and focused tests. */
async function verifyCatalogFrontendFeature() {
  for (const file of [
    "marketplace-frontend/src/features/catalog-taxonomy/catalog-taxonomy.constants.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/types/catalog-taxonomy.types.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/schemas/catalog-taxonomy.schemas.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/api/catalog-taxonomy.api.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/hooks/catalog-taxonomy.query-keys.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/hooks/use-catalog-taxonomy.ts",
    "marketplace-frontend/src/features/catalog-taxonomy/components/catalog-taxonomy-layout.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/components/category-tree.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/components/taxonomy-selector.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/forms/category-form.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/forms/brand-form.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/forms/attribute-form.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/forms/category-attribute-replacement-form.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/pages/admin-categories.page.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/pages/admin-brands.page.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/pages/admin-attributes.page.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/pages/admin-category-attributes.page.tsx",
    "marketplace-frontend/src/features/catalog-taxonomy/pages/seller-taxonomy-selector.page.tsx",
    "marketplace-frontend/src/app/routes/catalog-taxonomy.routes.tsx",
    "marketplace-frontend/tests/module5-catalog-taxonomy.test.tsx",
  ]) {
    assertCondition(await pathExists(file), `${file} is missing.`);
  }

  await requireText(
    "marketplace-frontend/src/features/catalog-taxonomy/api/catalog-taxonomy.api.ts",
    [
      'apiClient.get("/catalog/categories")',
      'apiClient.post("/admin/catalog/categories", input)',
      'apiClient.patch(`/admin/catalog/categories/${id}`, input)',
      'apiClient.get("/catalog/brands")',
      'apiClient.post("/admin/catalog/brands", input)',
      'apiClient.get("/catalog/attributes")',
      'apiClient.post("/admin/catalog/attributes", input)',
      'apiClient.put(`/admin/catalog/categories/${categoryId}/attributes`, input)',
    ],
  );

  const frontendSchemaFile =
    "marketplace-frontend/src/features/catalog-taxonomy/schemas/catalog-taxonomy.schemas.ts";
  await requireText(frontendSchemaFile, [
    "Category slug is required",
    "Brand slug is required",
    "Attribute values must be unique.",
    'Variant-axis attributes use the "option" data type.',
    "Variant-axis attributes need at least one allowed value.",
  ]);
  const frontendSchemaSource = await read(frontendSchemaFile);
  assertCondition(
    !frontendSchemaSource.includes("slugPattern") &&
      !frontendSchemaSource.includes(".regex("),
    "Frontend Module 5 must not impose a stricter slug regex than the backend contract.",
  );

  await requireText(
    "marketplace-frontend/src/features/catalog-taxonomy/forms/category-attribute-replacement-form.tsx",
    [
      "Builds editable rows from the authoritative mapping returned by the server",
      "Loading current category mapping...",
      "current server mapping is loaded before editing",
      "hidden mappings cannot be removed",
      "confirmReplacement",
      "Replace category mapping",
    ],
  );

  await requireText(
    "marketplace-frontend/src/features/catalog-taxonomy/hooks/use-catalog-taxonomy.ts",
    [
      "useCategoryAttributesQuery",
      "catalogTaxonomyApi.listCategoryAttributes(categoryId)",
      "catalogTaxonomyQueryKeys.categoryAttributes(variables.categoryId)",
      "invalidateQueries",
    ],
  );

  await requireText(
    "marketplace-frontend/src/features/catalog-taxonomy/components/taxonomy-selector.tsx",
    [
      "reusable read-only taxonomy selector",
      "Only attributes mapped to the selected category are shown",
      "Product-specific value validation belongs to Module 6",
      "Loading category attributes...",
      "No reusable attributes are mapped to this category.",
      "Taxonomy category selector",
      "Taxonomy brand selector",
      "changeCategory",
    ],
  );

  await requireText("marketplace-frontend/src/app/routes/catalog-taxonomy.routes.tsx", [
    'path: "/admin/catalog/categories"',
    'path: "/admin/catalog/brands"',
    'path: "/admin/catalog/attributes"',
    'path: "/admin/catalog/category-attributes"',
    'path: "/seller/catalog-taxonomy"',
  ]);

  await requireText("marketplace-frontend/src/app/router/router.tsx", [
    "adminCatalogCategoriesRoute",
    "adminCatalogBrandsRoute",
    "adminCatalogAttributesRoute",
    "adminCatalogCategoryAttributesRoute",
    "sellerCatalogTaxonomyRoute",
  ]);

  await requireText("marketplace-frontend/tests/module5-catalog-taxonomy.test.tsx", [
    "creates a normalized category and refreshes the hierarchy",
    "creates a brand through the approved create command",
    "creates a value-backed variant-axis attribute",
    "shows the variant-axis data-type rule before sending an invalid attribute",
    "loads the current mapping before requiring deliberate replacement confirmation",
    "gives sellers only the attributes mapped to their selected category",
    "renders a clear permission state",
  ]);

  const packageJson = JSON.parse(await read("marketplace-frontend/package.json"));
  assertCondition(
    packageJson.scripts?.["test:module5"] ===
      "vitest run tests/module5-catalog-taxonomy.test.tsx",
    "Frontend package.json must expose the focused Module 5 frontend suite.",
  );
}

/** Verifies Pass 8 browser coverage, release orchestration, and focused E2E commands. */
async function verifyCatalogE2eAndReleaseGate() {
  const e2eFile = "marketplace-frontend/e2e/module5.spec.ts";
  const releaseFile = "scripts/verify-module5.mjs";
  assertCondition(await pathExists(e2eFile), `${e2eFile} is missing.`);
  assertCondition(await pathExists(releaseFile), `${releaseFile} is missing.`);

  await requireText(e2eFile, [
    "Module 5 Catalog Taxonomy E2E",
    "builds a hierarchy in the browser and protects category cycles",
    "creates brands, attributes, and a complete category mapping through the browser",
    "gives an approved seller read-only taxonomy while blocking catalog mutation",
    "shows a clear permission state to a normal customer on admin taxonomy routes",
    'page.goto("/admin/catalog/categories")',
    'page.goto("/admin/catalog/category-attributes")',
    'page.goto("/seller/catalog-taxonomy")',
    'error?.code).toBe("CATEGORY_CYCLE")',
    "Confirm complete mapping replacement",
    "Server returned 2 mapped attributes.",
  ]);

  await requireText(releaseFile, [
    "scripts/verify-module5-static.mjs",
    '"test:module5:migrations"',
    '"test:module5:specs"',
    '"e2e/module5.spec.ts"',
    "Live OpenAPI Module 5 paths do not match the approved surface",
    "Module 5 backend regression",
    "Module 5 full release verification completed successfully.",
    "marketplace-backend-module5-release",
    "marketplace-frontend-module5-release",
  ]);

  const frontendPackageJson = JSON.parse(await read("marketplace-frontend/package.json"));
  assertCondition(
    frontendPackageJson.scripts?.["test:e2e:module5"] ===
      "playwright test e2e/module5.spec.ts",
    "Frontend package.json must expose the focused Module 5 Playwright suite.",
  );
}

/** Verifies Pass 8 keeps temporary evidence and generated runtime output out of the release tree. */
async function verifyPassBoundary() {
  assertCondition(
    !(await pathExists("docs/MODULE_5_IMPLEMENTATION_CHANGE_MAP.md")),
    "The temporary Pass 0 change map must stay removed.",
  );

  for (const deadFile of [
    "marketplace-backend/src/common/constants/http.ts",
    "marketplace-backend/src/common/errors/index.ts",
  ]) {
    assertCondition(
      !(await pathExists(deadFile)),
      `Confirmed unused shared file must stay removed: ${deadFile}`,
    );
  }

  for (const evidenceName of [
    "MODULE_5_PASS_7.md",
    "MODULE_5_PASS_7_EVIDENCE.md",
    "PASS_7_EVIDENCE.md",
    "PASS_7_DONE.md",
    "MODULE_5_PASS_8.md",
    "MODULE_5_PASS_8_EVIDENCE.md",
    "PASS_8_EVIDENCE.md",
    "PASS_8_DONE.md",
  ]) {
    assertCondition(
      !(await pathExists(`docs/${evidenceName}`)),
      `Temporary pass evidence must not be retained: docs/${evidenceName}`,
    );
  }

  for (const generatedPath of [
    "marketplace-backend/node_modules",
    "marketplace-backend/dist",
    "marketplace-backend/coverage",
    "marketplace-frontend/node_modules",
    "marketplace-frontend/dist",
    "marketplace-frontend/coverage",
    "marketplace-frontend/playwright-report",
    "marketplace-frontend/test-results",
  ]) {
    assertCondition(
      !(await pathExists(generatedPath)),
      `Generated runtime output must not be shipped in the release archive: ${generatedPath}`,
    );
  }
}

/** Verifies the current Module 5 source tree and release-gate wiring. */
async function main() {
  await verifyDatabaseFoundation();
  await verifyCatalogConstants();
  await verifyCatalogContracts();
  await verifyCatalogRbacComposition();
  await verifyCatalogRepository();
  await verifyCatalogService();
  await verifyCatalogController();
  await verifyCatalogRoutes();
  await verifyOptionalAuthentication();
  await verifyCatalogRegistration();
  await verifyCatalogBackendTests();
  await verifyCatalogFrontendFeature();
  await verifyCatalogE2eAndReleaseGate();
  await verifyPassBoundary();
  console.log("Module 5 static verification passed.");
}

await main();

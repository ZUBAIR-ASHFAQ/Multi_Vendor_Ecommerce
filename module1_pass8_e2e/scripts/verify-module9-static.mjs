import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Reads one required UTF-8 project file and reports a focused Module 9 path when missing. */
function readProjectFile(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Required Module 9 file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/** Requires one permanent contract fragment in a source file. */
function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing required text: ${expected}`);
  }
}

/** Rejects one source fragment that would violate Module 9 scope or pass boundaries. */
function rejectText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} contains forbidden text: ${forbidden}`);
  }
}

/** Rejects one source pattern that would weaken a permanent Module 9 regression guard. */
function rejectPattern(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`${label} contains forbidden pattern: ${pattern}`);
  }
}

/** Runs the accepted Module 8 structural gate before Module 9 checks. */
function verifyModule8Prerequisite() {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/verify-module8-static.mjs")],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `Module 8 prerequisite verification failed.\n${result.stdout ?? ""}${result.stderr ?? ""}`,
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

/** Confirms Pass 1 persistence remains present while later Module 9 passes build on it. */
function verifyDatabaseFoundation() {
  const schema = readProjectFile("marketplace-backend/src/database/schema/promotions.ts");
  const migration = readProjectFile("marketplace-backend/drizzle/0018_promotions_coupons.sql");
  const verifier = readProjectFile(
    "marketplace-backend/scripts/verify-module9-migrations.mjs",
  );

  for (const tableName of [
    "promotions",
    "promotion_scopes",
    "coupons",
    "coupon_redemptions",
  ]) {
    requireText(schema, `"${tableName}"`, "Module 9 Drizzle schema");
    requireText(migration, `CREATE TABLE "${tableName}"`, "Module 9 migration");
  }

  for (const guard of [
    "promotions_owner_seller_check",
    "promotions_date_range_check",
    "promotions_percentage_bounded_check",
    "promotion_scopes_pk",
    "coupons_code_uq",
    "coupon_redemptions_coupon_order_uq",
  ]) {
    requireText(migration, guard, "Module 9 database integrity guard");
  }

  requireText(verifier, "Module 9 migration verification passed.", "Module 9 migration verifier");
}

/** Confirms true Module 9 constants match the controlling contract without inventing a closed promotion-rule enum. */
function verifyConstants() {
  const constants = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.constants.ts",
  );

  for (const permission of [
    'READ: "promotions.read"',
    'ADMIN_MANAGE: "admin.promotions.manage"',
    'SELLER_MANAGE: "seller.promotions.manage"',
  ]) {
    requireText(constants, permission, "Module 9 permission contract");
  }

  for (const errorCode of [
    'PROMOTION_NOT_FOUND: "PROMOTION_NOT_FOUND"',
    'COUPON_INVALID: "COUPON_INVALID"',
    'COUPON_LIMIT_REACHED: "COUPON_LIMIT_REACHED"',
    'PROMOTION_SCOPE_FORBIDDEN: "PROMOTION_SCOPE_FORBIDDEN"',
  ]) {
    requireText(constants, errorCode, "Module 9 error contract");
  }

  for (const eventType of [
    'CREATED: "promotion.created"',
    'ACTIVATED: "promotion.activated"',
    'DEACTIVATED: "promotion.deactivated"',
    'COUPON_REDEEMED: "coupon.redeemed"',
  ]) {
    requireText(constants, eventType, "Module 9 outbox event contract");
  }

  rejectText(constants, "PROMOTION_TYPE_VALUES", "Module 9 rule-type contract");
}

/** Confirms Zod contracts validate the approved inputs while ownership and financial authority stay server-derived. */
function verifySchemas() {
  const schemas = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.schema.ts",
  );

  for (const schemaName of [
    "createPlatformPromotionBodySchema",
    "createSellerPromotionBodySchema",
    "updatePromotionBodySchema",
    "promotionIdParamsSchema",
    "adminPromotionListQuerySchema",
    "validatePromotionQuerySchema",
    "promotionResponseSchema",
    "promotionValidationResponseSchema",
  ]) {
    requireText(schemas, `export const ${schemaName}`, "Module 9 Zod contract");
  }

  for (const contractRule of [
    "Promotion endAt must be later than startAt.",
    "Percentage promotion value must not exceed 100.",
    "Promotion scopes must be unique.",
    "At least one editable promotion field is required.",
    "customer identity and current Cart are server-derived",
    "the guide does not define a closed rule-type enum",
  ]) {
    requireText(schemas, contractRule, "Module 9 validation contract");
  }

  const createShapeStart = schemas.indexOf("const createPromotionShape = {");
  const createShapeEnd = schemas.indexOf("} as const;", createShapeStart);
  if (createShapeStart < 0 || createShapeEnd < 0) {
    throw new Error("Module 9 createPromotionShape contract is missing.");
  }
  const createShape = schemas.slice(createShapeStart, createShapeEnd);
  for (const forbiddenOwnershipField of ["ownerType", "sellerId", "fundingType", "discountAmount"]) {
    rejectText(
      createShape,
      forbiddenOwnershipField,
      "Module 9 client ownership/financial contract",
    );
  }

  rejectText(schemas, "z.enum(PROMOTION_TYPE", "Module 9 rule-type contract");
}

/** Confirms Module 9 permissions are composed downstream into the existing platform RBAC seed. */
function verifyRbacComposition() {
  const seed = readProjectFile(
    "marketplace-backend/src/database/seeds/platform-rbac.seed.ts",
  );

  for (const marker of [
    "PROMOTION_PERMISSION",
    "PROMOTION_PERMISSION_CATALOG",
    "...PROMOTION_PERMISSION_CATALOG",
    "PROMOTION_PERMISSION.READ",
    "PROMOTION_PERMISSION.SELLER_MANAGE",
  ]) {
    requireText(seed, marker, "Module 9 RBAC composition");
  }

  const administrationConstants = readProjectFile(
    "marketplace-backend/src/modules/administration/administration.constants.ts",
  );
  rejectText(
    administrationConstants,
    "promotions",
    "Module 2 downstream dependency boundary",
  );
}


/** Confirms Pass 3 adds only scoped Drizzle persistence and transaction helpers. */
function verifyRepository() {
  const repository = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.repository.ts",
  );

  for (const marker of [
    "export class PromotionsRepository",
    "DatabaseExecutor",
    "listPlatformPromotions",
    "findPromotionByIdForUpdate",
    "findPlatformPromotionByIdForUpdate",
    "createPromotion",
    "updatePlatformPromotion",
    "updatePromotionStatus",
    "listScopesByPromotionId",
    "listScopesByPromotionIds",
    "replacePromotionScopes",
    "listCouponsByPromotionId",
    "listCouponsByPromotionIds",
    "findCouponByCode",
    "findCouponByCodeForUpdate",
    "createCoupon",
    "updateCoupon",
    "countCouponRedemptions",
    "countCouponRedemptionsForCustomer",
    "findCouponRedemptionByCouponAndOrder",
    "createCouponRedemptionIfMissing",
  ]) {
    requireText(repository, marker, "Module 9 repository contract");
  }

  for (const scopeGuard of [
    "eq(promotions.ownerType, PROMOTION_OWNER_TYPE.PLATFORM)",
    "eq(promotions.id, promotionId)",
    "eq(couponRedemptions.customerUserId, customerUserId)",
    "target: [couponRedemptions.couponId, couponRedemptions.orderId]",
    '.for("update")',
  ]) {
    requireText(repository, scopeGuard, "Module 9 repository scope/transaction guard");
  }

  for (const forbiddenImport of [
    '../sellers/sellers.repository',
    '../products/products.repository',
    '../catalog-taxonomy/catalog-taxonomy.repository',
    '../cart-wishlist/cart-wishlist.repository',
    '/schema/sellers',
    '/schema/catalog',
    '/schema/products',
    '/schema/cart-wishlist',
    'common/errors',
    'common/outbox',
    '../documents-audit/',
    '/schema/audit',
  ]) {
    rejectText(repository, forbiddenImport, "Module 9 repository layering");
  }

  for (const businessDecision of [
    "COUPON_INVALID",
    "COUPON_LIMIT_REACHED",
    "PROMOTION_SCOPE_FORBIDDEN",
    "PROMOTION_OUTBOX_EVENT",
  ]) {
    rejectText(repository, businessDecision, "Module 9 repository business boundary");
  }
}

/** Confirms Pass 4 owns promotion business rules, transactions, scope isolation, audit/outbox, and redemption logic. */
function verifyService() {
  const service = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.service.ts",
  );

  for (const marker of [
    "export class PromotionsService",
    "PromotionsTransactionRunner",
    "createPlatformPromotion",
    "createSellerPromotion",
    "updateAdminPromotion",
    "activateAdminPromotion",
    "deactivateAdminPromotion",
    "validateCoupon",
    "recordCouponRedemption",
    "assertSellerPermission(context, sellerId, PROMOTION_PERMISSION.SELLER_MANAGE)",
    "PROMOTION_FUNDING_TYPE.PLATFORM",
    "PROMOTION_FUNDING_TYPE.SELLER",
    "PROMOTION_STATUS.DRAFT",
    "PROMOTION_STATUS.SCHEDULED",
    "PROMOTION_STATUS.ACTIVE",
    "PROMOTION_STATUS.INACTIVE",
    "calculateDiscountTotalCents",
    "allocateDiscountCents",
    "countCouponRedemptions",
    "countCouponRedemptionsForCustomer",
    "findCouponByCodeForUpdate",
    "createCouponRedemptionIfMissing",
    "PROMOTION_OUTBOX_EVENT.CREATED",
    "PROMOTION_OUTBOX_EVENT.ACTIVATED",
    "PROMOTION_OUTBOX_EVENT.DEACTIVATED",
    "PROMOTION_OUTBOX_EVENT.COUPON_REDEEMED",
    "AuditService.using(tx).record",
    "OutboxService.using(tx).enqueue",
    "static using(transaction: DatabaseTransaction)",
  ]) {
    requireText(service, marker, "Module 9 service contract");
  }

  for (const errorCode of [
    "PROMOTION_ERROR_CODE.PROMOTION_NOT_FOUND",
    "PROMOTION_ERROR_CODE.COUPON_INVALID",
    "PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED",
    "PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN",
  ]) {
    requireText(service, errorCode, "Module 9 service error contract");
  }

  rejectText(
    service,
    "FIXED_AMOUNT",
    "Module 9 undefined non-percentage rule semantics",
  );

  for (const forbiddenImport of [
    '../sellers/sellers.repository',
    '../products/products.repository',
    '../catalog-taxonomy/catalog-taxonomy.repository',
    '../cart-wishlist/cart-wishlist.repository',
    '/schema/sellers',
    '/schema/catalog',
    '/schema/products',
    '/schema/cart-wishlist',
  ]) {
    rejectText(service, forbiddenImport, "Module 9 cross-module service boundary");
  }

  const sellersService = readProjectFile(
    "marketplace-backend/src/modules/sellers/sellers.service.ts",
  );
  requireText(
    sellersService,
    "async assertSellerCommerceEligible",
    "Module 9 Seller service integration",
  );
  requireText(
    sellersService,
    "async resolveCommerceStoreById",
    "Module 9 Seller service integration",
  );

  const productsService = readProjectFile(
    "marketplace-backend/src/modules/products/products.service.ts",
  );
  requireText(
    productsService,
    "async resolveProductPromotionScope",
    "Module 9 Product service integration",
  );
  requireText(
    productsService,
    "async resolvePublicProductPromotionScope",
    "Module 9 Product service integration",
  );
}

/** Confirms Pass 5 exposes exactly the approved runtime routes and registers their OpenAPI contract. */
function verifyHttpContracts() {
  const routes = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.routes.ts",
  );

  for (const path of [
    '"/api/v1/admin/promotions"',
    '"/api/v1/admin/promotions/{id}"',
    '"/api/v1/seller/promotions"',
    '"/api/v1/promotions/validate"',
    '"/api/v1/admin/promotions/{id}/activate"',
    '"/api/v1/admin/promotions/{id}/deactivate"',
  ]) {
    requireText(routes, path, "Module 9 OpenAPI contract");
  }

  for (const operationId of [
    'operationId: "listAdminPromotions"',
    'operationId: "createAdminPromotion"',
    'operationId: "updateAdminPromotion"',
    'operationId: "createSellerPromotion"',
    'operationId: "validatePromotionCoupon"',
    'operationId: "activateAdminPromotion"',
    'operationId: "deactivateAdminPromotion"',
  ]) {
    requireText(routes, operationId, "Module 9 OpenAPI operation");
  }

  for (const runtimeMarker of [
    "export function createAdminPromotionsRouter",
    "export function createSellerPromotionsRouter",
    "export function createPromotionsRouter",
    "router.use(authenticationMiddleware)",
    "requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE)",
    "requirePermission(PROMOTION_PERMISSION.SELLER_MANAGE)",
    "requirePermission(PROMOTION_PERMISSION.READ)",
    'router.patch(',
    '"/:id/activate"',
    '"/:id/deactivate"',
    '"/validate"',
  ]) {
    requireText(routes, runtimeMarker, "Module 9 runtime HTTP contract");
  }

  rejectText(routes, '"/api/v1/coupons', "Module 9 non-generic route contract");
  rejectText(routes, "router.delete(", "Module 9 non-generic route contract");
  rejectText(routes, '.repository.js', "Module 9 HTTP layering");
  rejectText(routes, '.service.js', "Module 9 HTTP layering");

  const controller = readProjectFile(
    "marketplace-backend/src/modules/promotions/promotions.controller.ts",
  );
  for (const marker of [
    "export class PromotionsController",
    "listAdminPromotions = async",
    "createAdminPromotion = async",
    "updateAdminPromotion = async",
    "createSellerPromotion = async",
    "validateCoupon = async",
    "activateAdminPromotion = async",
    "deactivateAdminPromotion = async",
    "adminPromotionListQuerySchema.parse(request.query)",
    "createPlatformPromotionBodySchema.parse(request.body)",
    "createSellerPromotionBodySchema.parse(request.body)",
    "promotionIdParamsSchema.parse(request.params)",
    "updatePromotionBodySchema.parse(request.body)",
    "validatePromotionQuerySchema.parse(request.query)",
    "emptyPromotionCommandBodySchema.parse(request.body)",
    "getRequestContext(response)",
    "successResponse",
    "getRequestId(response)",
  ]) {
    requireText(controller, marker, "Module 9 controller boundary");
  }
  for (const forbidden of [".repository.js", "/database/"]) {
    rejectText(controller, forbidden, "Module 9 controller layering");
  }

  const openApiDocument = readProjectFile(
    "marketplace-backend/src/http/openapi/openapi.document.ts",
  );
  requireText(
    openApiDocument,
    "promotionsOpenApiPaths",
    "Module 9 global OpenAPI registration",
  );
  requireText(
    openApiDocument,
    "...promotionsOpenApiPaths",
    "Module 9 global OpenAPI registration",
  );
  requireText(
    openApiDocument,
    'name: "Promotions & Coupons"',
    "Module 9 OpenAPI tag registration",
  );

  const app = readProjectFile("marketplace-backend/src/app.ts");
  for (const marker of [
    "new PromotionsService({",
    "sellers: sellersService",
    "products: productsService",
    "catalog: catalogTaxonomyService",
    "cart: cartWishlistService",
    "new PromotionsController(promotionsService)",
    "createPromotionsRouter(promotionsController)",
    "createSellerPromotionsRouter(promotionsController)",
    "createAdminPromotionsRouter(promotionsController)",
    '`${API_V1_PREFIX}/promotions`',
    '`${API_V1_PREFIX}/seller/promotions`',
    '`${API_V1_PREFIX}/admin/promotions`',
  ]) {
    requireText(app, marker, "Module 9 application composition");
  }
}

/** Confirms Pass 6 adds direct backend regression coverage without changing Module 9 production boundaries. */
function verifyBackendTests() {
  const schemas = readProjectFile(
    "marketplace-backend/tests/module9/module9.schemas.test.ts",
  );
  const repository = readProjectFile(
    "marketplace-backend/tests/module9/module9.repository.test.ts",
  );
  const service = readProjectFile(
    "marketplace-backend/tests/module9/module9.service.test.ts",
  );
  const integration = readProjectFile(
    "marketplace-backend/tests/module9/module9.integration.test.ts",
  );
  const helper = readProjectFile(
    "marketplace-backend/tests/module9/module9.test-helpers.ts",
  );
  const runner = readProjectFile(
    "marketplace-backend/scripts/run-module9-tests.mjs",
  );
  const backendPackage = readProjectFile("marketplace-backend/package.json");
  const backendCi = readProjectFile("marketplace-backend/.github/workflows/ci.yml");
  const regression = readProjectFile(
    "marketplace-backend/tests/regression/implemented-api-contracts.test.ts",
  );

  for (const proof of [
    "documents exactly the seven approved promotion operations with bearer authentication",
    "normalizes coupon codes and rejects client-owned authority fields",
    "rejects invalid date ranges, percentage overflow, duplicate scopes, and empty updates",
  ]) {
    requireText(schemas, proof, "Module 9 contract tests");
  }

  for (const proof of [
    "keeps platform listing scoped and coupon redemption identity constrained in persistence",
    "replaces promotion scopes atomically instead of leaving stale targets",
  ]) {
    requireText(repository, proof, "Module 9 repository tests");
  }

  for (const proof of [
    "rejects seller-to-seller promotion scope before any persistence transaction",
    "allocates a percentage discount deterministically in stable Cart-item order",
    "rejects a coupon before Cart loading when the customer usage limit is already reached",
  ]) {
    requireText(service, proof, "Module 9 service tests");
  }

  for (const proof of [
    "enforces authentication, permissions, and seller-to-seller promotion scope isolation",
    "creates, updates, lists, activates, and deactivates platform promotions with audit/outbox history",
    "rolls promotion creation back when normalized coupon uniqueness conflicts",
    "validates coupon eligibility from the authenticated Cart and never trusts a client discount amount",
    "keeps coupon redemption idempotent and enforces concurrent global usage limits transactionally",
    "enforces a per-customer redemption limit without consuming another customer allowance",
    "serializes two competing first redemptions so maxUses one can succeed only once",
  ]) {
    requireText(integration, proof, "Module 9 API/integration tests");
  }

  for (const helperMarker of [
    "resetModule9Tables",
    "createPlatformPromotionViaHttp",
    "createSellerPromotionViaHttp",
    "activatePromotionViaHttp",
    "countPromotionOutboxEvents",
  ]) {
    requireText(helper, helperMarker, "Module 9 test helper");
  }

  requireText(backendPackage, '"test:module9:specs"', "Module 9 focused test script");
  requireText(backendPackage, '"test:module9"', "Module 9 cumulative test script");
  for (const runnerCommand of [
    '"test:module9:migrations"',
    '"test:module9:specs"',
    '"test:regression:contracts"',
    '"test:module8:specs"',
    '"typecheck"',
    '"lint"',
    '"build"',
  ]) {
    requireText(runner, runnerCommand, "Module 9 cumulative backend runner");
  }
  requireText(backendCi, "npm run test:module9:migrations", "Module 9 CI migration gate");
  requireText(backendCi, "npm run test:module9:specs", "Module 9 CI test gate");
  requireText(
    regression,
    "locks Module 9 Promotions and Coupons to exactly the seven approved operations",
    "Module 9 exact API regression contract",
  );
}

/** Confirms Pass 7 implements the required React/TanStack feature surface and keeps server authority intact. */
function verifyFrontendFeature() {
  const frontendRoot = "marketplace-frontend/src/features/promotions";
  const api = readProjectFile(`${frontendRoot}/api/promotions.api.ts`);
  const hooks = readProjectFile(`${frontendRoot}/hooks/use-promotions.ts`);
  const form = readProjectFile(`${frontendRoot}/forms/promotion.form.tsx`);
  const schemas = readProjectFile(`${frontendRoot}/schemas/promotions.schemas.ts`);
  const adminPage = readProjectFile(`${frontendRoot}/pages/admin-promotions.page.tsx`);
  const sellerPage = readProjectFile(`${frontendRoot}/pages/seller-promotions.page.tsx`);
  const couponField = readProjectFile(`${frontendRoot}/components/coupon-field.tsx`);
  const breakdown = readProjectFile(`${frontendRoot}/components/discount-breakdown.tsx`);
  const scopeSelector = readProjectFile(`${frontendRoot}/components/promotion-scope-selector.tsx`);
  const couponManager = readProjectFile(`${frontendRoot}/components/coupon-manager.tsx`);
  const frontendRoutes = readProjectFile("marketplace-frontend/src/app/routes/promotions.routes.tsx");
  const router = readProjectFile("marketplace-frontend/src/app/router/router.tsx");
  const tests = readProjectFile("marketplace-frontend/tests/module9-promotions.test.tsx");
  const frontendPackage = readProjectFile("marketplace-frontend/package.json");

  for (const marker of [
    'apiClient.get("/admin/promotions"',
    'apiClient.post("/admin/promotions", input)',
    'apiClient.patch(`/admin/promotions/${promotionId}`, input)',
    'apiClient.post("/seller/promotions", input)',
    'apiClient.get("/promotions/validate"',
    'apiClient.post(`/admin/promotions/${promotionId}/activate`, {})',
    'apiClient.post(`/admin/promotions/${promotionId}/deactivate`, {})',
  ]) {
    requireText(api, marker, "Module 9 frontend API contract");
  }

  requireText(hooks, "useQuery({", "Module 9 TanStack Query contract");
  requireText(hooks, "useMutation({", "Module 9 TanStack mutation contract");
  requireText(form, "useForm({", "Module 9 TanStack Form contract");
  requireText(form, "promotionFormSchema", "Module 9 Zod form contract");
  requireText(form, "toCreateInput", "Module 9 server-authority payload mapping");
  for (const forbiddenAuthority of ["ownerType:", "sellerId:", "fundingType:", "discountAmount:"]) {
    rejectText(form, forbiddenAuthority, "Module 9 frontend authority boundary");
  }
  requireText(schemas, "promotionScopesSchema", "Module 9 frontend scope contract");
  requireText(schemas, "Percentage promotion value must not exceed 100.", "Module 9 frontend bounded percentage contract");
  requireText(scopeSelector, "Eligibility scopes", "Module 9 eligibility selector");
  requireText(couponManager, "Coupon manager", "Module 9 coupon manager");
  requireText(adminPage, "Promotions & Coupons", "Module 9 admin list/editor");
  requireText(sellerPage, "Seller Promotions", "Module 9 seller promotion form");
  requireText(couponField, "Checkout coupon code", "Module 9 Checkout coupon field");
  requireText(breakdown, "Preview only. Checkout must revalidate", "Module 9 discount breakdown");
  requireText(frontendRoutes, 'path: "/admin/promotions"', "Module 9 admin frontend route");
  requireText(frontendRoutes, 'path: "/seller/promotions"', "Module 9 seller frontend route");
  requireText(router, "adminPromotionsRoute", "Module 9 route registration");
  requireText(router, "sellerPromotionsRoute", "Module 9 route registration");
  requireText(frontendPackage, '"test:module9"', "Module 9 focused frontend test script");

  for (const proof of [
    "creates a platform promotion without sending client-owned funding or seller authority",
    "blocks an invalid percentage before the promotion API request",
    "shows safe list request context and retries a failed administrator query",
    "creates a seller-funded promotion without exposing seller ownership fields in the form payload",
    "validates a checkout coupon from the current Cart and renders the server discount breakdown",
    "shows a coupon conflict with its safe request ID",
  ]) {
    requireText(tests, proof, "Module 9 frontend regression proof");
  }

  rejectText(api, "apiClient.delete(", "Module 9 generic frontend CRUD guard");
  rejectText(frontendRoutes, "/checkout", "Module 9 fake Checkout route guard");
}

/** Confirms Pass 8 covers the real browser workflow and cumulative release/integrity gates. */
function verifyE2EReleaseGate() {
  const frontendPackage = JSON.parse(readProjectFile("marketplace-frontend/package.json"));
  const backendPackage = JSON.parse(readProjectFile("marketplace-backend/package.json"));
  const e2eSpec = readProjectFile("marketplace-frontend/e2e/module9.spec.ts");
  const e2eRunner = readProjectFile("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const releaseData = readProjectFile(
    "marketplace-backend/scripts/verify-module9-release-data.mjs",
  );
  const cumulativeRelease = readProjectFile("scripts/verify-module9.mjs");
  const frontendCi = readProjectFile("marketplace-frontend/.github/workflows/ci.yml");

  if (
    frontendPackage.scripts?.["test:e2e:module9"] !==
    "playwright test e2e/module9.spec.ts"
  ) {
    throw new Error("Frontend package is missing the focused Module 9 Playwright command.");
  }
  if (
    backendPackage.scripts?.["test:module9:release-data"] !==
    "node scripts/verify-module9-release-data.mjs"
  ) {
    throw new Error("Backend package is missing the Module 9 post-E2E integrity command.");
  }

  for (const proof of [
    "creates and activates a platform promotion with a coupon through the real UI",
    "validates the active coupon against the real Cart and shows deterministic discount breakdown",
    "blocks Seller A from targeting Seller B and then accepts Seller A's own scope",
    "deactivates the promotion without deleting it and rejects later coupon validation",
  ]) {
    requireText(e2eSpec, proof, "Module 9 Playwright workflow");
  }

  for (const boundary of [
    'scopeType: "product"',
    'scopeType: "store"',
    'sellerB.store.id',
    'Coupon ${couponCode} is eligible',
    'toContainText("-$20.00")',
    'expect(persisted?.status).toBe("inactive")',
  ]) {
    requireText(e2eSpec, boundary, "Module 9 E2E business proof");
  }

  rejectPattern(
    e2eSpec,
    /\b(?:test|it|describe)\.(?:skip|only|todo)\b/,
    "Module 9 Playwright coverage",
  );
  for (const forbidden of ["DATABASE_URL", "reset-test-database", "drizzle", "psql"]) {
    rejectText(e2eSpec, forbidden, "Module 9 browser data boundary");
  }

  for (const runnerProof of [
    '"e2e/module9.spec.ts"',
    '"--workers=1"',
    '"/api/v1/admin/promotions"',
    '"/api/v1/promotions/validate"',
    '"test:module9:release-data"',
  ]) {
    requireText(e2eRunner, runnerProof, "Module 9 cross-repository E2E runner");
  }

  for (const releaseProof of [
    '"scripts/verify-module9-static.mjs"',
    '"test:module9:migrations"',
    '"test:module9:specs"',
    '"test:module9"',
    '"e2e/module9.spec.ts"',
    '"test:module9:release-data"',
    '"--workers=1"',
    '"docker", ["build"',
  ]) {
    requireText(cumulativeRelease, releaseProof, "Module 9 cumulative release verifier");
  }

  for (const invariant of [
    "Module 9 post-E2E Promotions/Coupons integrity verification passed.",
    "Promotion ownership/funding consistency",
    "Promotion date/value integrity",
    "Duplicate Promotion scopes",
    "Non-normalized Coupon codes",
    "promotion.created",
    "promotion.activated",
    "promotion.deactivated",
  ]) {
    requireText(releaseData, invariant, "Module 9 post-E2E data verifier");
  }

  requireText(frontendCi, "npm run test:module9", "Module 9 frontend CI regression gate");
}

/** Confirms Pass 8 keeps every implemented browser workflow in one strict cumulative release gate. */
function verifyPass8SourceGate() {
  const e2eRunner = readProjectFile("marketplace-frontend/e2e/run-e2e-ci.mjs");
  const cumulativeRelease = readProjectFile("scripts/verify-module9.mjs");
  const expectedSpecs = [
    "foundation.spec.ts",
    "module2.spec.ts",
    "module21.spec.ts",
    "module3.spec.ts",
    "module4.spec.ts",
    "module5.spec.ts",
    "module6.spec.ts",
    "module7.spec.ts",
    "module19.spec.ts",
    "module8.spec.ts",
    "module9.spec.ts",
  ];

  for (const specName of expectedSpecs) {
    const relativePath = `marketplace-frontend/e2e/${specName}`;
    const spec = readProjectFile(relativePath);
    requireText(e2eRunner, `"e2e/${specName}"`, "Cross-repository Playwright runner");
    requireText(cumulativeRelease, `"e2e/${specName}"`, "Cumulative Module 9 release verifier");
    rejectPattern(
      spec,
      /\b(?:test|it|describe)\.(?:skip|only|todo)\b/,
      `${specName} Playwright coverage`,
    );
    for (const forbidden of ["DATABASE_URL", "reset-test-database", "drizzle", "psql"]) {
      rejectText(spec, forbidden, `${specName} browser data boundary`);
    }
  }

  for (const contractGuard of [
    '"scripts/verify-http-contracts.mjs"',
    '"scripts/verify-backend-test-contracts.mjs"',
    '"scripts/verify-frontend-feature-contracts.mjs"',
  ]) {
    requireText(cumulativeRelease, contractGuard, "Module 9 cumulative contract gate");
  }
}

/** Confirms the Module 9 barrel exposes the Pass 5 HTTP boundary without redundant type boilerplate. */
function verifyModuleBoundary() {
  const index = readProjectFile("marketplace-backend/src/modules/promotions/index.ts");
  requireText(index, 'export * from "./promotions.constants.js";', "Module 9 module boundary");
  requireText(index, 'export * from "./promotions.controller.js";', "Module 9 module boundary");
  requireText(index, 'export * from "./promotions.schema.js";', "Module 9 module boundary");
  requireText(index, 'export * from "./promotions.routes.js";', "Module 9 module boundary");
  requireText(index, 'export * from "./promotions.repository.js";', "Module 9 module boundary");
  requireText(index, 'export * from "./promotions.service.js";', "Module 9 module boundary");

  if (existsSync(join(root, "marketplace-backend/src/modules/promotions/promotions.types.ts"))) {
    throw new Error("Module 9 must not add a redundant types file when Zod/Drizzle already infer the required types.");
  }
}

/** Runs all dependency-free Module 9 source-contract checks. */
function main() {
  verifyModule8Prerequisite();
  verifyIndependentProjects();
  verifyDatabaseFoundation();
  verifyConstants();
  verifySchemas();
  verifyRbacComposition();
  verifyRepository();
  verifyService();
  verifyHttpContracts();
  verifyBackendTests();
  verifyFrontendFeature();
  verifyE2EReleaseGate();
  verifyPass8SourceGate();
  verifyModuleBoundary();
  console.log("Module 9 static verification passed through Pass 8 E2E/regression source gate.");
}

main();

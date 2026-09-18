import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");

/** Throws one focused Module 4 static-verification error. */
function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** Resolves one delivery-root relative path. */
function resolve(relativePath) {
  return path.join(rootDirectory, relativePath);
}

/** Reads one UTF-8 project file. */
function read(relativePath) {
  return readFileSync(resolve(relativePath), "utf8");
}

/** Requires one file to exist in the completed Module 4 delivery. */
function requireFile(relativePath) {
  assertCondition(existsSync(resolve(relativePath)), `Required Module 4 file is missing: ${relativePath}`);
}

/** Requires one source file to contain every listed verification marker. */
function requireText(relativePath, markers) {
  const source = read(relativePath);
  for (const marker of markers) {
    assertCondition(source.includes(marker), `${relativePath} is missing Module 4 marker: ${marker}`);
  }
}

/** Recursively lists files below one delivery-relative directory. */
function walk(relativeDirectory) {
  const absoluteDirectory = resolve(relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDirectory)) {
    const absolute = path.join(absoluteDirectory, entry);
    const relative = path.relative(rootDirectory, absolute).replaceAll("\\", "/");
    if (statSync(absolute).isDirectory()) files.push(...walk(relative));
    else files.push(relative);
  }
  return files;
}

/** Verifies the seller routes expose exactly ten documented Module 4 OpenAPI operations. */
function verifyExactSellerOpenApiMarkers() {
  const source = read("marketplace-backend/src/modules/sellers/sellers.routes.ts");
  const operationIds = [...source.matchAll(/operationId:\s*"([^"]+)"/g)].map((match) => match[1]);
  const expected = [
    "submitSellerApplication",
    "listSellerApplications",
    "approveSellerApplication",
    "rejectSellerApplication",
    "getMySeller",
    "updateMySeller",
    "createSellerStore",
    "getPublicStore",
    "updateSellerStore",
    "suspendSeller",
  ].sort();
  assertCondition(operationIds.length === 10, `Expected 10 Module 4 operation IDs; found ${operationIds.length}.`);
  assertCondition(
    JSON.stringify(operationIds.sort()) === JSON.stringify(expected),
    `Module 4 operation IDs do not match the approved surface: ${operationIds.join(", ")}`,
  );
}

/** Verifies Module 4 repository coverage, seller scoping and removal of proven dead queries. */
function verifySellerRepositoryContract() {
  const repository = read("marketplace-backend/src/modules/sellers/sellers.repository.ts");
  const requiredMethods = [
    "createSellerApplication",
    "findOpenSellerApplicationByApplicantUserId",
    "findSellerApplicationByIdForReview",
    "listSellerApplications",
    "reviewSubmittedSellerApplication",
    "createSeller",
    "findSellerByOwnerUserId",
    "findSellerById",
    "findSellerByIdForUpdate",
    "findSellerByIdForStaffUser",
    "updateSellerProfile",
    "updateSellerStatus",
    "createStore",
    "listStoresBySellerId",
    "findStoreByIdForSeller",
    "findStoreByIdForSellerForUpdate",
    "findStoreIdBySlug",
    "findPublicStoreBySlug",
    "updateStoreForSeller",
    "updateStoreStatusesForSeller",
    "upsertSellerStaffMembership",
    "deactivateSellerStaffMembership",
    "getSellerStaffSummary",
    "listActiveSellerIdsForUser",
    "listActiveStoreIdsForUser",
    "findSellerApplicationDocumentScope",
    "findSellerDocumentScope",
    "findStoreDocumentScope",
  ];

  for (const method of requiredMethods) {
    assertCondition(
      repository.includes(`async ${method}(`),
      `Module 4 repository is missing required persistence method: ${method}`,
    );
  }

  for (const removedMethod of [
    "findSellerApplicationById",
    "findSellerStaffMembership",
    "listSellerStaffMembershipsByUser",
  ]) {
    assertCondition(
      !repository.includes(`async ${removedMethod}(`),
      `Proven-unused Module 4 repository method should stay removed: ${removedMethod}`,
    );
  }

  for (const marker of [
    "and(eq(stores.id, storeId), eq(stores.sellerId, sellerId))",
    "and(\n          eq(stores.slug, slug),\n          eq(stores.status, STORE_STATUS.ACTIVE)",
    "eq(sellers.status, SELLER_STATUS.ACTIVE)",
    "eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED)",
    "inArray(sellerStaff.sellerId, authorizedSellerIds)",
    "inArray(stores.sellerId, sellerIds)",
  ]) {
    assertCondition(
      repository.includes(marker),
      `Module 4 repository is missing required ownership/lifecycle SQL marker: ${marker}`,
    );
  }

  const service = read("marketplace-backend/src/modules/sellers/sellers.service.ts");
  const controller = read("marketplace-backend/src/modules/sellers/sellers.controller.ts");
  for (const [name, source] of [["service", service], ["controller", controller]]) {
    assertCondition(
      !source.includes('from "../../database/db.js"'),
      `Module 4 ${name} must not bypass the repository with the root database client.`,
    );
    for (const directQuery of [".select(", ".insert(", ".update(", ".delete("]) {
      assertCondition(
        !source.includes(directQuery),
        `Module 4 ${name} contains direct database-style query marker: ${directQuery}`,
      );
    }
  }
}

/** Verifies the Pass 4 service invariants that protect seller/store lifecycle and seller staff delegation. */
function verifySellerServiceInvariants() {
  const sellersService = read("marketplace-backend/src/modules/sellers/sellers.service.ts");
  const administrationService = read(
    "marketplace-backend/src/modules/administration/administration.service.ts",
  );

  for (const marker of [
    "findSellerByIdForUpdate",
    "findStoreByIdForSellerForUpdate",
    "assertSellerStoreEditable",
    "A suspended store cannot be changed through the seller store update command.",
    "Array.from(new Set(sellerIds)).sort()",
  ]) {
    assertCondition(
      sellersService.includes(marker),
      `Module 4 service is missing required Pass 4 lifecycle marker: ${marker}`,
    );
  }

  for (const marker of [
    "assertSellerPermissionDelegationAllowed",
    "permission === ADMIN_PERMISSION.SELLER_STAFF_MANAGE",
    "Seller users cannot delegate seller staff-management authority.",
    "exactSellerStaffEmail",
    "toSellerStaffUserResponse",
    "listSellerAssignableRoles",
  ]) {
    assertCondition(
      administrationService.includes(marker),
      `Administration service is missing required Module 4 staff-delegation guard: ${marker}`,
    );
  }

}


/** Verifies Module 4 HTTP routing, RBAC, controller-service wiring, mounts and OpenAPI registration. */
function verifySellerHttpContract() {
  const routes = read("marketplace-backend/src/modules/sellers/sellers.routes.ts");
  const controller = read("marketplace-backend/src/modules/sellers/sellers.controller.ts");
  const app = read("marketplace-backend/src/app.ts");
  const openApiDocument = read(
    "marketplace-backend/src/http/openapi/openapi.document.ts",
  );
  const index = read("marketplace-backend/src/modules/sellers/index.ts");

  const routePatterns = [
    /router\.post\(\s*"\/applications",\s*controller\.submitApplication,?\s*\)/s,
    /router\.get\(\s*"\/me",\s*requirePermission\(SELLER_PERMISSION\.PROFILE_READ\),\s*controller\.getMySeller,?\s*\)/s,
    /router\.patch\(\s*"\/me",\s*requirePermission\(SELLER_PERMISSION\.PROFILE_MANAGE\),\s*controller\.updateMySeller,?\s*\)/s,
    /router\.post\(\s*"\/me\/stores",\s*requirePermission\(SELLER_PERMISSION\.STORE_MANAGE\),\s*controller\.createStore,?\s*\)/s,
    /router\.patch\(\s*"\/me\/stores\/:id",\s*requirePermission\(SELLER_PERMISSION\.STORE_MANAGE\),\s*controller\.updateStore,?\s*\)/s,
    /router\.get\(\s*"\/:slug",\s*controller\.getPublicStore,?\s*\)/s,
    /router\.get\(\s*"\/",\s*requirePermission\(SELLER_PERMISSION\.ADMIN_REVIEW\),\s*controller\.listApplications,?\s*\)/s,
    /router\.post\(\s*"\/:id\/approve",\s*requirePermission\(SELLER_PERMISSION\.ADMIN_REVIEW\),\s*controller\.approveApplication,?\s*\)/s,
    /router\.post\(\s*"\/:id\/reject",\s*requirePermission\(SELLER_PERMISSION\.ADMIN_REVIEW\),\s*controller\.rejectApplication,?\s*\)/s,
    /router\.post\(\s*"\/:id\/suspend",\s*requirePermission\(SELLER_PERMISSION\.ADMIN_SUSPEND\),\s*controller\.suspendSeller,?\s*\)/s,
  ];
  for (const pattern of routePatterns) {
    assertCondition(
      pattern.test(routes),
      `Module 4 HTTP router is missing an approved route/RBAC binding: ${pattern}`,
    );
  }

  const authUseCount = [...routes.matchAll(/router\.use\(authenticationMiddleware\)/g)].length;
  assertCondition(
    authUseCount === 3,
    `Expected authentication middleware on exactly three private Module 4 routers; found ${authUseCount}.`,
  );
  const publicRouterStart = routes.indexOf("export function createPublicStoresRouter");
  const publicRouterEnd = routes.indexOf("export function createAdminSellerApplicationsRouter");
  const publicRouterSource = routes.slice(publicRouterStart, publicRouterEnd);
  assertCondition(
    !publicRouterSource.includes("authenticationMiddleware"),
    "Public store route must remain public and must not use authentication middleware.",
  );

  const controllerMethods = [
    ["submitApplication", "submitApplication"],
    ["listApplications", "listApplications"],
    ["approveApplication", "approveApplication"],
    ["rejectApplication", "rejectApplication"],
    ["getMySeller", "getMySeller"],
    ["updateMySeller", "updateMySeller"],
    ["createStore", "createStore"],
    ["getPublicStore", "getPublicStore"],
    ["updateStore", "updateStore"],
    ["suspendSeller", "suspendSeller"],
  ];
  for (const [controllerMethod, serviceMethod] of controllerMethods) {
    assertCondition(
      controller.includes(`${controllerMethod} = async`),
      `Module 4 controller is missing approved HTTP method: ${controllerMethod}`,
    );
    assertCondition(
      controller.includes(`this.sellersService.${serviceMethod}(`),
      `Module 4 controller ${controllerMethod} is not wired to SellersService.${serviceMethod}.`,
    );
  }

  for (const mount of [
    'app.use(`${API_V1_PREFIX}/sellers`, sellersRouter);',
    'app.use(`${API_V1_PREFIX}/stores`, publicStoresRouter);',
    '`${API_V1_PREFIX}/admin/seller-applications`,',
    'app.use(`${API_V1_PREFIX}/admin/sellers`, adminSellersRouter);',
  ]) {
    assertCondition(
      app.includes(mount),
      `Module 4 app composition is missing approved router mount: ${mount}`,
    );
  }

  assertCondition(
    openApiDocument.includes('import { sellersOpenApiPaths } from "../../modules/sellers/sellers.routes.js";') &&
      openApiDocument.includes("...sellersOpenApiPaths"),
    "Module 4 OpenAPI paths are not registered in the live OpenAPI document.",
  );

  for (const marker of [
    "objectPropertySchema",
    "pathParameter(\"id\", sellerStoreIdParamsSchema)",
    "pathParameter(\"id\", adminSellerIdParamsSchema)",
    "pathParameter(\"slug\", publicStoreSlugParamsSchema)",
    "queryParameter(\"page\", adminSellerApplicationListQuerySchema)",
  ]) {
    assertCondition(
      routes.includes(marker),
      `Module 4 OpenAPI parameters are not derived from the runtime Zod contract: ${marker}`,
    );
  }

  assertCondition(
    !index.includes('export * from "./sellers.repository.js";'),
    "Module 4 index must not expose its repository as a cross-module public boundary.",
  );
}

/** Rejects generated output, temporary generation evidence and placeholder markers from the final tree. */
function verifyFinalCleanup() {
  const forbiddenDirectories = [
    "marketplace-backend/node_modules",
    "marketplace-backend/dist",
    "marketplace-backend/coverage",
    "marketplace-frontend/node_modules",
    "marketplace-frontend/dist",
    "marketplace-frontend/coverage",
    "marketplace-frontend/test-results",
    "marketplace-frontend/playwright-report",
  ];
  for (const directory of forbiddenDirectories) {
    assertCondition(
      !existsSync(resolve(directory)),
      `Final archive must not contain generated directory: ${directory}`,
    );
  }

  assertCondition(
    !existsSync(resolve("docs/MODULE_4_CHANGE_MAP.md")),
    "The temporary Module 4 pass/change-map document must be removed after durable decisions are transferred.",
  );

  const checkedFiles = [
    ...walk("marketplace-backend/src/modules/sellers"),
    ...walk("marketplace-backend/tests/module4"),
    ...walk("marketplace-frontend/src/features/sellers"),
    "marketplace-frontend/e2e/module4.spec.ts",
    "scripts/verify-module4-static.mjs",
    "scripts/verify-module4.mjs",
  ];
  const placeholderTokens = ["TO" + "DO", "FIX" + "ME", "HA" + "CK", "X" + "XX"];
  const placeholderPattern = new RegExp(`\\b(${placeholderTokens.join("|")})\\b`);
  for (const file of checkedFiles) {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue;
    assertCondition(
      !placeholderPattern.test(read(file)),
      `Final Module 4 source contains a placeholder marker: ${file}`,
    );
  }

  for (const file of walk(".")) {
    const base = path.basename(file).toLowerCase();
    const looksLikeEvidence =
      /module[_-]?4.*(?:status|evidence|pass[_-]?evidence|change[_-]?map)/i.test(base) ||
      /pass[_-]?evidence/i.test(base);
    assertCondition(!looksLikeEvidence, `Historical Module 4 pass/status evidence file should not remain: ${file}`);
  }
}

/** Verifies the completed Module 4 implementation and release-gate wiring without runtime dependencies. */
function main() {
  [
    "marketplace-backend/src/database/schema/sellers.ts",
    "marketplace-backend/drizzle/0007_seller_store_management.sql",
    "marketplace-backend/src/modules/sellers/sellers.constants.ts",
    "marketplace-backend/src/modules/sellers/sellers.schema.ts",
    "marketplace-backend/src/modules/sellers/sellers.repository.ts",
    "marketplace-backend/src/modules/sellers/sellers.service.ts",
    "marketplace-backend/src/modules/sellers/sellers.controller.ts",
    "marketplace-backend/src/modules/sellers/sellers.routes.ts",
    "marketplace-backend/tests/module4/module4.schemas.test.ts",
    "marketplace-backend/tests/module4/module4.service.test.ts",
    "marketplace-backend/tests/module4/module4.integration.test.ts",
    "marketplace-backend/scripts/run-module4-tests.mjs",
    "marketplace-backend/scripts/verify-module4-migrations.mjs",
    "marketplace-frontend/src/features/sellers/api/sellers.api.ts",
    "marketplace-frontend/src/features/sellers/hooks/use-sellers.ts",
    "marketplace-frontend/src/features/sellers/components/seller-layout.tsx",
    "marketplace-frontend/src/features/sellers/forms/seller-application-form.tsx",
    "marketplace-frontend/src/features/sellers/forms/seller-profile-form.tsx",
    "marketplace-frontend/src/features/sellers/forms/store-form.tsx",
    "marketplace-frontend/src/features/sellers/pages/seller-application.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/admin-seller-applications.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/seller-profile.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/seller-stores.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/seller-staff.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/admin-seller-suspension.page.tsx",
    "marketplace-frontend/src/features/sellers/pages/public-store.page.tsx",
    "marketplace-frontend/src/app/routes/sellers.routes.tsx",
    "marketplace-frontend/tests/module4-sellers.test.tsx",
    "marketplace-frontend/e2e/module4.spec.ts",
    "scripts/verify-module4.mjs",
  ].forEach(requireFile);

  requireText("marketplace-backend/src/database/schema/sellers.ts", [
    '"seller_applications"',
    '"sellers"',
    '"stores"',
    '"seller_staff"',
    'uniqueIndex("stores_slug_uq")',
    'uniqueIndex("seller_staff_seller_user_uq")',
  ]);

  requireText("marketplace-backend/drizzle/0007_seller_store_management.sql", [
    'CREATE TABLE "seller_applications"',
    'CREATE TABLE "sellers"',
    'CREATE TABLE "stores"',
    'CREATE TABLE "seller_staff"',
    'ADD CONSTRAINT "user_roles_seller_id_sellers_id_fk"',
    "'store_asset'",
  ]);

  requireText("marketplace-backend/src/modules/sellers/sellers.constants.ts", [
    "SELLER_EDITABLE_STORE_STATUS_VALUES",
    'PROFILE_READ: "seller.profile.read"',
    'PROFILE_MANAGE: "seller.profile.manage"',
    'STORE_MANAGE: "seller.store.manage"',
    "STAFF_MANAGE: ADMIN_PERMISSION.SELLER_STAFF_MANAGE",
    'ADMIN_REVIEW: "admin.sellers.review"',
    'ADMIN_SUSPEND: "admin.sellers.suspend"',
    'SELLER_NOT_FOUND: "SELLER_NOT_FOUND"',
    'STORE_SLUG_TAKEN: "STORE_SLUG_TAKEN"',
    'SELLER_SCOPE_FORBIDDEN: "SELLER_SCOPE_FORBIDDEN"',
  ]);

  requireText("marketplace-backend/src/modules/sellers/sellers.schema.ts", [
    "sellerEditableStoreStatusSchema",
    "status: sellerEditableStoreStatusSchema.optional()",
    ".meta({ minProperties: 1 })",
  ]);

  requireText("marketplace-backend/src/modules/sellers/sellers.routes.ts", [
    "z.toJSONSchema",
    "objectPropertySchema",
    "openApiSchema(updateStoreBodySchema)",
    "sellerApplicationListParameters",
    "suspended remains an administrator-controlled state",
  ]);

  verifyExactSellerOpenApiMarkers();
  verifySellerRepositoryContract();
  verifySellerServiceInvariants();
  verifySellerHttpContract();

  const sellerRoutes = read("marketplace-backend/src/modules/sellers/sellers.routes.ts");
  for (const forbidden of [
    'router.delete(',
    '"/sellers"',
    '"/stores/:id"',
    '"/:id"',
  ]) {
    assertCondition(
      !sellerRoutes.includes(forbidden),
      `Seller routes contain an unapproved generic marker: ${forbidden}`,
    );
  }

  requireText("marketplace-backend/src/app.ts", [
    "SellersService",
    "resolveAccessScopes",
    "sellerDocumentPolicy",
    "synchronizeMemberships",
    "createAdminSellerApplicationsRouter",
    "createPublicStoresRouter",
  ]);

  requireText("marketplace-backend/tests/module4/module4.integration.test.ts", [
    "approves an application atomically into seller owner identity, seller staff and active authentication scope",
    "rolls back seller approval when downstream protected-role provisioning fails",
    "rejects privileged seller review and suspension routes without the required admin permissions",
    "prevents Seller B from reading or updating Seller A private store state",
    "moves an approved seller store between active and inactive while keeping inactive stores private",
    "synchronizes seller-manager RBAC with seller_staff and current seller/store authentication scopes",
    "lets a seller owner assign the normal seller-manager role inside only their seller scope",
    "prevents a seller owner from delegating seller-owner or staff-management authority",
    "serializes concurrent seller suspension commands and blocks seller store reactivation",
    "seller-verification and store-asset links inside applicant/seller resource scope",
    "exactly the ten approved Module 4 OpenAPI operations",
  ]);

  requireText("marketplace-backend/tests/module4/module4.service.test.ts", [
    "locks each assignable seller scope once in stable order before staff assignment",
    "rejects seller staff assignment when the requested seller is suspended",
  ]);

  requireText("marketplace-backend/tests/module2/module2.business-rules.integration.test.ts", [
    "allows seller staff management inside Seller A without delegating staff-management authority",
    "rejects seller staff attempts to delegate seller.staff.manage",
    "lets seller staff managers search one exact email and read only safe assignable seller roles",
    "createSellerScope",
  ]);

  requireText("marketplace-backend/scripts/run-module4-tests.mjs", [
    '"test:module4:migrations"',
    '"test:module4:specs"',
    '"test:module2:specs"',
    '"test:module21:specs"',
    '"test:module3:specs"',
    '"typecheck"',
    '"lint"',
    '"build"',
  ]);

  requireText("marketplace-frontend/tests/module4-sellers.test.tsx", [
    "submits a customer seller application without client-owned approval fields",
    "uploads optional seller verification",
    "loads the admin review queue and sends the explicit approve command",
    "updates the seller profile and shows the server-owned staff summary",
    "creates a normalized store and renders the returned store status",
    "updates seller-controlled store status through the existing store PATCH command",
    "lets a seller owner find one exact-email user and assign a safe seller role",
    "shows seller staff management from the seller profile when the owner has permission",
    "sends the explicit admin seller suspension command from the protected frontend page",
    "uploads and links a store_asset",
    "renders only the public-safe store projection",
  ]);

  requireText("marketplace-frontend/src/features/sellers/forms/store-form.tsx", [
    "Store status",
    'value="inactive"',
    "Admin suspension cannot be changed here.",
  ]);

  requireText("marketplace-frontend/src/features/sellers/pages/seller-staff.page.tsx", [
    "Find one existing marketplace user by exact email",
    "SELLER_PERMISSION.STAFF_MANAGE",
    "Only seller-scoped roles that do not contain staff-management authority are listed.",
  ]);

  requireText("marketplace-frontend/src/features/sellers/pages/admin-seller-suspension.page.tsx", [
    "SELLER_PERMISSION.ADMIN_SUSPEND",
    "Suspend seller",
    "useSuspendSellerMutation",
  ]);

  requireText("marketplace-frontend/src/app/routes/sellers.routes.tsx", [
    'path: "/seller/staff"',
    'path: "/admin/sellers/suspend"',
  ]);

  requireText("marketplace-frontend/src/features/auth/auth.navigation.ts", [
    '"/seller/staff"',
    '"/admin/sellers/suspend"',
  ]);

  requireText("marketplace-frontend/e2e/module4.spec.ts", [
    "customer registers, signs in, submits seller application, and links verification evidence",
    "platform admin reviews and approves the submitted application in the browser",
    "approved seller re-authenticates, updates profile, creates store, uploads logo, and serves public storefront",
    "seller controls store active/inactive status in the browser and public visibility follows",
    "Seller B cannot update or attach a store asset to Seller A private store",
    "seller owner manages seller staff through the browser without exposing owner-level delegation",
    "platform admin suspends the seller through the browser and active scopes disappear",
    'getByLabel(`Store status ${storeId}`)',
    'locator("option", { hasText: "Seller Owner" })',
    'getByLabel("Seller ID to suspend")',
    '"STORE_NOT_FOUND"',
    '"SELLER_SCOPE_FORBIDDEN"',
    '"FILE_NOT_FOUND"',
  ]);

  requireText("marketplace-frontend/src/features/sellers/hooks/use-sellers.ts", [
    "sellerQueryKeys.publicStores",
    "Promise.all",
  ]);

  requireText("marketplace-backend/src/database/seeds/module21-e2e.seed.ts", [
    "sellerStaff, sellers",
    "upsertSellerScope",
    "current Module 4 ownership model",
  ]);

  requireText("marketplace-frontend/src/features/auth/auth.navigation.ts", [
    'user.accountType === "seller" && user.permissions.includes("seller.profile.read")',
    'return "/seller/profile"',
    'return "/seller/staff"',
    'return "/admin/sellers/suspend"',
  ]);

  requireText("marketplace-frontend/package.json", [
    '"test:module4": "vitest run tests/module4-sellers.test.tsx"',
    '"test:e2e:module4": "playwright test e2e/module4.spec.ts"',
  ]);

  requireText("marketplace-backend/.github/workflows/ci.yml", [
    "Verify Module 4 clean and upgrade migrations",
    "npm run test:module4:migrations",
    "Prepare database for Module 4 tests",
    "npm run test:module4:specs",
  ]);

  requireText("scripts/verify-module4.mjs", [
    "Dependency-free Module 2 + Module 21 + Module 3 + Module 4 structure",
    '"test:module4:migrations"',
    '"test:module4:specs"',
    "verifyLiveImplementedOpenApi",
    '"e2e/module4.spec.ts"',
    "Post-E2E database integrity",
    "Container build regression",
    "Implemented-module full release verification completed successfully.",
  ]);


  verifyFinalCleanup();
  console.log("Module 4 static release verification passed.");
}

main();

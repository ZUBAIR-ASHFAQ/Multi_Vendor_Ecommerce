import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;

/** Fails the Module 15 HTTP gate with one readable message. */
function fail(message) {
  throw new Error(`Module 15 HTTP verification failed: ${message}`);
}

/** Reads one required UTF-8 project file relative to the delivery root. */
function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

/** Requires one file to contain every HTTP/RBAC/OpenAPI marker. */
function requireText(relativePath, markers) {
  const content = read(relativePath);
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`${relativePath} is missing: ${marker}`);
  }
}

/** Rejects one unapproved HTTP fragment from a source file. */
function rejectText(relativePath, markers) {
  const content = read(relativePath);
  for (const marker of markers) {
    if (content.includes(marker)) fail(`${relativePath} must not contain: ${marker}`);
  }
}

requireText("marketplace-backend/src/modules/reviews/reviews.controller.ts", [
  "export class ReviewsController",
  "createReview = async (",
  "updateOwnReview = async (",
  "listProductReviews = async (",
  "listStoreReviews = async (",
  "markReviewHelpful = async (",
  "listAdminReviews = async (",
  "hideReview = async (",
  "publishReview = async (",
  "createReviewBodySchema.parse(request.body)",
  "reviewIdParamsSchema.parse(request.params)",
  "productReviewsParamsSchema.parse(request.params)",
  "storeReviewsParamsSchema.parse(request.params)",
  "publicReviewsListQuerySchema.parse(request.query)",
  "adminReviewsListQuerySchema.parse(request.query)",
  "moderateReviewBodySchema.parse(request.body)",
]);

rejectText("marketplace-backend/src/modules/reviews/reviews.controller.ts", [
  "ReviewsRepository",
  "withTransaction(",
  "/database/",
]);

requireText("marketplace-backend/src/modules/reviews/reviews.routes.ts", [
  "export function createReviewsRouter(",
  "export function createProductReviewsRouter(",
  "export function createStoreReviewsRouter(",
  "export function createAdminReviewsRouter(",
  'router.post(\n    "/",',
  'router.patch(\n    "/:id",',
  '"/:id/helpful"',
  '"/:productId/reviews"',
  '"/:storeId/reviews"',
  'router.get(\n    "/",',
  '"/:id/hide"',
  '"/:id/publish"',
  "router.use(authenticationMiddleware)",
  "router.use(optionalAuthenticationMiddleware)",
  "publicReviewsPermissionMiddleware",
  "requirePermission(REVIEWS_PERMISSION.CREATE_VERIFIED)",
  "requirePermission(REVIEWS_PERMISSION.UPDATE_OWN)",
  "requirePermission(REVIEWS_PERMISSION.PUBLIC_READ)",
  "requirePermission(REVIEWS_PERMISSION.ADMIN_MODERATE)",
  '"/api/v1/reviews"',
  '"/api/v1/reviews/{id}"',
  '"/api/v1/products/{productId}/reviews"',
  '"/api/v1/stores/{storeId}/reviews"',
  '"/api/v1/reviews/{id}/helpful"',
  '"/api/v1/admin/reviews"',
  '"/api/v1/admin/reviews/{id}/hide"',
  '"/api/v1/admin/reviews/{id}/publish"',
  "export const reviewsOpenApiPaths",
]);

rejectText("marketplace-backend/src/modules/reviews/reviews.routes.ts", [
  "router.delete(",
  '"/api/v1/reviews/{id}/delete"',
]);

requireText("marketplace-backend/src/app.ts", [
  "ReviewsController",
  "createReviewsRouter",
  "createProductReviewsRouter",
  "createStoreReviewsRouter",
  "createAdminReviewsRouter",
  "const reviewsController = new ReviewsController(reviewsService);",
  "reviews: createReviewsRouter(reviewsController)",
  "productReviews: createProductReviewsRouter(reviewsController)",
  "storeReviews: createStoreReviewsRouter(reviewsController)",
  "adminReviews: createAdminReviewsRouter(reviewsController)",
  'app.use(`${API_V1_PREFIX}/reviews`, reviewsRouter);',
  'app.use(`${API_V1_PREFIX}/products`, productReviewsRouter);',
  'app.use(`${API_V1_PREFIX}/stores`, storeReviewsRouter);',
  'app.use(`${API_V1_PREFIX}/admin/reviews`, adminReviewsRouter);',
]);

requireText("marketplace-backend/src/database/seeds/platform-rbac.seed.ts", [
  "REVIEWS_PERMISSION_CATALOG",
  "...REVIEWS_PERMISSION_CATALOG",
  "REVIEWS_PERMISSION.CREATE_VERIFIED",
  "REVIEWS_PERMISSION.UPDATE_OWN",
  "REVIEWS_PERMISSION.PUBLIC_READ",
]);

requireText("marketplace-backend/src/http/openapi/openapi.document.ts", [
  "reviewsOpenApiPaths",
  'name: "Reviews & Ratings"',
  "...reviewsOpenApiPaths",
]);

requireText("marketplace-backend/tests/regression/implemented-api-contracts.test.ts", [
  "reviewsOpenApiPaths",
  "locks Module 15 Reviews & Ratings to exactly the eight approved operations",
  '"/api/v1/admin/reviews": ["get"]',
]);

requireText("marketplace-backend/src/modules/reviews/index.ts", [
  'export * from "./reviews.controller.js";',
  'export * from "./reviews.routes.js";',
]);

requireText("scripts/verify-http-contracts.mjs", [
  "const IMPLEMENTED_OPERATION_COUNT = 144;",
  'name: "Module 15 Reviews & Ratings"',
  '"...reviewsOpenApiPaths"',
  '["/reviews", "reviewsRouter"]',
  '["/products", "productReviewsRouter"]',
  '["/stores", "storeReviewsRouter"]',
  '["/admin/reviews", "adminReviewsRouter"]',
]);

requireText("REQUIREMENTS_PATCH_0011_PROPOSED.md", [
  "Status: **APPROVED",
  "GET /api/v1/admin/reviews",
  "exactly **eight** business operations",
]);

console.log(
  "Module 15 HTTP/RBAC/OpenAPI verification passed: exactly eight approved operations, thin controllers, " +
    "runtime mounts, RBAC composition, and central OpenAPI registration are present.",
);

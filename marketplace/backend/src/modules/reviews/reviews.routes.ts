import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import {
  authenticationMiddleware,
  getOptionalRequestContext,
  optionalAuthenticationMiddleware,
} from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { assertPermission } from "../../common/policies/policy.js";
import { REVIEWS_PERMISSION } from "./reviews.constants.js";
import { ReviewsController } from "./reviews.controller.js";
import {
  adminReviewsListQuerySchema,
  adminReviewsListResponseSchema,
  createReviewBodySchema,
  moderateReviewBodySchema,
  productReviewsParamsSchema,
  publicReviewsListDataSchema,
  publicReviewsListQuerySchema,
  reviewIdParamsSchema,
  reviewResponseSchema,
  storeReviewsParamsSchema,
  updateReviewBodySchema,
  markReviewHelpfulResponseSchema,
} from "./reviews.schema.js";

/** Allows anonymous public Review reads and validates reviews.public.read when a bearer identity is supplied. */
function publicReviewsPermissionMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  try {
    const context = getOptionalRequestContext(response);
    if (context) assertPermission(context, REVIEWS_PERMISSION.PUBLIC_READ);
    next();
  } catch (error) {
    next(error);
  }
}

/** Creates authenticated customer/actor Review write routes. */
export function createReviewsRouter(controller: ReviewsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/",
    requirePermission(REVIEWS_PERMISSION.CREATE_VERIFIED),
    controller.createReview,
  );
  router.patch(
    "/:id",
    requirePermission(REVIEWS_PERMISSION.UPDATE_OWN),
    controller.updateOwnReview,
  );
  router.post(
    "/:id/helpful",
    requirePermission(REVIEWS_PERMISSION.PUBLIC_READ),
    controller.markReviewHelpful,
  );

  return router;
}

/** Creates the public Product Review list route without exposing customer/order identity. */
export function createProductReviewsRouter(controller: ReviewsController): Router {
  const router = Router();
  router.use(optionalAuthenticationMiddleware);
  router.use(publicReviewsPermissionMiddleware);
  router.get("/:productId/reviews", controller.listProductReviews);
  return router;
}

/** Creates the public Store Review list route backed by the Store's canonical Seller aggregate. */
export function createStoreReviewsRouter(controller: ReviewsController): Router {
  const router = Router();
  router.use(optionalAuthenticationMiddleware);
  router.use(publicReviewsPermissionMiddleware);
  router.get("/:storeId/reviews", controller.listStoreReviews);
  return router;
}

/** Creates the approved moderation queue read plus the two explicit moderation commands. */
export function createAdminReviewsRouter(controller: ReviewsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(REVIEWS_PERMISSION.ADMIN_MODERATE),
    controller.listAdminReviews,
  );
  router.post(
    "/:id/hide",
    requirePermission(REVIEWS_PERMISSION.ADMIN_MODERATE),
    controller.hideReview,
  );
  router.post(
    "/:id/publish",
    requirePermission(REVIEWS_PERMISSION.ADMIN_MODERATE),
    controller.publishReview,
  );

  return router;
}

const requestIdSchema = { type: "string", minLength: 1 } as const;

const failureSchema = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        fieldErrors: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "message"],
            properties: {
              path: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    requestId: requestIdSchema,
  },
} as const;

const paginationMetaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: PAGINATION.MAX_PAGE_SIZE },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Converts a runtime Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the stable success envelope around one non-paginated Review response. */
function success(data: object) {
  return {
    type: "object",
    required: ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      requestId: requestIdSchema,
    },
  } as const;
}

/** Builds the stable success envelope around a paginated public Review list response. */
function paginatedSuccess(data: object) {
  return {
    type: "object",
    required: ["success", "data", "meta", "requestId"],
    properties: {
      success: { const: true },
      data,
      meta: paginationMetaSchema,
      requestId: requestIdSchema,
    },
  } as const;
}

/** Wraps one validated body contract as required application/json request content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: openApiSchema(schema),
      },
    },
  } as const;
}

/** Reads one property schema from the same Zod object used by the controller. */
function objectPropertySchema(
  schema: z.ZodType,
  propertyName: string,
): Record<string, unknown> {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`OpenAPI schema does not expose object properties for ${propertyName}.`);
  }

  const property = (properties as Record<string, unknown>)[propertyName];
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    throw new Error(`OpenAPI schema is missing property ${propertyName}.`);
  }
  return property as Record<string, unknown>;
}

/** Builds one UUID path parameter from a controller-owned Zod parameter schema. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds allow-listed query parameters from the same Zod schema parsed by the controller. */
function queryParameters(schema: z.ZodType) {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query" as const,
    required: false,
    schema: property as Record<string, unknown>,
  }));
}

const reviewIdParameter = pathParameter("id", reviewIdParamsSchema);
const productIdParameter = pathParameter("productId", productReviewsParamsSchema);
const storeIdParameter = pathParameter("storeId", storeReviewsParamsSchema);

const publicFailures = {
  "401": {
    description: "A supplied bearer token was malformed or invalid.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "An authenticated actor does not hold reviews.public.read.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "The requested public Store or Review source was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Path or pagination validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Global request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const protectedFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Review permission or customer ownership check failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Review was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Review eligibility, duplicate, delivery, or lifecycle business rule conflict.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Request body or path validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Global request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const adminListFailures = {
  "401": protectedFailures["401"],
  "403": protectedFailures["403"],
  "422": {
    description: "Admin Review query validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": protectedFailures["429"],
  "500": protectedFailures["500"],
} as const;

/** Route-owned OpenAPI definitions for exactly the eight approved Module 15 operations. */
export const reviewsOpenApiPaths = {
  "/api/v1/reviews": {
    post: {
      tags: ["Reviews & Ratings"],
      summary: "Create verified-purchase Review",
      security: [{ bearerAuth: [] }],
      requestBody: body(createReviewBodySchema),
      responses: {
        "201": {
          description: "Verified-purchase Review created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reviewResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/reviews/{id}": {
    patch: {
      tags: ["Reviews & Ratings"],
      summary: "Edit own Review",
      security: [{ bearerAuth: [] }],
      parameters: [reviewIdParameter],
      requestBody: body(updateReviewBodySchema),
      responses: {
        "200": {
          description: "Owned Review updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reviewResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/products/{productId}/reviews": {
    get: {
      tags: ["Reviews & Ratings"],
      summary: "List public Product Reviews",
      description: "Returns published Reviews only, plus the current published Product rating summary.",
      parameters: [productIdParameter, ...queryParameters(publicReviewsListQuerySchema)],
      responses: {
        "200": {
          description: "Published Product Reviews returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(publicReviewsListDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/stores/{storeId}/reviews": {
    get: {
      tags: ["Reviews & Ratings"],
      summary: "List public Store Reviews",
      description: "Returns published Store Reviews plus the owning Seller's canonical rating summary.",
      parameters: [storeIdParameter, ...queryParameters(publicReviewsListQuerySchema)],
      responses: {
        "200": {
          description: "Published Store Reviews returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(publicReviewsListDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/reviews/{id}/helpful": {
    post: {
      tags: ["Reviews & Ratings"],
      summary: "Mark Review Helpful",
      security: [{ bearerAuth: [] }],
      parameters: [reviewIdParameter],
      responses: {
        "200": {
          description: "Helpful vote recorded or safely replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(markReviewHelpfulResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/reviews": {
    get: {
      tags: ["Reviews & Ratings"],
      summary: "List Reviews for moderation",
      description:
        "Returns only moderation-safe Review fields using bounded, allow-listed filters.",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminReviewsListQuerySchema),
      responses: {
        "200": {
          description: "Permission-scoped Review moderation page returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(adminReviewsListResponseSchema)),
            },
          },
        },
        ...adminListFailures,
      },
    },
  },
  "/api/v1/admin/reviews/{id}/hide": {
    post: {
      tags: ["Reviews & Ratings"],
      summary: "Hide Review",
      security: [{ bearerAuth: [] }],
      parameters: [reviewIdParameter],
      requestBody: body(moderateReviewBodySchema),
      responses: {
        "200": {
          description: "Review hidden with moderation evidence.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reviewResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/reviews/{id}/publish": {
    post: {
      tags: ["Reviews & Ratings"],
      summary: "Publish Review",
      security: [{ bearerAuth: [] }],
      parameters: [reviewIdParameter],
      requestBody: body(moderateReviewBodySchema),
      responses: {
        "200": {
          description: "Review published with moderation evidence.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reviewResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

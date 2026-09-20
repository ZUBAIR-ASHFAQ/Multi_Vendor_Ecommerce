import { Router } from "express";
import { z } from "zod";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { PAGINATION } from "../../common/constants/pagination.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  PROMOTION_ERROR_CODE,
  PROMOTION_PERMISSION,
} from "./promotions.constants.js";
import { PromotionsController } from "./promotions.controller.js";
import {
  adminPromotionListQuerySchema,
  createPlatformPromotionBodySchema,
  createSellerPromotionBodySchema,
  promotionIdParamsSchema,
  promotionListDataSchema,
  promotionResponseSchema,
  promotionValidationResponseSchema,
  updatePromotionBodySchema,
  validatePromotionQuerySchema,
} from "./promotions.schema.js";

/** Creates administrator promotion routes with route-level RBAC before service-level invariant checks. */
export function createAdminPromotionsRouter(
  controller: PromotionsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE),
    controller.listAdminPromotions,
  );
  router.post(
    "/",
    requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE),
    controller.createAdminPromotion,
  );
  router.patch(
    "/:id",
    requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE),
    controller.updateAdminPromotion,
  );
  router.post(
    "/:id/activate",
    requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE),
    controller.activateAdminPromotion,
  );
  router.post(
    "/:id/deactivate",
    requirePermission(PROMOTION_PERMISSION.ADMIN_MANAGE),
    controller.deactivateAdminPromotion,
  );

  return router;
}

/** Creates the seller promotion-creation route with explicit seller-scoped permission enforcement. */
export function createSellerPromotionsRouter(
  controller: PromotionsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/",
    requirePermission(PROMOTION_PERMISSION.SELLER_MANAGE),
    controller.createSellerPromotion,
  );

  return router;
}

/** Creates authenticated customer promotion-validation routes for the current Cart. */
export function createPromotionsRouter(
  controller: PromotionsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/validate",
    requirePermission(PROMOTION_PERMISSION.READ),
    controller.validateCoupon,
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
        code: {
          type: "string",
          enum: [
            ERROR_CODE.VALIDATION_FAILED,
            ERROR_CODE.UNAUTHENTICATED,
            ERROR_CODE.FORBIDDEN,
            ERROR_CODE.CONFLICT,
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.INTERNAL_ERROR,
            ...Object.values(PROMOTION_ERROR_CODE),
          ],
        },
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

/** Converts one Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the canonical API success envelope around one Module 9 response schema. */
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

/** Builds the canonical paginated API success envelope used by the admin promotion list. */
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

/** Wraps one Zod body contract as required application/json request content. */
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

/** Reads one object-property JSON schema from the same Zod contract used at runtime. */
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

/** Builds one required path parameter from a Zod object property. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path" as const,
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds query parameters and preserves whether each field is required by the Zod object contract. */
function queryParameters(schema: z.ZodType) {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  const required = new Set(
    Array.isArray(jsonSchema.required)
      ? jsonSchema.required.filter((item): item is string => typeof item === "string")
      : [],
  );

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query" as const,
    required: required.has(name),
    schema: property as Record<string, unknown>,
  }));
}

const promotionIdParameter = pathParameter("id", promotionIdParamsSchema);

const protectedFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required promotion permission or seller/resource scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Promotion was not found without leaking unauthorized resource existence.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Promotion/coupon lifecycle, uniqueness, usage, or scope business rule conflict.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Request validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const validationFailures = {
  "401": protectedFailures["401"],
  "403": protectedFailures["403"],
  "409": {
    description: "Coupon is invalid/inactive, usage-limited, or not eligible for the authenticated Cart scope.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": protectedFailures["422"],
  "429": protectedFailures["429"],
  "500": protectedFailures["500"],
} as const;

/** OpenAPI contract for exactly the seven approved Module 9 runtime operations. */
export const promotionsOpenApiPaths = {
  "/api/v1/admin/promotions": {
    get: {
      tags: ["Promotions & Coupons"],
      summary: "List platform promotions",
      operationId: "listAdminPromotions",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminPromotionListQuerySchema),
      responses: {
        "200": {
          description: "Paginated platform promotion list returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(promotionListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
    post: {
      tags: ["Promotions & Coupons"],
      summary: "Create platform promotion",
      operationId: "createAdminPromotion",
      description: "Owner and funding identity are derived server-side; client discount totals are never trusted.",
      security: [{ bearerAuth: [] }],
      requestBody: body(createPlatformPromotionBodySchema),
      responses: {
        "201": {
          description: "Platform promotion created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/promotions/{id}": {
    patch: {
      tags: ["Promotions & Coupons"],
      summary: "Update draft or scheduled promotion",
      operationId: "updateAdminPromotion",
      security: [{ bearerAuth: [] }],
      parameters: [promotionIdParameter],
      requestBody: body(updatePromotionBodySchema),
      responses: {
        "200": {
          description: "Editable promotion fields updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/promotions": {
    post: {
      tags: ["Promotions & Coupons"],
      summary: "Create seller-funded promotion",
      operationId: "createSellerPromotion",
      description: "Seller and funding ownership are resolved from the authenticated seller scope, never from the request body.",
      security: [{ bearerAuth: [] }],
      requestBody: body(createSellerPromotionBodySchema),
      responses: {
        "201": {
          description: "Seller-funded promotion created inside the authenticated seller scope.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/promotions/validate": {
    get: {
      tags: ["Promotions & Coupons"],
      summary: "Validate coupon against current Cart",
      operationId: "validatePromotionCoupon",
      description:
        "Returns a non-authoritative discount preview from server-derived customer/Cart context. Checkout must revalidate later.",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(validatePromotionQuerySchema),
      responses: {
        "200": {
          description: "Coupon is currently eligible and a deterministic preview allocation is returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionValidationResponseSchema)),
            },
          },
        },
        ...validationFailures,
      },
    },
  },
  "/api/v1/admin/promotions/{id}/activate": {
    post: {
      tags: ["Promotions & Coupons"],
      summary: "Activate promotion",
      operationId: "activateAdminPromotion",
      security: [{ bearerAuth: [] }],
      parameters: [promotionIdParameter],
      responses: {
        "200": {
          description: "Promotion activated after service-level invariant checks.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/promotions/{id}/deactivate": {
    post: {
      tags: ["Promotions & Coupons"],
      summary: "Deactivate promotion",
      operationId: "deactivateAdminPromotion",
      security: [{ bearerAuth: [] }],
      parameters: [promotionIdParameter],
      responses: {
        "200": {
          description: "Promotion deactivated without deleting historical records.",
          content: {
            "application/json": {
              schema: success(openApiSchema(promotionResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

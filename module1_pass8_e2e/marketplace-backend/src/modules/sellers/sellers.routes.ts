import { Router } from "express";
import { z } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { SELLER_PERMISSION } from "./sellers.constants.js";
import { SellersController } from "./sellers.controller.js";
import {
  adminSellerApplicationListQuerySchema,
  adminSellerIdParamsSchema,
  approveSellerApplicationResponseSchema,
  createStoreBodySchema,
  mySellerResponseSchema,
  publicStoreResponseSchema,
  publicStoreSlugParamsSchema,
  rejectSellerApplicationBodySchema,
  sellerApplicationIdParamsSchema,
  sellerApplicationResponseSchema,
  sellerResponseSchema,
  sellerStoreIdParamsSchema,
  sellerStoreResponseSchema,
  submitSellerApplicationBodySchema,
  suspendSellerBodySchema,
  updateSellerProfileBodySchema,
  updateStoreBodySchema,
} from "./sellers.schema.js";

/** Creates authenticated seller self-service and seller-application routes. */
export function createSellersRouter(controller: SellersController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post("/applications", controller.submitApplication);
  router.get(
    "/me",
    requirePermission(SELLER_PERMISSION.PROFILE_READ),
    controller.getMySeller,
  );
  router.patch(
    "/me",
    requirePermission(SELLER_PERMISSION.PROFILE_MANAGE),
    controller.updateMySeller,
  );
  router.post(
    "/me/stores",
    requirePermission(SELLER_PERMISSION.STORE_MANAGE),
    controller.createStore,
  );
  router.patch(
    "/me/stores/:id",
    requirePermission(SELLER_PERMISSION.STORE_MANAGE),
    controller.updateStore,
  );

  return router;
}

/** Creates the one public store-detail route without authentication middleware. */
export function createPublicStoresRouter(controller: SellersController): Router {
  const router = Router();
  router.get("/:slug", controller.getPublicStore);
  return router;
}

/** Creates administrator seller-application review routes with coarse route-level RBAC. */
export function createAdminSellerApplicationsRouter(
  controller: SellersController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(SELLER_PERMISSION.ADMIN_REVIEW),
    controller.listApplications,
  );
  router.post(
    "/:id/approve",
    requirePermission(SELLER_PERMISSION.ADMIN_REVIEW),
    controller.approveApplication,
  );
  router.post(
    "/:id/reject",
    requirePermission(SELLER_PERMISSION.ADMIN_REVIEW),
    controller.rejectApplication,
  );

  return router;
}

/** Creates the explicit privileged seller suspension command route. */
export function createAdminSellersRouter(controller: SellersController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/:id/suspend",
    requirePermission(SELLER_PERMISSION.ADMIN_SUSPEND),
    controller.suspendSeller,
  );

  return router;
}

const requestId = { type: "string", minLength: 1 } as const;

const failure = {
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
    requestId,
  },
} as const;

const paginationMeta = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: PAGINATION.MAX_PAGE_SIZE },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Converts one Zod contract into the OpenAPI 3.1-compatible JSON Schema used by this module. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the standard success envelope used by Module 4 OpenAPI operations. */
function success(data: object, paginated = false) {
  return {
    type: "object",
    required: paginated
      ? ["success", "data", "meta", "requestId"]
      : ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      ...(paginated ? { meta: paginationMeta } : {}),
      requestId,
    },
  } as const;
}

/** Wraps one JSON schema as a required application/json request body. */
function body(schema: object) {
  return {
    required: true,
    content: { "application/json": { schema } },
  } as const;
}

/** Wraps one JSON schema as an optional application/json request body. */
function optionalBody(schema: object) {
  return {
    required: false,
    content: { "application/json": { schema } },
  } as const;
}

/** Reads one property schema from a Zod object contract for an OpenAPI parameter. */
function objectPropertySchema(
  schema: z.ZodType,
  propertyName: string,
): Record<string, unknown> {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    throw new Error(
      `OpenAPI schema does not expose object properties for ${propertyName}.`,
    );
  }

  const property = (properties as Record<string, unknown>)[propertyName];
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    throw new Error(`OpenAPI schema is missing property ${propertyName}.`);
  }

  return property as Record<string, unknown>;
}

/** Builds one OpenAPI path parameter from the same Zod contract used by the controller. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds one optional OpenAPI query parameter from the controller's Zod query contract. */
function queryParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "query",
    schema: objectPropertySchema(schema, name),
  } as const;
}

const sellerApplicationIdPathParameter = pathParameter(
  "id",
  sellerApplicationIdParamsSchema,
);
const sellerStoreIdPathParameter = pathParameter("id", sellerStoreIdParamsSchema);
const adminSellerIdPathParameter = pathParameter("id", adminSellerIdParamsSchema);
const slugPathParameter = pathParameter("slug", publicStoreSlugParamsSchema);
const sellerApplicationListParameters = [
  queryParameter("page", adminSellerApplicationListQuerySchema),
  queryParameter("pageSize", adminSellerApplicationListQuerySchema),
  queryParameter("status", adminSellerApplicationListQuerySchema),
  queryParameter("sort", adminSellerApplicationListQuerySchema),
] as const;

const baseFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Required permission or seller/store scope denied.",
    content: { "application/json": { schema: failure } },
  },
  "422": {
    description: "Request validation failed.",
    content: { "application/json": { schema: failure } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failure } },
  },
  "500": {
    description: "Unexpected server error with a safe public message.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const requestBodyFailures = {
  "400": {
    description: "Request body or business input is invalid.",
    content: { "application/json": { schema: failure } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP body limit.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const notFoundFailure = {
  "404": {
    description:
      "Seller, store or application was not found or is safely hidden by scope policy.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const conflictFailure = {
  "409": {
    description:
      "Seller/application/store lifecycle or unique-slug state conflicts with the command.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const submitApplicationRequest = openApiSchema(submitSellerApplicationBodySchema);
const sellerApplication = openApiSchema(sellerApplicationResponseSchema);
const approveApplicationResponse = openApiSchema(
  approveSellerApplicationResponseSchema,
);
const rejectApplicationRequest = openApiSchema(rejectSellerApplicationBodySchema);
const seller = openApiSchema(sellerResponseSchema);
const updateSellerRequest = openApiSchema(updateSellerProfileBodySchema);
const mySeller = openApiSchema(mySellerResponseSchema);
const createStoreRequest = openApiSchema(createStoreBodySchema);
const sellerStore = openApiSchema(sellerStoreResponseSchema);
const publicStore = openApiSchema(publicStoreResponseSchema);
const updateStoreRequest = openApiSchema(updateStoreBodySchema);
const suspendSellerRequest = openApiSchema(suspendSellerBodySchema);

/** Route-owned OpenAPI definitions for exactly the ten approved Module 4 operations. */
export const sellersOpenApiPaths = {
  "/api/v1/sellers/applications": {
    post: {
      tags: ["Sellers"],
      summary: "Submit seller application",
      operationId: "submitSellerApplication",
      description:
        "Creates one submitted seller application for the authenticated customer. " +
        "Actor identity and review state are server-derived.",
      security: [{ bearerAuth: [] }],
      requestBody: body(submitApplicationRequest),
      responses: {
        "201": {
          description: "Seller application submitted.",
          content: { "application/json": { schema: success(sellerApplication) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/admin/seller-applications": {
    get: {
      tags: ["Sellers"],
      summary: "List seller applications",
      operationId: "listSellerApplications",
      description: "Requires admin.sellers.review and returns a bounded review queue.",
      security: [{ bearerAuth: [] }],
      parameters: sellerApplicationListParameters,
      responses: {
        "200": {
          description: "Seller application page.",
          content: {
            "application/json": {
              schema: success({ type: "array", items: sellerApplication }, true),
            },
          },
        },
        ...baseFailures,
      },
    },
  },
  "/api/v1/admin/seller-applications/{id}/approve": {
    post: {
      tags: ["Sellers"],
      summary: "Approve seller application",
      operationId: "approveSellerApplication",
      description:
        "Requires admin.sellers.review. Approval atomically creates the seller owner " +
        "identity and seller scope from the submitted application.",
      security: [{ bearerAuth: [] }],
      parameters: [sellerApplicationIdPathParameter],
      responses: {
        "200": {
          description: "Seller application approved and seller master created.",
          content: {
            "application/json": {
              schema: success(approveApplicationResponse),
            },
          },
        },
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/admin/seller-applications/{id}/reject": {
    post: {
      tags: ["Sellers"],
      summary: "Reject seller application",
      operationId: "rejectSellerApplication",
      description:
        "Requires admin.sellers.review and preserves the validated rejection reason.",
      security: [{ bearerAuth: [] }],
      parameters: [sellerApplicationIdPathParameter],
      requestBody: body(rejectApplicationRequest),
      responses: {
        "200": {
          description: "Seller application rejected.",
          content: { "application/json": { schema: success(sellerApplication) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/sellers/me": {
    get: {
      tags: ["Sellers"],
      summary: "Read current seller",
      operationId: "getMySeller",
      description:
        "Requires seller.profile.read inside one active server-derived seller scope.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Current seller aggregate.",
          content: { "application/json": { schema: success(mySeller) } },
        },
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
    patch: {
      tags: ["Sellers"],
      summary: "Update current seller",
      operationId: "updateMySeller",
      description:
        "Requires seller.profile.manage. Ownership, approval and lifecycle status remain server-controlled.",
      security: [{ bearerAuth: [] }],
      requestBody: body(updateSellerRequest),
      responses: {
        "200": {
          description: "Seller profile updated.",
          content: { "application/json": { schema: success(seller) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/sellers/me/stores": {
    post: {
      tags: ["Sellers"],
      summary: "Create store",
      operationId: "createSellerStore",
      description:
        "Requires seller.store.manage inside the current active approved seller scope.",
      security: [{ bearerAuth: [] }],
      requestBody: body(createStoreRequest),
      responses: {
        "201": {
          description: "Seller store created.",
          content: { "application/json": { schema: success(sellerStore) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/stores/{slug}": {
    get: {
      tags: ["Sellers"],
      summary: "Read public store",
      operationId: "getPublicStore",
      description:
        "Returns public-safe fields only for an active store owned by an active approved seller.",
      parameters: [slugPathParameter],
      responses: {
        "200": {
          description: "Public store detail.",
          content: { "application/json": { schema: success(publicStore) } },
        },
        "404": notFoundFailure["404"],
        "422": baseFailures["422"],
        "429": baseFailures["429"],
        "500": baseFailures["500"],
      },
    },
  },
  "/api/v1/sellers/me/stores/{id}": {
    patch: {
      tags: ["Sellers"],
      summary: "Update store",
      operationId: "updateSellerStore",
      description:
        "Requires seller.store.manage. Sellers may update normal store fields and switch " +
        "between active/inactive; suspended remains an administrator-controlled state.",
      security: [{ bearerAuth: [] }],
      parameters: [sellerStoreIdPathParameter],
      requestBody: body(updateStoreRequest),
      responses: {
        "200": {
          description: "Seller store updated.",
          content: { "application/json": { schema: success(sellerStore) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...notFoundFailure,
        ...conflictFailure,
      },
    },
  },
  "/api/v1/admin/sellers/{id}/suspend": {
    post: {
      tags: ["Sellers"],
      summary: "Suspend seller",
      operationId: "suspendSeller",
      description:
        "Requires admin.sellers.suspend and preserves seller/store history while stopping active commerce.",
      security: [{ bearerAuth: [] }],
      parameters: [adminSellerIdPathParameter],
      requestBody: optionalBody(suspendSellerRequest),
      responses: {
        "200": {
          description: "Seller suspended or already suspended idempotently.",
          content: { "application/json": { schema: success(seller) } },
        },
        ...requestBodyFailures,
        ...baseFailures,
        ...notFoundFailure,
      },
    },
  },
} as const;


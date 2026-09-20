import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import {
  RETURNS_ERROR_CODE,
  RETURNS_PERMISSION,
} from "./returns-refunds.constants.js";
import { ReturnsRefundsController } from "./returns-refunds.controller.js";
import {
  adminReturnListQuerySchema,
  approveReturnBodySchema,
  createReturnRequestBodySchema,
  customerReturnListQuerySchema,
  issueReturnRefundBodySchema,
  receiveReturnBodySchema,
  rejectReturnBodySchema,
  returnOrderIdParamsSchema,
  returnRefundIdempotencyHeadersSchema,
  returnRefundResultSchema,
  returnRequestIdParamsSchema,
  returnRequestResponseSchema,
  sellerReturnListQuerySchema,
} from "./returns-refunds.schema.js";

/** Creates the customer Order Return command router mounted at /api/v1/orders. */
export function createOrderReturnsRouter(controller: ReturnsRefundsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.post(
    "/:orderId/returns",
    requirePermission(RETURNS_PERMISSION.CREATE_OWN),
    controller.createReturnRequest,
  );
  return router;
}

/** Creates customer Return reads and the privileged refund command mounted at /api/v1/returns. */
export function createReturnsRouter(controller: ReturnsRefundsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get(
    "/",
    requirePermission(RETURNS_PERMISSION.READ_OWN),
    controller.listCustomerReturns,
  );
  router.post(
    "/:id/refund",
    requirePermission(RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE),
    controller.issueRefund,
  );
  return router;
}

/** Creates seller-scoped Return queue and lifecycle commands mounted at /api/v1/seller/returns. */
export function createSellerReturnsRouter(controller: ReturnsRefundsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get(
    "/",
    requirePermission(RETURNS_PERMISSION.SELLER_MANAGE),
    controller.listSellerReturns,
  );
  router.post(
    "/:id/approve",
    requirePermission(RETURNS_PERMISSION.SELLER_MANAGE),
    controller.approveReturn,
  );
  router.post(
    "/:id/reject",
    requirePermission(RETURNS_PERMISSION.SELLER_MANAGE),
    controller.rejectReturn,
  );
  router.post(
    "/:id/receive",
    requirePermission(RETURNS_PERMISSION.SELLER_MANAGE),
    controller.receiveReturn,
  );
  return router;
}

/** Creates privileged Return search mounted at /api/v1/admin/returns. */
export function createAdminReturnsRouter(controller: ReturnsRefundsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get(
    "/",
    requirePermission(RETURNS_PERMISSION.ADMIN_MANAGE),
    controller.listAdminReturns,
  );
  return router;
}

const requestIdSchema = { type: "string", minLength: 1 } as const;
const paginationMetaSchema = {
  type: "object",
  required: ["page", "pageSize", "totalItems", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Converts one runtime Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
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

/** Builds query parameters while preserving whether each Zod field is required. */
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

/** Builds the required Idempotency-Key header from the runtime refund header contract. */
function idempotencyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(returnRefundIdempotencyHeadersSchema, "idempotency-key"),
  } as const;
}

/** Wraps one strict Return command body as required JSON content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": { schema: openApiSchema(schema) },
    },
  } as const;
}

/** Builds the canonical success envelope around one Module 14 response schema. */
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

/** Builds the canonical paginated success envelope used by Return list routes. */
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
            ERROR_CODE.INVALID_REQUEST,
            ERROR_CODE.UNAUTHENTICATED,
            ERROR_CODE.FORBIDDEN,
            ERROR_CODE.RESOURCE_NOT_FOUND,
            ERROR_CODE.CONFLICT,
            ERROR_CODE.IDEMPOTENCY_CONFLICT,
            ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.PAYLOAD_TOO_LARGE,
            ERROR_CODE.INTERNAL_ERROR,
            ERROR_CODE.SERVICE_UNAVAILABLE,
            ...Object.values(RETURNS_ERROR_CODE),
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

const protectedFailures = {
  "400": {
    description: "Malformed Returns/Refunds request was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Return permission or customer/seller scope was denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Requested Order or Return resource was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Return eligibility, lifecycle, quantity, refund, or idempotency state conflicts with the request.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Return path, query, header, or body validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Return/refund consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "A required Return/refund dependency is temporarily unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const orderIdParameter = pathParameter("orderId", returnOrderIdParamsSchema);
const returnIdParameter = pathParameter("id", returnRequestIdParamsSchema);
const refundIdempotencyHeader = idempotencyHeaderParameter();
const returnListDataSchema = {
  type: "array",
  items: openApiSchema(returnRequestResponseSchema),
} as const;

/** OpenAPI contract for exactly the eight approved Module 14 operations. */
export const returnsRefundsOpenApiPaths = {
  "/api/v1/orders/{orderId}/returns": {
    post: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Create a customer Return Request",
      operationId: "createReturnRequest",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter],
      requestBody: body(createReturnRequestBodySchema),
      responses: {
        "201": {
          description: "Eligible Return Request created with append-only lifecycle history.",
          content: {
            "application/json": {
              schema: success(openApiSchema(returnRequestResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/returns": {
    get: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "List the customer's Return Requests",
      operationId: "listCustomerReturns",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(customerReturnListQuerySchema),
      responses: {
        "200": {
          description: "Customer-owned Return Requests returned with append-only lifecycle history.",
          content: {
            "application/json": {
              schema: paginatedSuccess(returnListDataSchema),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/returns": {
    get: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "List seller-scoped Return Requests",
      operationId: "listSellerReturns",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerReturnListQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Return Requests returned with append-only lifecycle history.",
          content: {
            "application/json": {
              schema: paginatedSuccess(returnListDataSchema),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/returns/{id}/approve": {
    post: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Approve a requested Return",
      operationId: "approveReturn",
      security: [{ bearerAuth: [] }],
      parameters: [returnIdParameter],
      requestBody: body(approveReturnBodySchema),
      responses: {
        "200": {
          description: "Return approved inside the seller scope with lifecycle history.",
          content: {
            "application/json": {
              schema: success(openApiSchema(returnRequestResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/returns/{id}/reject": {
    post: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Reject a requested Return",
      operationId: "rejectReturn",
      security: [{ bearerAuth: [] }],
      parameters: [returnIdParameter],
      requestBody: body(rejectReturnBodySchema),
      responses: {
        "200": {
          description: "Return rejected, allocation released logically, and lifecycle history returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(returnRequestResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/returns/{id}/receive": {
    post: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Receive and inspect an approved Return",
      operationId: "receiveReturn",
      security: [{ bearerAuth: [] }],
      parameters: [returnIdParameter],
      requestBody: body(receiveReturnBodySchema),
      responses: {
        "200": {
          description: "All Return Items inspected; the received Return includes lifecycle history.",
          content: {
            "application/json": {
              schema: success(openApiSchema(returnRequestResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/returns/{id}/refund": {
    post: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Issue an idempotent provider Return refund",
      operationId: "issueReturnRefund",
      security: [{ bearerAuth: [] }],
      parameters: [returnIdParameter, refundIdempotencyHeader],
      requestBody: body(issueReturnRefundBodySchema),
      responses: {
        "200": {
          description: "Provider refund completed or exact idempotent replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(returnRefundResultSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/returns": {
    get: {
      tags: ["Returns, Refunds & Disputes"],
      summary: "Search Return Requests for platform support",
      operationId: "listAdminReturns",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminReturnListQuerySchema),
      responses: {
        "200": {
          description: "Authorized platform Return results returned with append-only lifecycle history.",
          content: {
            "application/json": {
              schema: paginatedSuccess(returnListDataSchema),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

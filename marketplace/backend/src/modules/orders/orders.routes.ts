import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { internalServiceMiddleware } from "../../common/middleware/internal-service.middleware.js";
import { ORDERS_ERROR_CODE, ORDERS_PERMISSION } from "./orders.constants.js";
import { OrdersController } from "./orders.controller.js";
import {
  adminOrderListDataSchema,
  adminOrderListQuerySchema,
  cancelOrderBodySchema,
  customerOrderDetailSchema,
  customerOrderListDataSchema,
  customerOrderListQuerySchema,
  orderCancelHeadersSchema,
  orderIdParamsSchema,
  paymentConfirmedBodySchema,
  sellerOrderDetailSchema,
  sellerOrderIdParamsSchema,
  sellerOrderListDataSchema,
  sellerOrderListQuerySchema,
} from "./orders.schema.js";

/** Creates the authenticated customer Order history/detail/cancellation routes. */
export function createCustomerOrdersRouter(controller: OrdersController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(ORDERS_PERMISSION.READ_OWN),
    controller.listCustomerOrders,
  );
  router.get(
    "/:id",
    requirePermission(ORDERS_PERMISSION.READ_OWN),
    controller.getCustomerOrder,
  );
  router.post(
    "/:id/cancel",
    requirePermission(ORDERS_PERMISSION.READ_OWN),
    controller.cancelCustomerOrder,
  );

  return router;
}

/** Creates the authenticated seller-scoped Seller Order queue/detail/acceptance routes. */
export function createSellerOrdersRouter(controller: OrdersController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(ORDERS_PERMISSION.SELLER_READ),
    controller.listSellerOrders,
  );
  router.get(
    "/:id",
    requirePermission(ORDERS_PERMISSION.SELLER_READ),
    controller.getSellerOrder,
  );
  router.post(
    "/:id/accept",
    requirePermission(ORDERS_PERMISSION.SELLER_MANAGE),
    controller.acceptSellerOrder,
  );

  return router;
}

/** Creates the privileged platform Order search and cancellation routes. */
export function createAdminOrdersRouter(controller: OrdersController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(ORDERS_PERMISSION.ADMIN_READ),
    controller.listAdminOrders,
  );
  router.post(
    "/:id/cancel",
    requirePermission(ORDERS_PERMISSION.ADMIN_CANCEL),
    controller.cancelAdminOrder,
  );

  return router;
}

/** Creates the trusted internal Payment-confirmed transition route for the later Payments module. */
export function createInternalOrdersRouter(controller: OrdersController): Router {
  const router = Router();
  router.use(internalServiceMiddleware);
  router.post("/:id/payment-confirmed", controller.confirmPayment);
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

/** Converts one runtime Zod contract to the OpenAPI 3.1 JSON Schema shape. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the stable success envelope around one Order response schema. */
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

/** Builds the stable paginated success envelope around one Order list response schema. */
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

/** Wraps one strict Zod body contract as required application/json content. */
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

/** Reads one property JSON schema from the same Zod object parsed at runtime. */
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

/** Converts one Zod query object into allow-listed optional OpenAPI query parameters. */
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

/** Builds the required cancellation Idempotency-Key header from the runtime Zod contract. */
function idempotencyKeyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(orderCancelHeadersSchema, "idempotency-key"),
    description: "Actor-scoped cancellation retry key. Exact completed retries replay the same Order response.",
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
            ERROR_CODE.SERVICE_UNAVAILABLE,
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.INTERNAL_ERROR,
            ...Object.values(ORDERS_ERROR_CODE),
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
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Orders permission or customer/seller resource scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Order resource was not found without leaking another actor's private resource.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Order lifecycle, cancellation, source replay, or idempotency business rule conflict.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Path, query, body, or required cancellation-header validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or data-consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const internalFailures = {
  "401": {
    description: "Valid internal service authentication is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Order was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Payment-confirmed source or Order lifecycle state conflicts with the trusted command.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Trusted Payment-confirmed request validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Internal service authentication is not configured.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or data-consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const orderIdParameter = pathParameter("id", orderIdParamsSchema);
const sellerOrderIdParameter = pathParameter("id", sellerOrderIdParamsSchema);
const cancellationIdempotencyHeader = idempotencyKeyHeaderParameter();

/** Live OpenAPI contract for exactly the nine approved Module 11 Order operations. */
export const ordersOpenApiPaths = {
  "/api/v1/orders": {
    get: {
      tags: ["Orders"],
      summary: "List the authenticated customer's Orders",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(customerOrderListQuerySchema),
      responses: {
        "200": {
          description: "Customer-owned Order history returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(customerOrderListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/orders/{id}": {
    get: {
      tags: ["Orders"],
      summary: "Read one customer-owned Order",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter],
      responses: {
        "200": {
          description: "Customer-owned immutable Order detail returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(customerOrderDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/orders": {
    get: {
      tags: ["Orders"],
      summary: "List Seller Orders in the actor's seller/store scope",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerOrderListQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Order queue returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerOrderListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/orders/{id}": {
    get: {
      tags: ["Orders"],
      summary: "Read one Seller Order in the actor's scope",
      security: [{ bearerAuth: [] }],
      parameters: [sellerOrderIdParameter],
      responses: {
        "200": {
          description: "Seller-scoped Order detail returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerOrderDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/orders/{id}/accept": {
    post: {
      tags: ["Orders"],
      summary: "Accept one paid Seller Order",
      security: [{ bearerAuth: [] }],
      parameters: [sellerOrderIdParameter],
      responses: {
        "200": {
          description: "Seller Order accepted, or an exact already-processing retry returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerOrderDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/orders/{id}/cancel": {
    post: {
      tags: ["Orders"],
      summary: "Cancel eligible quantities from the customer's own pre-capture Order",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter, cancellationIdempotencyHeader],
      requestBody: body(cancelOrderBodySchema),
      responses: {
        "200": {
          description: "Cancellation applied or exact idempotent retry replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(customerOrderDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/orders/{id}/cancel": {
    post: {
      tags: ["Orders"],
      summary: "Cancel eligible quantities through the privileged admin command",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter, cancellationIdempotencyHeader],
      requestBody: body(cancelOrderBodySchema),
      responses: {
        "200": {
          description: "Privileged cancellation applied or exact idempotent retry replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(customerOrderDetailSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/orders": {
    get: {
      tags: ["Orders"],
      summary: "Search Customer Orders for authorized support/admin actors",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminOrderListQuerySchema),
      responses: {
        "200": {
          description: "Permission-scoped admin Order search returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(adminOrderListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/internal/orders/{id}/payment-confirmed": {
    post: {
      tags: ["Orders"],
      summary: "Apply the trusted provider-authoritative Payment-confirmed transition",
      security: [{ internalApiKey: [] }],
      parameters: [orderIdParameter],
      requestBody: body(paymentConfirmedBodySchema),
      responses: {
        "200": {
          description: "Payment confirmation applied exactly once or replayed safely.",
          content: {
            "application/json": {
              schema: success(openApiSchema(customerOrderDetailSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
} as const;

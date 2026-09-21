import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../common/middleware/authorization.middleware.js";
import { CUSTOMER_ERROR_CODE } from "../customers/customers.constants.js";
import {
  SHIPPING_ERROR_CODE,
  SHIPPING_PERMISSION,
} from "./shipping.constants.js";
import { ShippingController } from "./shipping.controller.js";
import {
  createShipmentBodySchema,
  createShipmentParamsSchema,
  orderShipmentsParamsSchema,
  orderShipmentsResponseSchema,
  sellerShipmentListDataSchema,
  sellerShipmentListQuerySchema,
  sellerShipmentResponseSchema,
  shipmentIdempotencyHeadersSchema,
  shipmentIdParamsSchema,
  shippingOptionsQuerySchema,
  shippingOptionsResponseSchema,
  updateShipmentTrackingBodySchema,
} from "./shipping.schema.js";

/** Creates the Checkout Shipping Configuration router mounted at /api/v1/checkout. */
export function createShippingRouter(controller: ShippingController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get("/shipping-options", controller.getCheckoutShippingOptions);
  return router;
}

/** Creates seller-scoped Shipment list and fulfillment command routes mounted at /api/v1/seller. */
export function createSellerShippingRouter(controller: ShippingController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/shipments",
    requirePermission(SHIPPING_PERMISSION.SELLER_READ),
    controller.listSellerShipments,
  );
  router.post(
    "/orders/:sellerOrderId/shipments",
    requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE),
    controller.createShipment,
  );
  router.patch(
    "/shipments/:id/tracking",
    requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE),
    controller.updateShipmentTracking,
  );
  router.post(
    "/shipments/:id/mark-shipped",
    requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE),
    controller.markShipmentShipped,
  );
  router.post(
    "/shipments/:id/mark-delivered",
    requirePermission(SHIPPING_PERMISSION.SELLER_MANAGE),
    controller.markShipmentDelivered,
  );

  return router;
}

/** Creates customer/admin-safe Order Shipment tracking mounted at /api/v1/orders. */
export function createOrderShippingRouter(controller: ShippingController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get(
    "/:orderId/shipments",
    requireAnyPermission(
      SHIPPING_PERMISSION.READ_OWN_ORDER,
      SHIPPING_PERMISSION.ADMIN_READ,
    ),
    controller.getOrderShipments,
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

/** Builds the required Idempotency-Key header from the runtime header contract. */
function idempotencyHeaderParameter() {
  return {
    name: "Idempotency-Key",
    in: "header" as const,
    required: true,
    schema: objectPropertySchema(shipmentIdempotencyHeadersSchema, "idempotency-key"),
  } as const;
}

/** Wraps one strict Shipping Zod body contract as required JSON content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": { schema: openApiSchema(schema) },
    },
  } as const;
}

/** Builds the canonical API success envelope around one Shipping response schema. */
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

/** Builds the canonical paginated success envelope around the seller Shipment list. */
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
            ...Object.values(CUSTOMER_ERROR_CODE),
            ...Object.values(SHIPPING_ERROR_CODE),
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
    description: "Malformed Shipping request was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Shipping permission or seller/customer scope was denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Requested Shipment, Order tracking, customer, or address resource was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Shipment quantity, lifecycle, tracking, Inventory issue, or idempotency state conflicts with the request.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Shipping path, query, header, or body validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Shipping consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "A required Shipping dependency is temporarily unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const sellerOrderIdParameter = pathParameter("sellerOrderId", createShipmentParamsSchema);
const shipmentIdParameter = pathParameter("id", shipmentIdParamsSchema);
const orderIdParameter = pathParameter("orderId", orderShipmentsParamsSchema);
const idempotencyHeader = idempotencyHeaderParameter();

/** OpenAPI contract for exactly the seven approved Module 13 Shipping operations. */
export const shippingOpenApiPaths = {
  "/api/v1/checkout/shipping-options": {
    get: {
      tags: ["Shipping & Fulfillment"],
      summary: "Calculate eligible Checkout shipping options",
      operationId: "getCheckoutShippingOptions",
      description: [
        "Derives store/seller shipment groups from the authenticated customer's Cart or Buy Now item",
        "and returns active flat-rate methods for the owned active address and authoritative item currency.",
      ].join(" "),
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(shippingOptionsQuerySchema),
      responses: {
        "200": {
          description: "Eligible shipping options returned for every current Checkout store group.",
          content: {
            "application/json": {
              schema: success(openApiSchema(shippingOptionsResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/shipments": {
    get: {
      tags: ["Shipping & Fulfillment"],
      summary: "List seller-scoped Shipments",
      operationId: "listSellerShipments",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerShipmentListQuerySchema),
      responses: {
        "200": {
          description: "Seller-visible Shipments returned with immutable items and status timeline.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerShipmentListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/orders/{sellerOrderId}/shipments": {
    post: {
      tags: ["Shipping & Fulfillment"],
      summary: "Create a Shipment allocation",
      operationId: "createShipment",
      security: [{ bearerAuth: [] }],
      parameters: [sellerOrderIdParameter, idempotencyHeader],
      requestBody: body(createShipmentBodySchema),
      responses: {
        "201": {
          description: "Shipment allocation created or exact idempotent replay returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerShipmentResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/shipments/{id}/tracking": {
    patch: {
      tags: ["Shipping & Fulfillment"],
      summary: "Set or correct Shipment tracking",
      operationId: "updateShipmentTracking",
      security: [{ bearerAuth: [] }],
      parameters: [shipmentIdParameter],
      requestBody: body(updateShipmentTrackingBodySchema),
      responses: {
        "200": {
          description: "Tracking values saved, corrected, or returned unchanged for an exact-value retry.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerShipmentResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/shipments/{id}/mark-shipped": {
    post: {
      tags: ["Shipping & Fulfillment"],
      summary: "Mark Shipment shipped and issue Inventory",
      operationId: "markShipmentShipped",
      security: [{ bearerAuth: [] }],
      parameters: [shipmentIdParameter, idempotencyHeader],
      responses: {
        "200": {
          description: "Shipment moved to shipped and committed Inventory was issued exactly once.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerShipmentResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/shipments/{id}/mark-delivered": {
    post: {
      tags: ["Shipping & Fulfillment"],
      summary: "Mark Shipment delivered",
      operationId: "markShipmentDelivered",
      security: [{ bearerAuth: [] }],
      parameters: [shipmentIdParameter, idempotencyHeader],
      responses: {
        "200": {
          description: "Shipment moved from shipped to delivered using the server delivery timestamp.",
          content: {
            "application/json": {
              schema: success(openApiSchema(sellerShipmentResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/orders/{orderId}/shipments": {
    get: {
      tags: ["Shipping & Fulfillment"],
      summary: "Read customer-safe Order Shipment tracking",
      operationId: "getOrderShipments",
      security: [{ bearerAuth: [] }],
      parameters: [orderIdParameter],
      responses: {
        "200": {
          description: "Shipped/delivered customer-safe tracking returned for an owned or authorized Order.",
          content: {
            "application/json": {
              schema: success(openApiSchema(orderShipmentsResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

import { Router } from "express";
import { z } from "zod";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { internalServiceMiddleware } from "../../common/middleware/internal-service.middleware.js";
import { INVENTORY_PERMISSION } from "./inventory.constants.js";
import { InventoryController } from "./inventory.controller.js";
import {
  adjustStockBodySchema,
  inventoryItemResponseSchema,
  inventoryVariantParamsSchema,
  releaseStockBodySchema,
  reserveStockBodySchema,
  sellerInventoryListDataSchema,
  sellerInventoryListQuerySchema,
  shipStockBodySchema,
  stockMovementListDataSchema,
  stockMovementListQuerySchema,
  stockReservationResponseSchema,
  updateReorderLevelBodySchema,
} from "./inventory.schema.js";

/** Creates seller Inventory routes with authentication, RBAC, and service-level ownership checks. */
export function createSellerInventoryRouter(controller: InventoryController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(INVENTORY_PERMISSION.READ),
    controller.listSellerInventory,
  );
  router.get(
    "/:variantId/movements",
    requirePermission(INVENTORY_PERMISSION.READ),
    controller.listStockMovements,
  );
  router.post(
    "/:variantId/adjust",
    requirePermission(INVENTORY_PERMISSION.ADJUST),
    controller.adjustStock,
  );
  router.patch(
    "/:variantId/reorder-level",
    requirePermission(INVENTORY_PERMISSION.REORDER_MANAGE),
    controller.updateReorderLevel,
  );

  return router;
}

/** Creates trusted internal Inventory command routes that are not authenticated as end users. */
export function createInternalInventoryRouter(controller: InventoryController): Router {
  const router = Router();
  router.use(internalServiceMiddleware);
  router.post("/reserve", controller.reserveStock);
  router.post("/release", controller.releaseStock);
  router.post("/ship", controller.shipStock);
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
    pageSize: { type: "integer", minimum: 1 },
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

/** Builds the canonical success envelope around one Inventory response schema. */
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

/** Builds the canonical paginated success envelope used by Inventory list endpoints. */
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

/** Reads one object property schema from the same Zod contract parsed by the controller. */
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

/** Builds one path parameter from a Zod object property. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Builds optional/defaulted Inventory query parameters from the controller-owned Zod schema. */
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

const variantIdParameter = pathParameter("variantId", inventoryVariantParamsSchema);

const sellerFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Inventory permission or seller/store resource scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Inventory or Product variant was not found in the allowed seller scope.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Inventory quantity or stock-source business rule conflict.",
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

const internalFailures = {
  "401": {
    description: "Trusted internal service authentication is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Inventory or reservation was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Insufficient stock, duplicate source, or reservation state conflict.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Internal command validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Internal service authentication is not configured.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

/** Route-owned OpenAPI security component for trusted internal Inventory commands. */
export const inventoryOpenApiComponents = {
  securitySchemes: {
    internalApiKey: {
      type: "apiKey",
      in: "header",
      name: "X-Internal-API-Key",
      description: "Separate secret used only by trusted server-to-server internal commands.",
    },
  },
} as const;

/** Route-owned OpenAPI definitions for the complete required Module 7 HTTP surface. */
export const inventoryOpenApiPaths = {
  "/api/v1/seller/inventory": {
    get: {
      tags: ["Inventory"],
      summary: "List seller Inventory",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerInventoryListQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Inventory returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerInventoryListDataSchema)),
            },
          },
        },
        ...sellerFailures,
      },
    },
  },
  "/api/v1/seller/inventory/{variantId}/movements": {
    get: {
      tags: ["Inventory"],
      summary: "List variant stock movements",
      security: [{ bearerAuth: [] }],
      parameters: [
        variantIdParameter,
        ...queryParameters(stockMovementListQuerySchema),
      ],
      responses: {
        "200": {
          description: "Immutable stock movement history returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(stockMovementListDataSchema)),
            },
          },
        },
        ...sellerFailures,
      },
    },
  },
  "/api/v1/seller/inventory/{variantId}/adjust": {
    post: {
      tags: ["Inventory"],
      summary: "Adjust seller stock",
      security: [{ bearerAuth: [] }],
      parameters: [variantIdParameter],
      requestBody: body(adjustStockBodySchema),
      responses: {
        "200": {
          description: "Controlled stock adjustment applied.",
          content: {
            "application/json": {
              schema: success(openApiSchema(inventoryItemResponseSchema)),
            },
          },
        },
        ...sellerFailures,
      },
    },
  },
  "/api/v1/seller/inventory/{variantId}/reorder-level": {
    patch: {
      tags: ["Inventory"],
      summary: "Update seller reorder level",
      security: [{ bearerAuth: [] }],
      parameters: [variantIdParameter],
      requestBody: body(updateReorderLevelBodySchema),
      responses: {
        "200": {
          description: "Reorder level updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(inventoryItemResponseSchema)),
            },
          },
        },
        ...sellerFailures,
      },
    },
  },
  "/api/v1/internal/inventory/reserve": {
    post: {
      tags: ["Inventory"],
      summary: "Reserve stock internally",
      security: [{ internalApiKey: [] }],
      requestBody: body(reserveStockBodySchema),
      responses: {
        "200": {
          description: "Reservation created or identical retry replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(stockReservationResponseSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
  "/api/v1/internal/inventory/release": {
    post: {
      tags: ["Inventory"],
      summary: "Release stock reservation internally",
      security: [{ internalApiKey: [] }],
      requestBody: body(releaseStockBodySchema),
      responses: {
        "200": {
          description: "Reservation released or identical retry replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(stockReservationResponseSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
  "/api/v1/internal/inventory/ship": {
    post: {
      tags: ["Inventory"],
      summary: "Issue committed stock internally",
      security: [{ internalApiKey: [] }],
      requestBody: body(shipStockBodySchema),
      responses: {
        "200": {
          description: "Committed reservation partially or fully consumed, or identical retry replayed.",
          content: {
            "application/json": {
              schema: success(openApiSchema(stockReservationResponseSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
} as const;

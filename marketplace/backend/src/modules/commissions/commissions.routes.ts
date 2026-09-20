import { Router } from "express";
import { z } from "zod";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { internalServiceMiddleware } from "../../common/middleware/internal-service.middleware.js";
import { ORDERS_ERROR_CODE } from "../orders/orders.constants.js";
import { PAYMENTS_ERROR_CODE } from "../payments/payments.constants.js";
import {
  COMMISSIONS_ERROR_CODE,
  COMMISSIONS_PERMISSION,
} from "./commissions.constants.js";
import { CommissionsController } from "./commissions.controller.js";
import {
  adminCommissionEntryListQuerySchema,
  adminCommissionRuleListQuerySchema,
  commissionEntryResponseSchema,
  commissionOrderSettleResultSchema,
  commissionRefundAdjustResultSchema,
  commissionRuleIdParamsSchema,
  commissionRuleResponseSchema,
  createCommissionRuleBodySchema,
  internalCommissionOrderSettleBodySchema,
  internalCommissionRefundAdjustBodySchema,
  sellerCommissionStatementQuerySchema,
  sellerCommissionStatementResponseSchema,
  updateCommissionRuleBodySchema,
} from "./commissions.schema.js";

/** Creates the finance/admin Commission rule and ledger routes. */
export function createAdminCommissionsRouter(
  controller: CommissionsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/rules",
    requirePermission(COMMISSIONS_PERMISSION.ADMIN_READ),
    controller.listRules,
  );
  router.post(
    "/rules",
    requirePermission(COMMISSIONS_PERMISSION.ADMIN_MANAGE),
    controller.createRule,
  );
  router.patch(
    "/rules/:id",
    requirePermission(COMMISSIONS_PERMISSION.ADMIN_MANAGE),
    controller.updateRule,
  );
  router.get(
    "/entries",
    requirePermission(COMMISSIONS_PERMISSION.ADMIN_READ),
    controller.listAdminEntries,
  );

  return router;
}

/** Creates the authenticated seller's own Commission statement route. */
export function createSellerCommissionsRouter(
  controller: CommissionsController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.get(
    "/",
    requirePermission(COMMISSIONS_PERMISSION.SELLER_READ),
    controller.getSellerStatement,
  );
  return router;
}

/** Creates trusted internal Commission settlement and refund-adjustment commands. */
export function createInternalCommissionsRouter(
  controller: CommissionsController,
): Router {
  const router = Router();
  router.use(internalServiceMiddleware);
  router.post("/order-settle", controller.settleOrder);
  router.post("/refund-adjust", controller.adjustRefund);
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

/** Converts a runtime Zod contract into the JSON Schema shape used by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the stable success envelope around one Commission response schema. */
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

/** Builds the stable paginated success envelope around one Commission list response. */
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

/** Wraps one strict Commission Zod body contract as required JSON content. */
function body(schema: z.ZodType) {
  return {
    required: true,
    content: {
      "application/json": { schema: openApiSchema(schema) },
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

/** Converts an allow-listed Zod query object into OpenAPI query parameters. */
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
            ERROR_CODE.RATE_LIMITED,
            ERROR_CODE.PAYLOAD_TOO_LARGE,
            ERROR_CODE.INTERNAL_ERROR,
            ERROR_CODE.SERVICE_UNAVAILABLE,
            ...Object.values(COMMISSIONS_ERROR_CODE),
            ...Object.values(ORDERS_ERROR_CODE),
            ...Object.values(PAYMENTS_ERROR_CODE),
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
    description: "Malformed Commission request was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Commission permission or seller scope was denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Requested Commission rule or referenced scoped resource was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Commission rule overlap, immutable history, or settlement state conflicts with the request.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Request body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Commission path, query, body, rate, money, scope, or date validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Commission ledger consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Required internal dependency is temporarily unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const internalFailures = {
  "400": {
    description: "Malformed trusted Commission command was rejected safely.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "Valid internal service authentication is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Trusted system Commission command access is required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Referenced Order, Payment, Product, or Commission history was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Captured/refunded state, source replay, or immutable Commission history conflicts with the command.",
    content: { "application/json": { schema: failureSchema } },
  },
  "413": {
    description: "Trusted Commission command body exceeds the configured HTTP limit.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Trusted Commission command validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "500": {
    description: "Unexpected server or Commission ledger consistency error.",
    content: { "application/json": { schema: failureSchema } },
  },
  "502": {
    description: "Provider-authoritative Payment state could not be reconciled for Commission processing.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Internal authentication or a required service dependency is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const ruleIdParameter = pathParameter("id", commissionRuleIdParamsSchema);

/** Live OpenAPI contract for exactly the seven approved Module 16 Commission operations. */
export const commissionsOpenApiPaths = {
  "/api/v1/admin/commissions/rules": {
    get: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "List Commission rules",
      operationId: "listCommissionRules",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminCommissionRuleListQuerySchema),
      responses: {
        "200": {
          description: "Permission-filtered Commission rule page returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(z.array(commissionRuleResponseSchema))),
            },
          },
        },
        ...protectedFailures,
      },
    },
    post: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Create a Commission rule",
      operationId: "createCommissionRule",
      description:
        "Creates an effective-dated marketplace fee rule using only the approved active/inactive status contract. " +
        "fundingRulesJson may only be omitted or null in the core release.",
      security: [{ bearerAuth: [] }],
      requestBody: body(createCommissionRuleBodySchema),
      responses: {
        "201": {
          description: "Commission rule created and audited.",
          content: {
            "application/json": {
              schema: success(openApiSchema(commissionRuleResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/commissions/rules/{id}": {
    patch: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Update a future-effective Commission rule",
      operationId: "updateCommissionRule",
      description:
        "Updates only a future-effective rule. Status remains active/inactive, fundingRulesJson may only be omitted " +
        "or null, and existing Order Item snapshots and ledger history stay immutable.",
      security: [{ bearerAuth: [] }],
      parameters: [ruleIdParameter],
      requestBody: body(updateCommissionRuleBodySchema),
      responses: {
        "200": {
          description: "Future-effective Commission rule updated and audited.",
          content: {
            "application/json": {
              schema: success(openApiSchema(commissionRuleResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/commissions": {
    get: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Read the seller's own Commission statement",
      operationId: "getSellerCommissionStatement",
      description: "Seller identity comes only from the authenticated server context; another seller ID cannot be supplied by the client.",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerCommissionStatementQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Commission summaries and immutable entries returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerCommissionStatementResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/commissions/entries": {
    get: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Read the finance Commission ledger",
      operationId: "listCommissionEntries",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(adminCommissionEntryListQuerySchema),
      responses: {
        "200": {
          description: "Permission-filtered immutable Commission ledger page returned and audited.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(z.array(commissionEntryResponseSchema))),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/internal/commissions/order-settle": {
    post: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Post captured Order Commissions idempotently",
      operationId: "settleOrderCommissionsInternally",
      description: "Trusted server-side command that derives captured Order economics and appends sale Commission entries exactly once.",
      security: [{ internalApiKey: [] }],
      requestBody: body(internalCommissionOrderSettleBodySchema),
      responses: {
        "200": {
          description: "Commission settlement completed or replayed without duplicate ledger entries.",
          content: {
            "application/json": {
              schema: success(openApiSchema(commissionOrderSettleResultSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
  "/api/v1/internal/commissions/refund-adjust": {
    post: {
      tags: ["Commissions & Marketplace Fees"],
      summary: "Append a refund Commission adjustment idempotently",
      operationId: "adjustRefundCommissionsInternally",
      description:
        "Trusted server-side command that uses original sale economics and provider-authoritative refund state " +
        "without editing history. Full refunds are supported now; partial refunds fail closed until Module 14 " +
        "supplies authoritative item allocation.",
      security: [{ internalApiKey: [] }],
      requestBody: body(internalCommissionRefundAdjustBodySchema),
      responses: {
        "200": {
          description: "Refund Commission adjustment completed or replayed without duplicate ledger entries.",
          content: {
            "application/json": {
              schema: success(openApiSchema(commissionRefundAdjustResultSchema)),
            },
          },
        },
        ...internalFailures,
      },
    },
  },
} as const;

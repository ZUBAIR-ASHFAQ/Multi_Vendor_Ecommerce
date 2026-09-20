import { Router } from "express";
import { z } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { DASHBOARD_PERMISSION } from "./dashboard.constants.js";
import { DashboardController } from "./dashboard.controller.js";
import {
  dashboardAlertsQuerySchema,
  dashboardAlertsResponseSchema,
  dashboardOrdersQuerySchema,
  dashboardOrdersResponseSchema,
  dashboardPreferencesResponseSchema,
  dashboardSellersQuerySchema,
  dashboardSellersResponseSchema,
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
  updateDashboardPreferencesBodySchema,
} from "./dashboard.schema.js";

/** Creates exactly the five authenticated Module 1 Dashboard routes from the controlling guide. */
export function createDashboardRouter(controller: DashboardController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/summary",
    requirePermission(DASHBOARD_PERMISSION.READ),
    controller.getSummary,
  );
  router.get(
    "/orders",
    requirePermission(DASHBOARD_PERMISSION.READ),
    controller.getOrders,
  );
  router.get(
    "/sellers",
    requirePermission(DASHBOARD_PERMISSION.READ),
    requirePermission(DASHBOARD_PERMISSION.SELLER_READ),
    controller.getSellers,
  );
  router.get(
    "/alerts",
    requirePermission(DASHBOARD_PERMISSION.READ),
    controller.getAlerts,
  );
  router.patch(
    "/preferences",
    requirePermission(DASHBOARD_PERMISSION.MANAGE_PREFERENCES),
    controller.updatePreferences,
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

/** Converts one runtime Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the standard success envelope around one non-paginated Dashboard response. */
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

/** Builds the standard paginated success envelope for Dashboard seller and alert lists. */
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

/** Wraps one validated Dashboard body contract as required application/json content. */
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

/** Builds allow-listed Dashboard query parameters from the same Zod contract parsed by the controller. */
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

const dashboardReadFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Dashboard permission or seller/store resource scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Dashboard query or filter validation failed.",
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
  "503": {
    description: "A required Dashboard reporting source or widget is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

/** Route-owned OpenAPI definitions for exactly the five documented Module 1 operations. */
export const dashboardOpenApiPaths = {
  "/api/v1/dashboard/summary": {
    get: {
      tags: ["Dashboard"],
      summary: "Read marketplace or seller-scoped Dashboard summary",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(dashboardSummaryQuerySchema),
      responses: {
        "200": {
          description: "Role/scope-aware KPI summary with separated finance values and user preferences.",
          content: {
            "application/json": {
              schema: success(openApiSchema(dashboardSummaryResponseSchema)),
            },
          },
        },
        ...dashboardReadFailures,
      },
    },
  },
  "/api/v1/dashboard/orders": {
    get: {
      tags: ["Dashboard"],
      summary: "Read Dashboard Order status and GMV trend",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(dashboardOrdersQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe Order status counts and exact-money GMV trend.",
          content: {
            "application/json": {
              schema: success(openApiSchema(dashboardOrdersResponseSchema)),
            },
          },
        },
        ...dashboardReadFailures,
      },
    },
  },
  "/api/v1/dashboard/sellers": {
    get: {
      tags: ["Dashboard"],
      summary: "Read Dashboard seller performance summary",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(dashboardSellersQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged seller performance summary.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(dashboardSellersResponseSchema)),
            },
          },
        },
        ...dashboardReadFailures,
      },
    },
  },
  "/api/v1/dashboard/alerts": {
    get: {
      tags: ["Dashboard"],
      summary: "Read permission-scoped Dashboard operational alerts",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(dashboardAlertsQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe page of source-owned operational alerts.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(dashboardAlertsResponseSchema)),
            },
          },
        },
        ...dashboardReadFailures,
      },
    },
  },
  "/api/v1/dashboard/preferences": {
    patch: {
      tags: ["Dashboard"],
      summary: "Update current user's Dashboard preferences",
      security: [{ bearerAuth: [] }],
      requestBody: body(updateDashboardPreferencesBodySchema),
      responses: {
        "200": {
          description: "Updated user-owned Dashboard preferences and saved filters.",
          content: {
            "application/json": {
              schema: success(openApiSchema(dashboardPreferencesResponseSchema)),
            },
          },
        },
        ...dashboardReadFailures,
      },
    },
  },
} as const;

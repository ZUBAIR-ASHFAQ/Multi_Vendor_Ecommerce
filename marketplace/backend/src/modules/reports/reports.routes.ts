import { Router } from "express";
import { z } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { REPORTS_PERMISSION } from "./reports.constants.js";
import { ReportsController } from "./reports.controller.js";
import {
  commissionsReportQuerySchema,
  commissionsReportResponseSchema,
  createReportRunBodySchema,
  inventoryReportQuerySchema,
  inventoryReportResponseSchema,
  payoutsReportQuerySchema,
  payoutsReportResponseSchema,
  refundsReportQuerySchema,
  refundsReportResponseSchema,
  reportRunIdParamsSchema,
  reportRunListQuerySchema,
  reportRunResponseSchema,
  reportsCatalogResponseSchema,
  salesReportQuerySchema,
  salesReportResponseSchema,
  sellersReportQuerySchema,
  sellersReportResponseSchema,
} from "./reports.schema.js";

/** Creates the exact nine authenticated Module 20 Reports & Analytics routes. */
export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  // Catalog is permission-filtered by the service because different definitions require different permissions.
  router.get("/catalog", controller.getCatalog);
  router.get(
    "/sales",
    requirePermission(REPORTS_PERMISSION.SALES_READ),
    controller.getSalesReport,
  );
  router.get(
    "/sellers",
    requirePermission(REPORTS_PERMISSION.SELLER_READ),
    controller.getSellersReport,
  );
  router.get(
    "/inventory",
    requirePermission(REPORTS_PERMISSION.INVENTORY_READ),
    controller.getInventoryReport,
  );
  router.get(
    "/refunds",
    requirePermission(REPORTS_PERMISSION.FINANCE_READ),
    controller.getRefundsReport,
  );
  router.get(
    "/commissions",
    requirePermission(REPORTS_PERMISSION.FINANCE_READ),
    controller.getCommissionsReport,
  );
  router.get(
    "/payouts",
    requirePermission(REPORTS_PERMISSION.FINANCE_READ),
    controller.getPayoutsReport,
  );
  router.get(
    "/runs",
    requirePermission(REPORTS_PERMISSION.EXPORT),
    controller.listReportRuns,
  );
  router.post(
    "/runs",
    requirePermission(REPORTS_PERMISSION.EXPORT),
    controller.createReportRun,
  );
  router.get(
    "/runs/:id",
    requirePermission(REPORTS_PERMISSION.EXPORT),
    controller.getReportRun,
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

/** Builds the standard success envelope around one non-paginated Reports response. */
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

/** Builds the standard paginated success envelope for report read endpoints. */
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

const reportRunIdParameter = pathParameter("id", reportRunIdParamsSchema);

const readFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Report permission or seller/store scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Report query or filter validation failed.",
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

const runFailures = {
  ...readFailures,
  "404": {
    description: "Report definition or report run was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

/** Route-owned OpenAPI definitions for the documented Module 20 operations. */
export const reportsOpenApiPaths = {
  "/api/v1/reports/catalog": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "List allowed reports",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Permission-filtered active report catalog.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reportsCatalogResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/sales": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read Sales and Orders report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(salesReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged sales report with separated financial summaries.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(salesReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/sellers": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read seller performance and settlement report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellersReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged seller performance report.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellersReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/inventory": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read Inventory and low-stock report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(inventoryReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged current Inventory and low-stock report.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(inventoryReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/refunds": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read Return and Refund report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(refundsReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged finalized Return/Refund report.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(refundsReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/commissions": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read marketplace Commission report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(commissionsReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged immutable Commission report.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(commissionsReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/payouts": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read seller Payout and liability report",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(payoutsReportQuerySchema),
      responses: {
        "200": {
          description: "Permission-safe paged paid-Payout and seller-liability report.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(payoutsReportResponseSchema)),
            },
          },
        },
        ...readFailures,
      },
    },
  },
  "/api/v1/reports/runs": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "List requester-owned report exports",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(reportRunListQuerySchema),
      responses: {
        "200": {
          description: "Paged durable export history owned by the authenticated requester.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(reportRunResponseSchema.array())),
            },
          },
        },
        ...readFailures,
      },
    },
    post: {
      tags: ["Reports & Analytics"],
      summary: "Create asynchronous report export",
      security: [{ bearerAuth: [] }],
      requestBody: body(createReportRunBodySchema),
      responses: {
        "202": {
          description: "Authorized report export was queued.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reportRunResponseSchema)),
            },
          },
        },
        ...runFailures,
      },
    },
  },
  "/api/v1/reports/runs/{id}": {
    get: {
      tags: ["Reports & Analytics"],
      summary: "Read asynchronous report export status",
      security: [{ bearerAuth: [] }],
      parameters: [reportRunIdParameter],
      responses: {
        "200": {
          description: "Requester-owned report run status and authorized download when complete.",
          content: {
            "application/json": {
              schema: success(openApiSchema(reportRunResponseSchema)),
            },
          },
        },
        ...runFailures,
      },
    },
  },
} as const;

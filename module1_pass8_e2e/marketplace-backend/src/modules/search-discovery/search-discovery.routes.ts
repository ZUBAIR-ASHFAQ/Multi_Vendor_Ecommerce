import type { NextFunction, Request, Response, RequestHandler } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z, type ZodType } from "zod";
import { PAGINATION } from "../../common/constants/pagination.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  authenticationMiddleware,
  getOptionalRequestContext,
  optionalAuthenticationMiddleware,
} from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { assertPermission } from "../../common/policies/policy.js";
import { failureResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  SEARCH_LIMITS,
  SEARCH_PERMISSION,
  SEARCH_PRODUCT_SORT_VALUES,
  SEARCH_REINDEX_RATE_LIMIT,
  SEARCH_STORE_SORT_VALUES,
} from "./search-discovery.constants.js";
import { SearchDiscoveryController } from "./search-discovery.controller.js";
import {
  queueSearchReindexBodySchema,
  searchProductsDataSchema,
  searchReindexIdParamsSchema,
  searchReindexRunResponseSchema,
  searchStoresDataSchema,
  searchSuggestionsDataSchema,
} from "./search-discovery.schema.js";

/** Allows anonymous storefront Search and verifies search.public when a bearer identity is supplied. */
function publicSearchPermissionMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  try {
    const context = getOptionalRequestContext(response);
    if (context) assertPermission(context, SEARCH_PERMISSION.PUBLIC);
    next();
  } catch (error) {
    next(error);
  }
}

/** Creates the three public storefront Search routes. */
export function createPublicSearchDiscoveryRouter(
  controller: SearchDiscoveryController,
): Router {
  const router = Router();
  router.use(optionalAuthenticationMiddleware);
  router.use(publicSearchPermissionMiddleware);
  router.get("/products", controller.searchProducts);
  router.get("/suggestions", controller.searchSuggestions);
  router.get("/stores", controller.searchStores);
  return router;
}

/** Builds the dedicated rate limiter required for expensive privileged reindex commands. */
function createReindexRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: SEARCH_REINDEX_RATE_LIMIT.WINDOW_MS,
    limit: SEARCH_REINDEX_RATE_LIMIT.MAX_REQUESTS,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request: Request, response: Response) => {
      response.status(429).json(
        failureResponse(
          ERROR_CODE.RATE_LIMITED,
          "Too many Search reindex requests. Try again later.",
          { requestId: getRequestId(response) },
        ),
      );
    },
  });
}

/** Creates privileged Search administration routes with authentication, RBAC, and reindex throttling. */
export function createAdminSearchDiscoveryRouter(
  controller: SearchDiscoveryController,
): Router {
  const router = Router();
  const reindexRateLimit = createReindexRateLimit();
  router.use(authenticationMiddleware);

  router.post(
    "/reindex",
    requirePermission(SEARCH_PERMISSION.ADMIN_MANAGE),
    reindexRateLimit,
    controller.queueFullReindex,
  );
  router.get(
    "/reindex/:id",
    requirePermission(SEARCH_PERMISSION.ADMIN_MANAGE),
    controller.getReindexStatus,
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
    pageSize: { type: "integer", minimum: 1 },
    totalItems: { type: "integer", minimum: 0 },
    totalPages: { type: "integer", minimum: 0 },
  },
} as const;

/** Converts one Zod contract into the JSON Schema shape consumed by OpenAPI 3.1. */
function openApiSchema(schema: ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the canonical success envelope around one Search response schema. */
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

/** Builds the canonical paginated success envelope used by Search list endpoints. */
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
function body(schema: ZodType) {
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
  schema: ZodType,
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
function pathParameter(name: string, schema: ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

/** Reuses the shared pagination bounds in OpenAPI without serializing Zod transforms. */
function paginationParameters() {
  return [
    {
      name: "page",
      in: "query" as const,
      required: false,
      schema: { type: "integer", minimum: 1, default: PAGINATION.DEFAULT_PAGE },
    },
    {
      name: "pageSize",
      in: "query" as const,
      required: false,
      schema: {
        type: "integer",
        minimum: 1,
        maximum: PAGINATION.MAX_PAGE_SIZE,
        default: PAGINATION.DEFAULT_PAGE_SIZE,
      },
    },
  ] as const;
}

/** Documents the exact allow-listed Product Search query parsed by searchProductsQuerySchema. */
function productSearchQueryParameters() {
  return [
    ...paginationParameters(),
    {
      name: "q",
      in: "query" as const,
      required: false,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: SEARCH_LIMITS.QUERY_MAX_LENGTH,
      },
    },
    { name: "categoryId", in: "query" as const, required: false, schema: { type: "string", format: "uuid" } },
    { name: "brandId", in: "query" as const, required: false, schema: { type: "string", format: "uuid" } },
    {
      name: "attribute",
      in: "query" as const,
      required: false,
      description: "Repeat as attribute=<attribute UUID>=<facet value>.",
      style: "form",
      explode: true,
      schema: {
        type: "array",
        maxItems: SEARCH_LIMITS.ATTRIBUTE_FILTER_MAX_COUNT,
        items: { type: "string", minLength: 3, maxLength: SEARCH_LIMITS.ATTRIBUTE_FILTER_TOKEN_MAX_LENGTH },
      },
    },
    {
      name: "minPrice",
      in: "query" as const,
      required: false,
      schema: {
        type: "string",
        pattern: "^(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$",
      },
    },
    {
      name: "maxPrice",
      in: "query" as const,
      required: false,
      schema: {
        type: "string",
        pattern: "^(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$",
      },
    },
    { name: "minRating", in: "query" as const, required: false, schema: { type: "number", minimum: 0, maximum: 5 } },
    { name: "inStock", in: "query" as const, required: false, schema: { type: "string", enum: ["true", "false"] } },
    {
      name: "sort",
      in: "query" as const,
      required: false,
      schema: {
        type: "string",
        enum: SEARCH_PRODUCT_SORT_VALUES,
        default: "relevance",
      },
    },
  ] as const;
}

/** Documents the exact bounded autocomplete query parsed by searchSuggestionsQuerySchema. */
function suggestionQueryParameters() {
  return [
    {
      name: "q",
      in: "query" as const,
      required: true,
      schema: { type: "string", minLength: 2, maxLength: SEARCH_LIMITS.SUGGESTION_QUERY_MAX_LENGTH },
    },
    {
      name: "limit",
      in: "query" as const,
      required: false,
      schema: { type: "integer", minimum: 1, maximum: SEARCH_LIMITS.SUGGESTION_LIMIT_MAX, default: 8 },
    },
  ] as const;
}

/** Documents the exact public Store Search query parsed by searchStoresQuerySchema. */
function storeSearchQueryParameters() {
  return [
    ...paginationParameters(),
    {
      name: "q",
      in: "query" as const,
      required: true,
      schema: { type: "string", minLength: 1, maxLength: SEARCH_LIMITS.QUERY_MAX_LENGTH },
    },
    {
      name: "sort",
      in: "query" as const,
      required: false,
      schema: {
        type: "string",
        enum: SEARCH_STORE_SORT_VALUES,
        default: "relevance",
      },
    },
  ] as const;
}

const reindexIdParameter = pathParameter("id", searchReindexIdParamsSchema);

const publicFailures = {
  "400": {
    description: "Search query/filter validation failed with SEARCH_QUERY_INVALID.",
    content: { "application/json": { schema: failureSchema } },
  },
  "401": {
    description: "A supplied bearer token was malformed or invalid.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "An authenticated actor does not hold search.public.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Global request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Search read model is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

const adminFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "admin.search.manage permission required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Search reindex run was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Another full Search reindex is already active.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Request body or path validation failed.",
    content: { "application/json": { schema: failureSchema } },
  },
  "429": {
    description: "Search reindex request rate limit exceeded.",
    content: { "application/json": { schema: failureSchema } },
  },
  "503": {
    description: "Search persistence or queue infrastructure is unavailable.",
    content: { "application/json": { schema: failureSchema } },
  },
} as const;

/** Route-owned OpenAPI definitions for the exact Module 19 public/admin HTTP surface. */
export const searchDiscoveryOpenApiPaths = {
  "/api/v1/search/products": {
    get: {
      tags: ["Search & Discovery"],
      summary: "Search public Products",
      description:
        "Returns eventually-consistent public Product cards and facets. Checkout must re-read authoritative Product and Inventory sources.",
      parameters: productSearchQueryParameters(),
      responses: {
        "200": {
          description: "Product Search results returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(searchProductsDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/search/suggestions": {
    get: {
      tags: ["Search & Discovery"],
      summary: "Get Search autocomplete suggestions",
      parameters: suggestionQueryParameters(),
      responses: {
        "200": {
          description: "Bounded public suggestions returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(searchSuggestionsDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/search/stores": {
    get: {
      tags: ["Search & Discovery"],
      summary: "Search public Stores",
      parameters: storeSearchQueryParameters(),
      responses: {
        "200": {
          description: "Public Store Search results returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(searchStoresDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/admin/search/reindex": {
    post: {
      tags: ["Search & Discovery"],
      summary: "Queue full Search reindex",
      description:
        "Queues one bounded full-catalog reindex. The persisted run ID also identifies the retry-safe BullMQ job.",
      security: [{ bearerAuth: [] }],
      requestBody: body(queueSearchReindexBodySchema),
      responses: {
        "202": {
          description: "Full-catalog Search reindex accepted for background processing.",
          content: {
            "application/json": {
              schema: success(openApiSchema(searchReindexRunResponseSchema)),
            },
          },
        },
        ...adminFailures,
      },
    },
  },
  "/api/v1/admin/search/reindex/{id}": {
    get: {
      tags: ["Search & Discovery"],
      summary: "Read Search reindex status",
      security: [{ bearerAuth: [] }],
      parameters: [reindexIdParameter],
      responses: {
        "200": {
          description: "Search reindex lifecycle status returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(searchReindexRunResponseSchema)),
            },
          },
        },
        ...adminFailures,
      },
    },
  },
} as const;

import { Router } from "express";
import { z } from "zod";
import {
  authenticationMiddleware,
  optionalAuthenticationMiddleware,
} from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { CATALOG_PERMISSION } from "./catalog-taxonomy.constants.js";
import { CatalogTaxonomyController } from "./catalog-taxonomy.controller.js";
import {
  attributeResponseSchema,
  brandResponseSchema,
  categoryAttributeMappingResponseSchema,
  categoryIdParamsSchema,
  categoryResponseSchema,
  createAttributeBodySchema,
  createBrandBodySchema,
  createCategoryBodySchema,
  replaceCategoryAttributesBodySchema,
  updateCategoryBodySchema,
} from "./catalog-taxonomy.schema.js";

/** Creates the four audited public/authorized taxonomy read routes. */
export function createCatalogTaxonomyRouter(
  controller: CatalogTaxonomyController,
): Router {
  const router = Router();
  router.use(optionalAuthenticationMiddleware);

  router.get("/categories", controller.listCategories);
  router.get(
    "/categories/:id/attributes",
    controller.listCategoryAttributeMappings,
  );
  router.get("/brands", controller.listBrands);
  router.get("/attributes", controller.listAttributes);

  return router;
}

/** Creates the five approved administrator taxonomy command routes with route-level RBAC. */
export function createAdminCatalogTaxonomyRouter(
  controller: CatalogTaxonomyController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.post(
    "/categories",
    requirePermission(CATALOG_PERMISSION.MANAGE_CATEGORIES),
    controller.createCategory,
  );
  router.patch(
    "/categories/:id",
    requirePermission(CATALOG_PERMISSION.MANAGE_CATEGORIES),
    controller.updateCategory,
  );
  router.post(
    "/brands",
    requirePermission(CATALOG_PERMISSION.MANAGE_BRANDS),
    controller.createBrand,
  );
  router.post(
    "/attributes",
    requirePermission(CATALOG_PERMISSION.MANAGE_ATTRIBUTES),
    controller.createAttribute,
  );
  router.put(
    "/categories/:id/attributes",
    requirePermission(CATALOG_PERMISSION.MANAGE_CATEGORIES),
    controller.replaceCategoryAttributes,
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

/** Converts one Zod contract into the OpenAPI 3.1-compatible JSON Schema used by Module 5. */
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the standard API success envelope for one Module 5 response schema. */
function success(data: object) {
  return {
    type: "object",
    required: ["success", "data", "requestId"],
    properties: {
      success: { const: true },
      data,
      requestId,
    },
  } as const;
}

/** Wraps one Zod-derived JSON schema as a required application/json request body. */
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

/** Reads one property schema from a Zod object for a matching OpenAPI path parameter. */
function objectPropertySchema(
  schema: z.ZodType,
  propertyName: string,
): Record<string, unknown> {
  const jsonSchema = openApiSchema(schema);
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
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

/** Builds one OpenAPI path parameter from the same Zod contract parsed by the controller. */
function pathParameter(name: string, schema: z.ZodType) {
  return {
    name,
    in: "path",
    required: true,
    schema: objectPropertySchema(schema, name),
  } as const;
}

const categoryIdPathParameter = pathParameter("id", categoryIdParamsSchema);

/** Recursive category-tree component built from Zod-owned flat field schemas plus one explicit self-reference. */
const categoryTreeNodeOpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "parentId",
    "slug",
    "name",
    "status",
    "sortOrder",
    "children",
  ],
  properties: {
    id: objectPropertySchema(categoryResponseSchema, "id"),
    parentId: objectPropertySchema(categoryResponseSchema, "parentId"),
    slug: objectPropertySchema(categoryResponseSchema, "slug"),
    name: objectPropertySchema(categoryResponseSchema, "name"),
    status: objectPropertySchema(categoryResponseSchema, "status"),
    sortOrder: objectPropertySchema(categoryResponseSchema, "sortOrder"),
    children: {
      type: "array",
      items: { $ref: "#/components/schemas/CatalogCategoryTreeNode" },
    },
  },
} as const;

/** Module 5 OpenAPI components that need stable component references for recursive schemas. */
export const catalogTaxonomyOpenApiComponents = {
  schemas: {
    CatalogCategoryTreeNode: categoryTreeNodeOpenApiSchema,
  },
} as const;

const publicReadFailures = {
  "401": {
    description: "A supplied bearer token is invalid or expired.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Authenticated actor does not have allowed catalog read access.",
    content: { "application/json": { schema: failure } },
  },
  "429": {
    description: "Request rate limit exceeded.",
    content: { "application/json": { schema: failure } },
  },
  "500": {
    description: "Unexpected server error.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const categoryMappingReadFailures = {
  ...publicReadFailures,
  "404": {
    description: "Category was not found or is not active for this reader.",
    content: { "application/json": { schema: failure } },
  },
  "422": {
    description: "Category ID validation failed.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const protectedFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Required catalog permission denied.",
    content: { "application/json": { schema: failure } },
  },
  "404": {
    description: "Referenced category or taxonomy resource was not found.",
    content: { "application/json": { schema: failure } },
  },
  "409": {
    description: "Catalog uniqueness, hierarchy, or mapping business rule conflict.",
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
    description: "Unexpected server error.",
    content: { "application/json": { schema: failure } },
  },
} as const;

/** Route-owned OpenAPI definitions for the audited Module 5 HTTP operations. */
export const catalogTaxonomyOpenApiPaths = {
  "/api/v1/catalog/categories": {
    get: {
      tags: ["Catalog Taxonomy"],
      summary: "Read category tree",
      description:
        "Returns public active categories. An authorized category manager may also see inactive taxonomy.",
      security: [{ bearerAuth: [] }, {}],
      responses: {
        "200": {
          description: "Category tree returned.",
          content: {
            "application/json": {
              schema: success({
                type: "array",
                items: { $ref: "#/components/schemas/CatalogCategoryTreeNode" },
              }),
            },
          },
        },
        ...publicReadFailures,
      },
    },
  },
  "/api/v1/catalog/categories/{id}/attributes": {
    get: {
      tags: ["Catalog Taxonomy"],
      summary: "Read category attribute mapping",
      description:
        "Returns active attributes mapped to one active category. " +
        "An authorized category manager may inspect the complete mapping, " +
        "including inactive taxonomy.",
      security: [{ bearerAuth: [] }, {}],
      parameters: [categoryIdPathParameter],
      responses: {
        "200": {
          description: "Category attribute mapping returned.",
          content: {
            "application/json": {
              schema: success({
                type: "array",
                items: openApiSchema(categoryAttributeMappingResponseSchema),
              }),
            },
          },
        },
        ...categoryMappingReadFailures,
      },
    },
  },
  "/api/v1/admin/catalog/categories": {
    post: {
      tags: ["Catalog Taxonomy"],
      summary: "Create category",
      security: [{ bearerAuth: [] }],
      requestBody: body(createCategoryBodySchema),
      responses: {
        "201": {
          description: "Category created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(categoryResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/catalog/categories/{id}": {
    patch: {
      tags: ["Catalog Taxonomy"],
      summary: "Update category",
      security: [{ bearerAuth: [] }],
      parameters: [categoryIdPathParameter],
      requestBody: body(updateCategoryBodySchema),
      responses: {
        "200": {
          description: "Category updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(categoryResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/catalog/brands": {
    get: {
      tags: ["Catalog Taxonomy"],
      summary: "List brands",
      description:
        "Returns public active brands. An authorized brand manager may also see inactive brands.",
      security: [{ bearerAuth: [] }, {}],
      responses: {
        "200": {
          description: "Brands returned.",
          content: {
            "application/json": {
              schema: success({
                type: "array",
                items: openApiSchema(brandResponseSchema),
              }),
            },
          },
        },
        ...publicReadFailures,
      },
    },
  },
  "/api/v1/admin/catalog/brands": {
    post: {
      tags: ["Catalog Taxonomy"],
      summary: "Create brand",
      security: [{ bearerAuth: [] }],
      requestBody: body(createBrandBodySchema),
      responses: {
        "201": {
          description: "Brand created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(brandResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/catalog/attributes": {
    get: {
      tags: ["Catalog Taxonomy"],
      summary: "List attribute definitions",
      description:
        "Returns public active reusable attributes and values. An authorized attribute manager may also see inactive definitions.",
      security: [{ bearerAuth: [] }, {}],
      responses: {
        "200": {
          description: "Attributes returned.",
          content: {
            "application/json": {
              schema: success({
                type: "array",
                items: openApiSchema(attributeResponseSchema),
              }),
            },
          },
        },
        ...publicReadFailures,
      },
    },
  },
  "/api/v1/admin/catalog/attributes": {
    post: {
      tags: ["Catalog Taxonomy"],
      summary: "Create attribute definition",
      security: [{ bearerAuth: [] }],
      requestBody: body(createAttributeBodySchema),
      responses: {
        "201": {
          description: "Attribute definition created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(attributeResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/catalog/categories/{id}/attributes": {
    put: {
      tags: ["Catalog Taxonomy"],
      summary: "Replace category attribute mapping",
      description:
        "Replaces the category's complete attribute mapping in one controlled transaction.",
      security: [{ bearerAuth: [] }],
      parameters: [categoryIdPathParameter],
      requestBody: body(replaceCategoryAttributesBodySchema),
      responses: {
        "200": {
          description: "Category attribute mapping replaced.",
          content: {
            "application/json": {
              schema: success({
                type: "array",
                items: openApiSchema(categoryAttributeMappingResponseSchema),
              }),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

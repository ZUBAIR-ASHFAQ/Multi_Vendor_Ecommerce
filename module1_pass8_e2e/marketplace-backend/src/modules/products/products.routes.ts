import { Router } from "express";
import { z } from "zod";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import { PRODUCT_PERMISSION } from "./products.constants.js";
import { ProductsController } from "./products.controller.js";
import {
  createProductBodySchema,
  createProductVariantBodySchema,
  linkProductMediaBodySchema,
  productDetailResponseSchema,
  productIdParamsSchema,
  productVariantIdParamsSchema,
  publicProductDetailResponseSchema,
  publicProductListDataSchema,
  publicProductListQuerySchema,
  publicProductSlugParamsSchema,
  sellerProductListDataSchema,
  sellerProductListQuerySchema,
  updateProductBodySchema,
  updateProductVariantBodySchema,
} from "./products.schema.js";

/** Creates the public Product list/detail routes without exposing seller-private fields. */
export function createPublicProductsRouter(controller: ProductsController): Router {
  const router = Router();
  router.get("/", controller.listPublicProducts);
  router.get("/:slug", controller.getPublicProduct);
  return router;
}

/** Creates seller Product routes with route-level RBAC before service-level resource checks. */
export function createSellerProductsRouter(controller: ProductsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(PRODUCT_PERMISSION.SELLER_READ),
    controller.listSellerProducts,
  );
  router.get(
    "/:id",
    requirePermission(PRODUCT_PERMISSION.SELLER_READ),
    controller.getSellerProduct,
  );
  router.post(
    "/",
    requirePermission(PRODUCT_PERMISSION.SELLER_CREATE),
    controller.createProduct,
  );
  router.patch(
    "/:id",
    requirePermission(PRODUCT_PERMISSION.SELLER_UPDATE),
    controller.updateProduct,
  );
  router.post(
    "/:id/variants",
    requirePermission(PRODUCT_PERMISSION.SELLER_UPDATE),
    controller.addVariant,
  );
  router.patch(
    "/:id/variants/:variantId",
    requirePermission(PRODUCT_PERMISSION.SELLER_UPDATE),
    controller.updateVariant,
  );
  router.post(
    "/:id/media",
    requirePermission(PRODUCT_PERMISSION.SELLER_UPDATE),
    controller.linkMedia,
  );
  router.post(
    "/:id/publish",
    requirePermission(PRODUCT_PERMISSION.SELLER_PUBLISH),
    controller.publishProduct,
  );
  router.post(
    "/:id/unpublish",
    requirePermission(PRODUCT_PERMISSION.SELLER_PUBLISH),
    controller.unpublishProduct,
  );

  return router;
}

/** Creates the privileged Product moderation route with an explicit review permission. */
export function createAdminProductsRouter(controller: ProductsController): Router {
  const router = Router();
  router.use(authenticationMiddleware);
  router.post(
    "/:id/approve",
    requirePermission(PRODUCT_PERMISSION.ADMIN_REVIEW),
    controller.approveProduct,
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
function openApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Builds the canonical API success envelope around one Product response schema. */
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

/** Builds the canonical paginated API success envelope used by Product list endpoints. */
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

/** Builds optional/defaulted Product list query parameters from the controller-owned Zod schema. */
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

const productIdParameter = pathParameter("id", productIdParamsSchema);
const productVariantIdParameter = pathParameter("variantId", productVariantIdParamsSchema);
const productSlugParameter = pathParameter("slug", publicProductSlugParamsSchema);

const publicFailures = {
  "404": {
    description: "Published Product was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "422": {
    description: "Path or query validation failed.",
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

const protectedFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failureSchema } },
  },
  "403": {
    description: "Required Product permission or seller/store resource scope denied.",
    content: { "application/json": { schema: failureSchema } },
  },
  "404": {
    description: "Product or referenced Product child resource was not found.",
    content: { "application/json": { schema: failureSchema } },
  },
  "409": {
    description: "Product slug, SKU, taxonomy, currency, or lifecycle business rule conflict.",
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

/** Route-owned OpenAPI definitions for the complete Module 6 HTTP surface. */
export const productsOpenApiPaths = {
  "/api/v1/products": {
    get: {
      tags: ["Products"],
      summary: "List public Products",
      description: "Returns only published Products from active approved seller/store sources.",
      parameters: queryParameters(publicProductListQuerySchema),
      responses: {
        "200": {
          description: "Published Product list returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(publicProductListDataSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/products/{slug}": {
    get: {
      tags: ["Products"],
      summary: "Read public Product detail",
      parameters: [productSlugParameter],
      responses: {
        "200": {
          description: "Published Product detail returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(publicProductDetailResponseSchema)),
            },
          },
        },
        ...publicFailures,
      },
    },
  },
  "/api/v1/seller/products": {
    get: {
      tags: ["Products"],
      summary: "List seller Products",
      security: [{ bearerAuth: [] }],
      parameters: queryParameters(sellerProductListQuerySchema),
      responses: {
        "200": {
          description: "Seller-scoped Product list returned.",
          content: {
            "application/json": {
              schema: paginatedSuccess(openApiSchema(sellerProductListDataSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
    post: {
      tags: ["Products"],
      summary: "Create draft Product",
      security: [{ bearerAuth: [] }],
      requestBody: body(createProductBodySchema),
      responses: {
        "201": {
          description: "Draft Product created.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}": {
    get: {
      tags: ["Products"],
      summary: "Read seller Product detail",
      description: "Explicit read required by the seller edit/variant/media/history workflow.",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      responses: {
        "200": {
          description: "Seller-scoped Product detail returned.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
    patch: {
      tags: ["Products"],
      summary: "Update Product",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      requestBody: body(updateProductBodySchema),
      responses: {
        "200": {
          description: "Product updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}/variants": {
    post: {
      tags: ["Products"],
      summary: "Add Product variant",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      requestBody: body(createProductVariantBodySchema),
      responses: {
        "201": {
          description: "Variant added.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}/variants/{variantId}": {
    patch: {
      tags: ["Products"],
      summary: "Update Product variant or price",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter, productVariantIdParameter],
      requestBody: body(updateProductVariantBodySchema),
      responses: {
        "200": {
          description: "Variant updated.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}/media": {
    post: {
      tags: ["Products"],
      summary: "Link Product media",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      requestBody: body(linkProductMediaBodySchema),
      responses: {
        "201": {
          description: "Confirmed file linked as Product media.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}/publish": {
    post: {
      tags: ["Products"],
      summary: "Publish or submit Product",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      responses: {
        "200": {
          description: "Product published or submitted for approval.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/seller/products/{id}/unpublish": {
    post: {
      tags: ["Products"],
      summary: "Unpublish Product",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      responses: {
        "200": {
          description: "Product unpublished.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
  "/api/v1/admin/products/{id}/approve": {
    post: {
      tags: ["Products"],
      summary: "Approve pending Product",
      security: [{ bearerAuth: [] }],
      parameters: [productIdParameter],
      responses: {
        "200": {
          description: "Pending Product approved and published.",
          content: {
            "application/json": {
              schema: success(openApiSchema(productDetailResponseSchema)),
            },
          },
        },
        ...protectedFailures,
      },
    },
  },
} as const;

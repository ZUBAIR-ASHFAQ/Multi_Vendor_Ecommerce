import { Router } from "express";
import { authenticationMiddleware } from "../../common/middleware/authentication.middleware.js";
import { requirePermission } from "../../common/middleware/authorization.middleware.js";
import {
  CART_WISHLIST_LIMITS,
  CART_WISHLIST_PERMISSION,
} from "./cart-wishlist.constants.js";
import { CartWishlistController } from "./cart-wishlist.controller.js";

/** Creates authenticated customer Cart routes with explicit cart.manage_own checks. */
export function createCartRouter(
  controller: CartWishlistController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN),
    controller.getCart,
  );
  router.post(
    "/items",
    requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN),
    controller.addCartItem,
  );
  router.patch(
    "/items/:id",
    requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN),
    controller.updateCartItem,
  );
  router.delete(
    "/items/:id",
    requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN),
    controller.removeCartItem,
  );
  router.delete(
    "/",
    requirePermission(CART_WISHLIST_PERMISSION.CART_MANAGE_OWN),
    controller.clearCart,
  );

  return router;
}

/** Creates authenticated customer Wishlist routes with explicit wishlist.manage_own checks. */
export function createWishlistRouter(
  controller: CartWishlistController,
): Router {
  const router = Router();
  router.use(authenticationMiddleware);

  router.get(
    "/",
    requirePermission(CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN),
    controller.getWishlist,
  );
  router.post(
    "/items",
    requirePermission(CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN),
    controller.addWishlistItem,
  );
  router.delete(
    "/items/:id",
    requirePermission(CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN),
    controller.removeWishlistItem,
  );

  return router;
}

const requestId = { type: "string" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;
const currency = {
  type: "string",
  pattern: "^[A-Z]{3}$",
  description: "Three-letter cart/Product currency code.",
} as const;
const money = {
  type: "string",
  pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$",
  description: "Non-negative decimal money transported as a string; never a floating-point JSON number.",
} as const;

const failure = {
  type: "object",
  required: ["success", "error", "requestId"],
  properties: {
    success: { const: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
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

/** Builds the standard success envelope used by Module 8 OpenAPI contracts. */
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

/** Wraps a JSON schema as a required application/json request body. */
function body(schema: object) {
  return {
    required: true,
    content: {
      "application/json": { schema },
    },
  } as const;
}

const itemIdPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: uuid,
} as const;

const cartQuantity = {
  type: "integer",
  minimum: 1,
  maximum: CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY,
} as const;

const cartItem = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "productId",
    "variantId",
    "productName",
    "productSlug",
    "storeId",
    "storeSlug",
    "storeName",
    "thumbnailFileId",
    "variantTitle",
    "sku",
    "currentUnitPrice",
    "currency",
    "quantity",
    "previewLineSubtotal",
    "inStock",
    "isPurchasable",
    "addedAt",
    "updatedAt",
  ],
  properties: {
    id: uuid,
    productId: uuid,
    variantId: uuid,
    productName: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    productSlug: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    storeId: { anyOf: [uuid, { type: "null" }] },
    storeSlug: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    storeName: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    thumbnailFileId: { anyOf: [uuid, { type: "null" }] },
    variantTitle: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    sku: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    currentUnitPrice: { anyOf: [money, { type: "null" }] },
    currency,
    quantity: cartQuantity,
    previewLineSubtotal: { anyOf: [money, { type: "null" }] },
    inStock: { type: "boolean" },
    isPurchasable: { type: "boolean" },
    addedAt: dateTime,
    updatedAt: dateTime,
  },
} as const;

const cart = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "currency",
    "items",
    "previewSubtotal",
    "hasUnavailableItems",
    "updatedAt",
  ],
  properties: {
    id: uuid,
    currency,
    items: { type: "array", items: cartItem },
    previewSubtotal: money,
    hasUnavailableItems: { type: "boolean" },
    updatedAt: dateTime,
  },
} as const;

const wishlistItem = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "productId",
    "variantId",
    "productName",
    "productSlug",
    "storeId",
    "storeSlug",
    "storeName",
    "thumbnailFileId",
    "variantTitle",
    "currentUnitPrice",
    "currency",
    "inStock",
    "isPurchasable",
    "createdAt",
  ],
  properties: {
    id: uuid,
    productId: uuid,
    variantId: { anyOf: [uuid, { type: "null" }] },
    productName: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    productSlug: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    storeId: { anyOf: [uuid, { type: "null" }] },
    storeSlug: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    storeName: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    thumbnailFileId: { anyOf: [uuid, { type: "null" }] },
    variantTitle: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    currentUnitPrice: { anyOf: [money, { type: "null" }] },
    currency: { anyOf: [currency, { type: "null" }] },
    inStock: { type: "boolean" },
    isPurchasable: { type: "boolean" },
    createdAt: dateTime,
  },
} as const;

const wishlist = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "isDefault", "items", "createdAt"],
  properties: {
    id: uuid,
    name: {
      type: "string",
      minLength: 1,
      maxLength: CART_WISHLIST_LIMITS.WISHLIST_NAME_MAX_LENGTH,
    },
    isDefault: { type: "boolean" },
    items: { type: "array", items: wishlistItem },
    createdAt: dateTime,
  },
} as const;

const authFailures = {
  "401": {
    description: "Authentication required.",
    content: { "application/json": { schema: failure } },
  },
  "403": {
    description: "Customer-owned Cart/Wishlist permission denied.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const validationFailure = {
  "422": {
    description: "Request validation failed.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const cartNotFoundFailure = {
  "404": {
    description: "The customer-owned cart item was not found or is outside the caller's private scope.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const wishlistNotFoundFailure = {
  "404": {
    description: "The requested public Product/variant or customer-owned wishlist item was not found.",
    content: { "application/json": { schema: failure } },
  },
} as const;

const cartConflictFailure = {
  "409": {
    description: "The Product/variant is unavailable or its currency conflicts with the current Cart.",
    content: { "application/json": { schema: failure } },
  },
} as const;

/** Module 8 OpenAPI paths for exactly the approved Cart and Wishlist operations. */
export const cartWishlistOpenApiPaths = {
  "/api/v1/cart": {
    get: {
      tags: ["Cart & Wishlist"],
      summary: "Get current cart",
      operationId: "getCurrentCart",
      description: "Returns current Product/Inventory display data. Cart totals are previews and Checkout remains authoritative.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Authenticated customer's current cart preview.",
          content: { "application/json": { schema: success(cart) } },
        },
        ...authFailures,
      },
    },
    delete: {
      tags: ["Cart & Wishlist"],
      summary: "Clear current cart",
      operationId: "clearCurrentCart",
      description: "Removes only the authenticated customer's cart items. It never reserves or mutates Inventory.",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Current cart after all owned items were removed.",
          content: { "application/json": { schema: success(cart) } },
        },
        ...authFailures,
      },
    },
  },
  "/api/v1/cart/items": {
    post: {
      tags: ["Cart & Wishlist"],
      summary: "Add item to current cart",
      operationId: "addCurrentCartItem",
      description: "Adds a currently public/active variant. Duplicate variants merge quantity; no Inventory reservation is created.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["variantId", "quantity"],
        properties: {
          variantId: uuid,
          quantity: cartQuantity,
        },
      }),
      responses: {
        "200": {
          description: "Current cart after the item quantity was added or merged.",
          content: { "application/json": { schema: success(cart) } },
        },
        ...authFailures,
        ...validationFailure,
        ...cartConflictFailure,
      },
    },
  },
  "/api/v1/cart/items/{id}": {
    patch: {
      tags: ["Cart & Wishlist"],
      summary: "Change cart item quantity",
      operationId: "updateCurrentCartItem",
      description: "Updates one customer-owned line. Quantity zero is not treated as an implicit delete.",
      security: [{ bearerAuth: [] }],
      parameters: [itemIdPathParameter],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["quantity"],
        properties: { quantity: cartQuantity },
      }),
      responses: {
        "200": {
          description: "Current cart after the owned line quantity changed.",
          content: { "application/json": { schema: success(cart) } },
        },
        ...authFailures,
        ...validationFailure,
        ...cartNotFoundFailure,
      },
    },
    delete: {
      tags: ["Cart & Wishlist"],
      summary: "Remove cart item",
      operationId: "removeCurrentCartItem",
      security: [{ bearerAuth: [] }],
      parameters: [itemIdPathParameter],
      responses: {
        "200": {
          description: "Current cart after the owned line was removed.",
          content: { "application/json": { schema: success(cart) } },
        },
        ...authFailures,
        ...validationFailure,
        ...cartNotFoundFailure,
      },
    },
  },
  "/api/v1/wishlist": {
    get: {
      tags: ["Cart & Wishlist"],
      summary: "Get default wishlist",
      operationId: "getCurrentWishlist",
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Authenticated customer's default wishlist with current public display data.",
          content: { "application/json": { schema: success(wishlist) } },
        },
        ...authFailures,
      },
    },
  },
  "/api/v1/wishlist/items": {
    post: {
      tags: ["Cart & Wishlist"],
      summary: "Add wishlist item",
      operationId: "addCurrentWishlistItem",
      description: "Adds one current public Product or optional matching variant to the customer's default wishlist.",
      security: [{ bearerAuth: [] }],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        required: ["productId"],
        properties: {
          productId: uuid,
          variantId: uuid,
        },
      }),
      responses: {
        "200": {
          description: "Default wishlist after the item was added, or unchanged when the logical item already existed.",
          content: { "application/json": { schema: success(wishlist) } },
        },
        ...authFailures,
        ...validationFailure,
        ...wishlistNotFoundFailure,
      },
    },
  },
  "/api/v1/wishlist/items/{id}": {
    delete: {
      tags: ["Cart & Wishlist"],
      summary: "Remove wishlist item",
      operationId: "removeCurrentWishlistItem",
      security: [{ bearerAuth: [] }],
      parameters: [itemIdPathParameter],
      responses: {
        "200": {
          description: "Default wishlist after the owned item was removed.",
          content: { "application/json": { schema: success(wishlist) } },
        },
        ...authFailures,
        ...validationFailure,
        ...wishlistNotFoundFailure,
      },
    },
  },
} as const;

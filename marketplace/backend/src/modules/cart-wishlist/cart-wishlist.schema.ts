import { z } from "zod";
import {
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  productCurrencySchema,
  productPriceSchema,
} from "../products/products.schema.js";
import { CART_WISHLIST_LIMITS } from "./cart-wishlist.constants.js";

/** Positive cart quantity accepted by add/update commands and bounded by Module 8 policy. */
export const cartQuantitySchema = z
  .number()
  .int()
  .min(1)
  .max(CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY);

/** Cart item ID path parameter used by update and remove operations. */
export const cartItemIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Wishlist item ID path parameter used by the remove operation. */
export const wishlistItemIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Request body for POST /api/v1/cart/items; ownership, price, currency and stock stay server-derived. */
export const addCartItemBodySchema = z
  .object({
    variantId: uuidSchema,
    quantity: cartQuantitySchema,
  })
  .strict();

/** Request body for PATCH /api/v1/cart/items/:id; zero is intentionally not treated as delete. */
export const updateCartItemBodySchema = z
  .object({
    quantity: cartQuantitySchema,
  })
  .strict();

/** Request body for POST /api/v1/wishlist/items; an optional variant must later be proved to belong to productId. */
export const addWishlistItemBodySchema = z
  .object({
    productId: uuidSchema,
    variantId: uuidSchema.optional(),
  })
  .strict();

/** Current Product/Inventory display state for one persisted cart line; unavailable legacy lines remain representable. */
export const cartItemResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema,
    productName: z.string().min(1).nullable(),
    productSlug: z.string().min(1).nullable(),
    storeId: uuidSchema.nullable(),
    storeSlug: z.string().min(1).nullable(),
    storeName: z.string().min(1).nullable(),
    thumbnailFileId: uuidSchema.nullable(),
    variantTitle: z.string().min(1).nullable(),
    sku: z.string().min(1).nullable(),
    currentUnitPrice: productPriceSchema.nullable(),
    currency: productCurrencySchema,
    quantity: cartQuantitySchema,
    previewLineSubtotal: nonNegativeDecimalStringSchema.nullable(),
    inStock: z.boolean(),
    isPurchasable: z.boolean(),
    addedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Non-authoritative cart preview returned to the customer; Checkout will recalculate all commerce totals later. */
export const cartResponseSchema = z
  .object({
    id: uuidSchema,
    currency: productCurrencySchema,
    items: z.array(cartItemResponseSchema),
    previewSubtotal: nonNegativeDecimalStringSchema,
    hasUnavailableItems: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Public-safe current display state for one saved wishlist item. */
export const wishlistItemResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema.nullable(),
    productName: z.string().min(1).nullable(),
    productSlug: z.string().min(1).nullable(),
    storeId: uuidSchema.nullable(),
    storeSlug: z.string().min(1).nullable(),
    storeName: z.string().min(1).nullable(),
    thumbnailFileId: uuidSchema.nullable(),
    variantTitle: z.string().min(1).nullable(),
    currentUnitPrice: productPriceSchema.nullable(),
    currency: productCurrencySchema.nullable(),
    inStock: z.boolean(),
    isPurchasable: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Default customer wishlist response; unavailable saved Products remain visible without leaking private fields. */
export const wishlistResponseSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(1).max(CART_WISHLIST_LIMITS.WISHLIST_NAME_MAX_LENGTH),
    isDefault: z.boolean(),
    items: z.array(wishlistItemResponseSchema),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type AddCartItemInput = z.infer<typeof addCartItemBodySchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemBodySchema>;
export type AddWishlistItemInput = z.infer<typeof addWishlistItemBodySchema>;
export type CartItemResponse = z.infer<typeof cartItemResponseSchema>;
export type CartResponse = z.infer<typeof cartResponseSchema>;
export type WishlistItemResponse = z.infer<typeof wishlistItemResponseSchema>;
export type WishlistResponse = z.infer<typeof wishlistResponseSchema>;

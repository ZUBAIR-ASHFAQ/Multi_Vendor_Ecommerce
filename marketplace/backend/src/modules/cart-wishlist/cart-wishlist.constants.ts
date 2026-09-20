/** Stable customer-owned permissions required by the controlling Module 8 contract. */
export const CART_WISHLIST_PERMISSION = {
  CART_MANAGE_OWN: "cart.manage_own",
  WISHLIST_MANAGE_OWN: "wishlist.manage_own",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const CART_WISHLIST_PERMISSION_CATALOG = [
  {
    code: CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    domain: "cart",
    description: "Read and manage only the authenticated customer's own cart.",
  },
  {
    code: CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
    domain: "wishlist",
    description: "Read and manage only the authenticated customer's own default wishlist.",
  },
] as const;

/** Stable Module 8 business error codes required by the controlling guide. */
export const CART_WISHLIST_ERROR_CODE = {
  CART_ITEM_NOT_FOUND: "CART_ITEM_NOT_FOUND",
  CART_PRODUCT_UNAVAILABLE: "CART_PRODUCT_UNAVAILABLE",
  CART_QUANTITY_INVALID: "CART_QUANTITY_INVALID",
  CART_CURRENCY_MISMATCH: "CART_CURRENCY_MISMATCH",
} as const;

/** Durable Module 8 events named by the controlling guide. */
export const CART_WISHLIST_OUTBOX_EVENT = {
  CART_ITEM_ADDED: "cart.item_added",
  CART_ITEM_REMOVED: "cart.item_removed",
  WISHLIST_ITEM_ADDED: "wishlist.item_added",
} as const;

/** Small, explicit Module 8 limits shared by request contracts and later service validation. */
export const CART_WISHLIST_LIMITS = {
  MAX_ITEM_QUANTITY: 99,
  WISHLIST_NAME_MAX_LENGTH: 120,
} as const;

/** Default wishlist label used when the service creates the customer's first wishlist. */
export const DEFAULT_WISHLIST_NAME = "My Wishlist" as const;

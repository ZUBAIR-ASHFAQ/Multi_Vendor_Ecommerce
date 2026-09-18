/** Customer-owned permissions returned by the backend for Module 8. */
export const CART_WISHLIST_PERMISSION = {
  CART_MANAGE_OWN: "cart.manage_own",
  WISHLIST_MANAGE_OWN: "wishlist.manage_own",
} as const;

/** Frontend form limits mirror the backend Module 8 request contract. */
export const CART_WISHLIST_LIMITS = {
  MAX_ITEM_QUANTITY: 99,
} as const;

/** Returns true when the authenticated actor has one Module 8 permission. */
export function hasCartWishlistPermission(
  permissions: string[],
  permission: string,
): boolean {
  return permissions.includes(permission);
}

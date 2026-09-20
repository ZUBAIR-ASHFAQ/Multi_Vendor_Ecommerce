/** Current server-derived display state for one persisted Cart line. */
export interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  productName: string | null;
  productSlug: string | null;
  variantTitle: string | null;
  sku: string | null;
  currentUnitPrice: string | null;
  currency: string;
  quantity: number;
  previewLineSubtotal: string | null;
  inStock: boolean;
  isPurchasable: boolean;
  addedAt: string;
  updatedAt: string;
}

/** Non-authoritative Cart preview returned by Module 8. */
export interface Cart {
  id: string;
  currency: string;
  items: CartItem[];
  previewSubtotal: string;
  hasUnavailableItems: boolean;
  updatedAt: string;
}

/** Current public-safe display state for one saved Wishlist item. */
export interface WishlistItem {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string | null;
  productSlug: string | null;
  variantTitle: string | null;
  currentUnitPrice: string | null;
  currency: string | null;
  inStock: boolean;
  isPurchasable: boolean;
  createdAt: string;
}

/** Default customer Wishlist returned by Module 8. */
export interface Wishlist {
  id: string;
  name: string;
  isDefault: boolean;
  items: WishlistItem[];
  createdAt: string;
}

/** Request body for adding or merging one Cart variant. */
export interface AddCartItemInput {
  variantId: string;
  quantity: number;
}

/** Request body for changing one existing Cart quantity. */
export interface UpdateCartItemInput {
  quantity: number;
}

/** Request body for saving a Product or Product variant to the default Wishlist. */
export interface AddWishlistItemInput {
  productId: string;
  variantId?: string;
}

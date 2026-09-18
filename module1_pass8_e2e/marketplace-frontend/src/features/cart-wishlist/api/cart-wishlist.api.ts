import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api";
import type {
  AddCartItemInput,
  AddWishlistItemInput,
  Cart,
  UpdateCartItemInput,
  Wishlist,
} from "../types/cart-wishlist.types";

/** Unwraps one successful Module 8 response while preserving normalized interceptor errors. */
async function dataOf<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export const cartWishlistApi = {
  /** Loads the authenticated customer's Cart preview. */
  getCart: () => dataOf<Cart>(apiClient.get("/cart")),

  /** Adds or merges one currently purchasable Product variant into the Cart. */
  addCartItem: (input: AddCartItemInput) =>
    dataOf<Cart>(apiClient.post("/cart/items", input)),

  /** Changes one customer-owned Cart line quantity. */
  updateCartItem: (itemId: string, input: UpdateCartItemInput) =>
    dataOf<Cart>(apiClient.patch(`/cart/items/${itemId}`, input)),

  /** Removes one customer-owned Cart line. */
  removeCartItem: (itemId: string) =>
    dataOf<Cart>(apiClient.delete(`/cart/items/${itemId}`)),

  /** Removes all lines from the authenticated customer's Cart. */
  clearCart: () => dataOf<Cart>(apiClient.delete("/cart")),

  /** Loads the authenticated customer's default Wishlist. */
  getWishlist: () => dataOf<Wishlist>(apiClient.get("/wishlist")),

  /** Saves one public Product or Product variant to the default Wishlist. */
  addWishlistItem: (input: AddWishlistItemInput) =>
    dataOf<Wishlist>(apiClient.post("/wishlist/items", input)),

  /** Removes one customer-owned item from the default Wishlist. */
  removeWishlistItem: (itemId: string) =>
    dataOf<Wishlist>(apiClient.delete(`/wishlist/items/${itemId}`)),
};

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cartWishlistApi } from "../api/cart-wishlist.api";
import type {
  AddCartItemInput,
  AddWishlistItemInput,
  UpdateCartItemInput,
} from "../types/cart-wishlist.types";
import { cartWishlistQueryKeys } from "./cart-wishlist.query-keys";

/** Loads the current Cart only when the owning page/component is allowed to request it. */
export function useCartQuery(enabled = true) {
  return useQuery({
    queryKey: cartWishlistQueryKeys.cart,
    queryFn: cartWishlistApi.getCart,
    enabled,
    retry: false,
  });
}

/** Loads the current default Wishlist only when the owning page is allowed to request it. */
export function useWishlistQuery(enabled = true) {
  return useQuery({
    queryKey: cartWishlistQueryKeys.wishlist,
    queryFn: cartWishlistApi.getWishlist,
    enabled,
    retry: false,
  });
}

/** Adds or merges one variant and immediately updates every Cart consumer, including the mini Cart. */
export function useAddCartItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddCartItemInput) => cartWishlistApi.addCartItem(input),
    onSuccess: (cart) => queryClient.setQueryData(cartWishlistQueryKeys.cart, cart),
  });
}

/** Changes one Cart quantity and replaces the cached Cart with the server result. */
export function useUpdateCartItemMutation(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCartItemInput) =>
      cartWishlistApi.updateCartItem(itemId, input),
    onSuccess: (cart) => queryClient.setQueryData(cartWishlistQueryKeys.cart, cart),
  });
}

/** Removes one Cart line and refreshes every consumer from the returned Cart. */
export function useRemoveCartItemMutation(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cartWishlistApi.removeCartItem(itemId),
    onSuccess: (cart) => queryClient.setQueryData(cartWishlistQueryKeys.cart, cart),
  });
}

/** Clears the Cart and replaces the cached preview with the empty server result. */
export function useClearCartMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cartWishlistApi.clearCart,
    onSuccess: (cart) => queryClient.setQueryData(cartWishlistQueryKeys.cart, cart),
  });
}

/** Saves one Product/variant and replaces the cached default Wishlist. */
export function useAddWishlistItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddWishlistItemInput) => cartWishlistApi.addWishlistItem(input),
    onSuccess: (wishlist) =>
      queryClient.setQueryData(cartWishlistQueryKeys.wishlist, wishlist),
  });
}

/** Removes one Wishlist item and replaces the cached default Wishlist. */
export function useRemoveWishlistItemMutation(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => cartWishlistApi.removeWishlistItem(itemId),
    onSuccess: (wishlist) =>
      queryClient.setQueryData(cartWishlistQueryKeys.wishlist, wishlist),
  });
}

/** Moves a variant-bound Wishlist item safely: removal happens only after Cart addition succeeds. */
export function useMoveWishlistItemToCartMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { wishlistItemId: string; variantId: string }) => {
      const cart = await cartWishlistApi.addCartItem({
        variantId: input.variantId,
        quantity: 1,
      });
      const wishlist = await cartWishlistApi.removeWishlistItem(input.wishlistItemId);
      return { cart, wishlist };
    },
    onSuccess: ({ cart, wishlist }) => {
      queryClient.setQueryData(cartWishlistQueryKeys.cart, cart);
      queryClient.setQueryData(cartWishlistQueryKeys.wishlist, wishlist);
    },
  });
}

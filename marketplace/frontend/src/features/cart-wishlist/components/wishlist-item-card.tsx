import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { formatMoney } from "@/lib/money";
import {
  useMoveWishlistItemToCartMutation,
  useRemoveWishlistItemMutation,
} from "../hooks/use-cart-wishlist";
import type { WishlistItem } from "../types/cart-wishlist.types";

/** Returns a short current-state label for one saved Wishlist item. */
function availabilityLabel(item: WishlistItem): string {
  if (!item.isPurchasable) return "Unavailable";
  if (!item.inStock) return "Out of stock";
  return "Available";
}

/** Renders one saved Wishlist item with safe remove and move-to-cart actions. */
export function WishlistItemCard({ item }: { item: WishlistItem }) {
  const remove = useRemoveWishlistItemMutation(item.id);
  const move = useMoveWishlistItemToCartMutation();
  const canMove = Boolean(item.variantId && item.isPurchasable);

  /** Adds the saved variant to Cart first, then removes the Wishlist item only after success. */
  function moveToCart(): void {
    if (!item.variantId) return;
    move.mutate({ wishlistItemId: item.id, variantId: item.variantId });
  }

  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {item.productSlug ? (
            <Link
              to="/products/$slug"
              params={{ slug: item.productSlug }}
              className="text-lg font-bold hover:underline"
            >
              {item.productName ?? "Product"}
            </Link>
          ) : (
            <h2 className="text-lg font-bold">{item.productName ?? "Unavailable Product"}</h2>
          )}
          <p className="mt-1 text-sm text-slate-600">
            {item.variantTitle ?? "Product saved without a selected variant"}
          </p>
          {item.currentUnitPrice && item.currency ? (
            <p className="mt-2 font-semibold">
              {formatMoney(item.currentUnitPrice, item.currency)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Current price is unavailable.</p>
          )}
          <p className="mt-2 text-sm text-slate-600">{availabilityLabel(item)}</p>
        </div>

        <div className="min-w-48 space-y-2">
          {canMove ? (
            <Button
              type="button"
              size="sm"
              disabled={move.isPending}
              onClick={moveToCart}
            >
              {move.isPending ? "Moving..." : "Move to Cart"}
            </Button>
          ) : item.productSlug ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/products/$slug" params={{ slug: item.productSlug }}>
                Choose a variant
              </Link>
            </Button>
          ) : null}
          <FormError error={move.error} />
          <FormError error={remove.error} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing..." : "Remove from Wishlist"}
          </Button>
        </div>
      </div>
    </article>
  );
}

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
export function WishlistItemCard({
  item,
  imageUrl,
  imageMimeType,
}: {
  item: WishlistItem;
  imageUrl?: string;
  imageMimeType?: string;
}) {
  const remove = useRemoveWishlistItemMutation(item.id);
  const move = useMoveWishlistItemToCartMutation();
  const canMove = Boolean(item.variantId && item.isPurchasable);
  const hasImage = Boolean(imageUrl && imageMimeType?.startsWith("image/"));

  /** Adds the saved variant to Cart first, then removes the Wishlist item only after success. */
  function moveToCart(): void {
    if (!item.variantId) return;
    move.mutate({ wishlistItemId: item.id, variantId: item.variantId });
  }

  return (
    <article className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="grid gap-0 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="bg-slate-100">
          {item.productSlug ? (
            <Link
              to="/products/$slug"
              params={{ slug: item.productSlug }}
              className="block aspect-square sm:h-full sm:min-h-44"
              aria-label={`View ${item.productName ?? "Product"}`}
            >
              {hasImage ? (
                <img
                  src={imageUrl}
                  alt={item.productName ?? "Product"}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-3xl text-slate-400" aria-hidden="true">
                  ◇
                </span>
              )}
            </Link>
          ) : (
            <div className="flex aspect-square h-full min-h-44 items-center justify-center text-3xl text-slate-400" aria-hidden="true">
              ◇
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-5 p-5">
          <div>
            {item.storeSlug && item.storeName ? (
              <Link
                to="/stores/$slug"
                params={{ slug: item.storeSlug }}
                className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
              >
                {item.storeName}
              </Link>
            ) : null}

            {item.productSlug ? (
              <h2 className="mt-1 text-lg font-bold">
                <Link to="/products/$slug" params={{ slug: item.productSlug }} className="hover:underline">
                  {item.productName ?? "Product"}
                </Link>
              </h2>
            ) : (
              <h2 className="mt-1 text-lg font-bold">{item.productName ?? "Unavailable Product"}</h2>
            )}

            <p className="mt-1 text-sm text-slate-600">
              {item.variantTitle ?? "Product saved without a selected variant"}
            </p>

            {item.currentUnitPrice && item.currency ? (
              <p className="mt-3 text-base font-bold">
                {formatMoney(item.currentUnitPrice, item.currency)}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Current price is unavailable.</p>
            )}

            <p className={`mt-2 text-sm ${item.isPurchasable && item.inStock ? "text-emerald-700" : "text-slate-500"}`}>
              {availabilityLabel(item)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing..." : "Remove"}
            </Button>
          </div>

          <FormError error={move.error} />
          <FormError error={remove.error} />
        </div>
      </div>
    </article>
  );
}

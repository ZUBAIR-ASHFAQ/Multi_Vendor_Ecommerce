import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { CouponField } from "@/features/promotions/components/coupon-field";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { CART_WISHLIST_PERMISSION } from "../cart-wishlist.constants";
import { CartItemCard } from "../components/cart-item-card";
import { CartWishlistLayout } from "../components/cart-wishlist-layout";
import { useCartQuery, useClearCartMutation } from "../hooks/use-cart-wishlist";
import type { CartItem } from "../types/cart-wishlist.types";

interface CartStoreGroup {
  key: string;
  storeSlug: string | null;
  storeName: string;
  items: CartItem[];
}

/** Groups Cart intent by the public Store identity returned by the server read model. */
function groupCartItems(items: CartItem[]): CartStoreGroup[] {
  const groups = new Map<string, CartStoreGroup>();

  for (const item of items) {
    const key = item.storeId ?? `unavailable:${item.productId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      storeSlug: item.storeSlug,
      storeName: item.storeName ?? "Unavailable seller",
      items: [item],
    });
  }

  return [...groups.values()];
}

/** Loads and renders the authenticated customer's Cart as a non-authoritative commerce preview. */
function CartContent() {
  const cart = useCartQuery();
  const clear = useClearCartMutation();
  const media = usePublicMediaQuery(cart.data?.items.map((item) => item.thumbnailFileId) ?? []);

  if (cart.isPending) return <LoadingState label="Loading Cart..." />;
  if (cart.isError) {
    return (
      <ErrorState
        title="Cart could not be loaded"
        message={cart.error instanceof Error ? cart.error.message : "Please try again."}
        requestId={cart.error instanceof ApiClientError ? cart.error.requestId : undefined}
        onRetry={() => void cart.refetch()}
      />
    );
  }

  const storeGroups = groupCartItems(cart.data.items);
  const totalQuantity = cart.data.items.reduce((total, item) => total + item.quantity, 0);
  const mediaById = new Map((media.data?.items ?? []).map((item) => [item.fileId, item]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Shopping cart</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Review your items</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Items are grouped by seller. Prices and availability are refreshed here, and Checkout recalculates the final order before confirmation.
          </p>
        </div>
        {cart.data.items.length > 0 ? (
          <Link to="/products" className="text-sm font-semibold text-slate-700 hover:text-slate-950">
            Continue shopping →
          </Link>
        ) : null}
      </header>

      {cart.data.items.length === 0 ? (
        <section className="rounded-2xl border bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl" aria-hidden="true">
            ◇
          </div>
          <h2 className="mt-4 text-xl font-bold">Your Cart is empty</h2>
          <p className="mt-2 text-sm text-slate-600">Browse the marketplace and add a Product variant when you are ready.</p>
          <Button className="mt-5" asChild>
            <Link to="/products">Browse Products</Link>
          </Button>
        </section>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {storeGroups.map((group) => (
              <section key={group.key} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sold by</p>
                    {group.storeSlug ? (
                      <Link
                        to="/stores/$slug"
                        params={{ slug: group.storeSlug }}
                        className="mt-0.5 inline-block font-bold text-slate-950 hover:underline"
                      >
                        {group.storeName}
                      </Link>
                    ) : (
                      <p className="mt-0.5 font-bold text-slate-950">{group.storeName}</p>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    {group.items.length} {group.items.length === 1 ? "line" : "lines"}
                  </p>
                </header>

                <div className="px-5">
                  {group.items.map((item) => {
                    const resolved = item.thumbnailFileId
                      ? mediaById.get(item.thumbnailFileId)
                      : undefined;
                    return (
                      <CartItemCard
                        key={item.id}
                        item={item}
                        imageUrl={resolved?.url}
                        imageMimeType={resolved?.mimeType}
                      />
                    );
                  })}
                </div>
              </section>
            ))}

            <CouponField />
          </div>

          <aside className="space-y-4 xl:sticky xl:top-28">
            <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-label="Order summary">
              <h2 className="text-lg font-bold text-slate-950">Order summary</h2>

              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">
                    Items ({totalQuantity})
                  </dt>
                  <dd className="font-semibold text-slate-950">
                    {formatMoney(cart.data.previewSubtotal, cart.data.currency)}
                  </dd>
                </div>
                <div className="border-t pt-4">
                  <div className="flex items-end justify-between gap-4">
                    <dt className="font-semibold text-slate-950">Preview subtotal</dt>
                    <dd className="text-2xl font-bold text-slate-950">
                      {formatMoney(cart.data.previewSubtotal, cart.data.currency)}
                    </dd>
                  </div>
                </div>
              </dl>

              {cart.data.hasUnavailableItems ? (
                <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  One or more items changed or are unavailable. Resolve those items before Checkout.
                </p>
              ) : null}

              {cart.data.hasUnavailableItems ? (
                <Button className="mt-5 w-full" disabled>
                  Proceed to Checkout
                </Button>
              ) : (
                <Button className="mt-5 w-full" asChild>
                  <Link to="/checkout">Proceed to Checkout</Link>
                </Button>
              )}

              <p className="mt-3 text-xs leading-5 text-slate-500">
                Shipping, promotions, tax, final pricing and stock are confirmed during Checkout. Inventory is not reserved yet.
              </p>
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-950">Need to start over?</p>
              <p className="mt-1 text-xs text-slate-500">Remove every item from this Cart.</p>
              <FormError error={clear.error} />
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                disabled={clear.isPending}
                onClick={() => clear.mutate()}
              >
                {clear.isPending ? "Clearing..." : "Clear Cart"}
              </Button>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

/** Protects the Cart route with the customer-owned Cart permission. */
export function CartPage() {
  return (
    <CartWishlistLayout permission={CART_WISHLIST_PERMISSION.CART_MANAGE_OWN}>
      <CartContent />
    </CartWishlistLayout>
  );
}

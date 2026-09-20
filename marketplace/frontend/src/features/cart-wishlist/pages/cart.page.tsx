import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { CART_WISHLIST_PERMISSION } from "../cart-wishlist.constants";
import { CartItemCard } from "../components/cart-item-card";
import { CouponField } from "@/features/promotions/components/coupon-field";
import { CartWishlistLayout } from "../components/cart-wishlist-layout";
import { useCartQuery, useClearCartMutation } from "../hooks/use-cart-wishlist";

/** Loads and renders the authenticated customer's Cart as a non-authoritative commerce preview. */
function CartContent() {
  const cart = useCartQuery();
  const clear = useClearCartMutation();

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

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Module 8 · Cart
            </p>
            <h1 className="mt-1 text-2xl font-bold">Your Cart</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Prices and availability shown here are current display information. Checkout will recalculate price,
              discounts, shipping, tax, and stock before any order is confirmed.
            </p>
          </div>
          {cart.data.items.length > 0 ? (
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Preview subtotal
              </p>
              <p className="text-2xl font-bold">
                {formatMoney(cart.data.previewSubtotal, cart.data.currency)}
              </p>
              <p className="text-xs text-slate-500">Not a final checkout total</p>
            </div>
          ) : null}
        </div>
        {cart.data.hasUnavailableItems ? (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            One or more Cart items changed or are unavailable. Review the warnings before future checkout.
          </p>
        ) : null}
      </section>

      {cart.data.items.length === 0 ? (
        <section className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold">Your Cart is empty</h2>
          <p className="mt-2 text-sm text-slate-600">Browse published Products and add a variant when you are ready.</p>
          <Button className="mt-4" asChild>
            <Link to="/products">Browse Products</Link>
          </Button>
        </section>
      ) : (
        <section className="space-y-3" aria-label="Cart items">
          {cart.data.items.map((item) => <CartItemCard key={item.id} item={item} />)}
        </section>
      )}

      {cart.data.items.length > 0 ? <CouponField /> : null}

      {cart.data.items.length > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 shadow-sm">
          <div>
            <p className="font-semibold">Cart preview only</p>
            <p className="text-sm text-slate-600">Inventory is not reserved until the later Checkout workflow.</p>
          </div>
          <div className="space-y-2 text-right">
            <FormError error={clear.error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild>
                <Link to="/checkout">Proceed to Checkout</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={clear.isPending}
                onClick={() => clear.mutate()}
              >
                {clear.isPending ? "Clearing..." : "Clear Cart"}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
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

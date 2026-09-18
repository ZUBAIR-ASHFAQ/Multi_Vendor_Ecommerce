import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api-error";
import { CART_WISHLIST_PERMISSION } from "../cart-wishlist.constants";
import { CartWishlistLayout } from "../components/cart-wishlist-layout";
import { WishlistItemCard } from "../components/wishlist-item-card";
import { useWishlistQuery } from "../hooks/use-cart-wishlist";

/** Loads and renders the authenticated customer's default Wishlist with current public Product display state. */
function WishlistContent() {
  const wishlist = useWishlistQuery();

  if (wishlist.isPending) return <LoadingState label="Loading Wishlist..." />;
  if (wishlist.isError) {
    return (
      <ErrorState
        title="Wishlist could not be loaded"
        message={wishlist.error instanceof Error ? wishlist.error.message : "Please try again."}
        requestId={wishlist.error instanceof ApiClientError ? wishlist.error.requestId : undefined}
        onRetry={() => void wishlist.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Module 8 · Wishlist
        </p>
        <h1 className="mt-1 text-2xl font-bold">{wishlist.data.name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Saved Products stay as customer intent. Current price and availability can change
          before an item reaches Cart or Checkout.
        </p>
      </section>

      {wishlist.data.items.length === 0 ? (
        <section className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-bold">Your Wishlist is empty</h2>
          <p className="mt-2 text-sm text-slate-600">Save a published Product variant to return to it later.</p>
          <Button className="mt-4" asChild>
            <Link to="/products">Browse Products</Link>
          </Button>
        </section>
      ) : (
        <section className="space-y-3" aria-label="Wishlist items">
          {wishlist.data.items.map((item) => (
            <WishlistItemCard key={item.id} item={item} />
          ))}
        </section>
      )}
    </div>
  );
}

/** Protects the Wishlist route with the customer-owned Wishlist permission. */
export function WishlistPage() {
  return (
    <CartWishlistLayout permission={CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN}>
      <WishlistContent />
    </CartWishlistLayout>
  );
}

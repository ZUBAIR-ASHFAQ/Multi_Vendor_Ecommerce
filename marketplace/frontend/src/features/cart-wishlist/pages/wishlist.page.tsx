import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { ApiClientError } from "@/lib/api-error";
import { CART_WISHLIST_PERMISSION } from "../cart-wishlist.constants";
import { CartWishlistLayout } from "../components/cart-wishlist-layout";
import { WishlistItemCard } from "../components/wishlist-item-card";
import { useWishlistQuery } from "../hooks/use-cart-wishlist";

/** Loads and renders the authenticated customer's default Wishlist with current public Product display state. */
function WishlistContent() {
  const wishlist = useWishlistQuery();
  const media = usePublicMediaQuery(wishlist.data?.items.map((item) => item.thumbnailFileId) ?? []);

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

  const mediaById = new Map((media.data?.items ?? []).map((item) => [item.fileId, item]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Saved items</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{wishlist.data.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Keep Products you are considering in one place. Current price and availability are refreshed whenever you return.
          </p>
        </div>
        {wishlist.data.items.length > 0 ? (
          <p className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
            {wishlist.data.items.length} {wishlist.data.items.length === 1 ? "item" : "items"}
          </p>
        ) : null}
      </header>

      {wishlist.data.items.length === 0 ? (
        <section className="rounded-2xl border bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl" aria-hidden="true">
            ♡
          </div>
          <h2 className="mt-4 text-xl font-bold">Your Wishlist is empty</h2>
          <p className="mt-2 text-sm text-slate-600">Save Products while browsing so you can compare or buy them later.</p>
          <Button className="mt-5" asChild>
            <Link to="/products">Browse Products</Link>
          </Button>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Wishlist items">
          {wishlist.data.items.map((item) => {
            const resolved = item.thumbnailFileId
              ? mediaById.get(item.thumbnailFileId)
              : undefined;
            return (
              <WishlistItemCard
                key={item.id}
                item={item}
                imageUrl={resolved?.url}
                imageMimeType={resolved?.mimeType}
              />
            );
          })}
        </section>
      )}
    </div>
  );
}

/** Protects the Wishlist route with the customer-owned Wishlist permission. */
export function WishlistPage() {
  return (
    <CartWishlistLayout
      permission={CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN}
      accountShell
    >
      <WishlistContent />
    </CartWishlistLayout>
  );
}

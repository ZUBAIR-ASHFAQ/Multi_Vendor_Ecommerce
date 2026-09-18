import { Link, useParams } from "@tanstack/react-router";
import { ProductCartWishlistActions } from "@/features/cart-wishlist/components/product-cart-wishlist-actions";
import { ProductReviewsSection } from "@/features/reviews/components/public-reviews-section";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { usePublicProductQuery } from "../hooks/use-products";

/** Renders one published Product detail using only fields allowed by the public Product contract. */
export function PublicProductDetailPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const product = usePublicProductQuery(slug);

  if (product.isPending) return <LoadingState label="Loading Product..." />;
  if (product.isError) {
    return (
      <ErrorState
        title="Product could not be loaded"
        message={product.error instanceof Error ? product.error.message : "Please try again."}
        onRetry={() => void product.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild><Link to="/products">← Back to Products</Link></Button>
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Published Product</p>
        <h1 className="mt-1 text-3xl font-bold">{product.data.name}</h1>
        <p className="mt-4 whitespace-pre-wrap text-slate-700">{product.data.description}</p>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Variants</h2>
        {product.data.variants.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No public variants are available.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {product.data.variants.map((variant) => (
              <article key={variant.id} className="rounded-lg border p-4">
                <h3 className="font-semibold">{variant.title}</h3>
                <p className="mt-1 text-sm text-slate-500">SKU {variant.sku}</p>
                <p className="mt-2 text-lg font-bold">{formatMoney(variant.price, variant.currency)}</p>
                {variant.compareAtPrice ? (
                  <p className="text-sm text-slate-500 line-through">
                    {formatMoney(variant.compareAtPrice, variant.currency)}
                  </p>
                ) : null}
                <ProductCartWishlistActions
                  productId={product.data.id}
                  variantId={variant.id}
                />
              </article>
            ))}
          </div>
        )}
      </section>

      <ProductReviewsSection productId={product.data.id} />

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Media</h2>
        <p className="mt-1 text-sm text-slate-600">
          The current Product API exposes safe media metadata/file IDs, not permanent public object-storage URLs.
        </p>
        {product.data.media.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No Product media has been linked yet.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {product.data.media
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((media) => (
                <li key={media.id} className="rounded-md border p-3">
                  {media.altText ?? "Product media"} · {media.mediaType}
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

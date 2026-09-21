import { Link } from "@tanstack/react-router";
import { ProductCartWishlistActions } from "@/features/cart-wishlist/components/product-cart-wishlist-actions";
import { formatMoney } from "@/lib/money";
import { useProductReviewsQuery } from "@/features/reviews/hooks/use-reviews";
import type { PublicProductDetail } from "../types/products.types";

/** Primary PDP buying surface; variant selection remains client-side while Cart/Checkout stay server-authoritative. */
export function PublicProductPurchasePanel({
  product,
  selectedVariantId,
  onVariantChange,
}: {
  product: PublicProductDetail;
  selectedVariantId: string | null;
  onVariantChange: (variantId: string) => void;
}) {
  const reviews = useProductReviewsQuery(product.id, { page: 1, pageSize: 1 });
  const rating = reviews.data?.rating;
  const selected = product.variants.find((variant) => variant.id === selectedVariantId) ?? product.variants[0];

  return (
    <section className="product-detail-purchase" aria-label="Product purchase options">
      <div className="product-detail-title-block">
        {product.brand ? <p className="product-detail-brand">{product.brand.name}</p> : null}
        <h1>{product.name}</h1>
        <div className="product-detail-meta-row">
          {rating ? (
            <span aria-label={`${rating.ratingAvg.toFixed(1)} out of 5 from ${rating.ratingCount} reviews`}>
              <span className="product-detail-stars" aria-hidden="true">★</span>{" "}
              {rating.ratingCount > 0 ? `${rating.ratingAvg.toFixed(1)} (${rating.ratingCount})` : "New"}
            </span>
          ) : null}
          <span>Sold by <Link to="/stores/$slug" params={{ slug: product.store.slug }}>{product.store.name}</Link></span>
        </div>
      </div>

      {selected ? (
        <>
          <div className="product-detail-price-block">
            <strong>{formatMoney(selected.price, selected.currency)}</strong>
            {selected.compareAtPrice ? (
              <del>{formatMoney(selected.compareAtPrice, selected.currency)}</del>
            ) : null}
          </div>

          {product.variants.length > 1 ? (
            <fieldset className="product-detail-variant-picker">
              <legend>Choose an option</legend>
              <div>
                {product.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className={variant.id === selected.id ? "is-active" : undefined}
                    aria-pressed={variant.id === selected.id}
                    onClick={() => onVariantChange(variant.id)}
                  >
                    <span>{variant.title}</span>
                    <small>
                      {formatMoney(variant.price, variant.currency)}
                      {variant.inStock ? "" : " · Out of stock"}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="product-detail-selected-sku">
            <span>Selected</span>
            <strong>{selected.title}</strong>
            <small>SKU {selected.sku}</small>
            <small role="status">{selected.inStock ? "In stock" : "Out of stock"}</small>
          </div>

          <ProductCartWishlistActions
            productId={product.id}
            productSlug={product.slug}
            variantId={selected.id}
            cartDisabled={!selected.inStock}
          />
        </>
      ) : (
        <div className="product-detail-unavailable">
          This product does not currently have a purchasable variant.
        </div>
      )}

      <div className="product-detail-assurance" aria-label="Purchase assurances">
        <div><span aria-hidden="true">✓</span><p><strong>Secure checkout</strong><small>Payment details are handled in the protected checkout flow.</small></p></div>
        <div><span aria-hidden="true">↻</span><p><strong>Server-verified totals</strong><small>Price, promotions and availability are rechecked before order creation.</small></p></div>
        <div><span aria-hidden="true">▣</span><p><strong>Marketplace seller</strong><small>Fulfilled by {product.store.name} on this marketplace.</small></p></div>
      </div>
    </section>
  );
}

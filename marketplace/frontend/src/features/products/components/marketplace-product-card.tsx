import { Link } from "@tanstack/react-router";
import { ApiClientError } from "@/lib/api-error";
import { useAddWishlistItemMutation } from "@/features/cart-wishlist/hooks/use-cart-wishlist";
import { formatMoney } from "@/lib/money";

/** Public card model shared by Product catalog and Search without coupling either feature to the other's API shape. */
export interface MarketplaceProductCardValue {
  productId: string;
  slug: string;
  name: string;
  minPrice: string;
  maxPrice: string;
  minCompareAtPrice?: string | null;
  maxCompareAtPrice?: string | null;
  currency: string;
  eyebrow?: string | null;
  secondaryLabel?: string | null;
  description?: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  inStock?: boolean;
}

/** Formats a Product price range while keeping authoritative decimal strings out of floating-point business logic. */
function priceLabel(product: MarketplaceProductCardValue): string {
  const minimum = formatMoney(product.minPrice, product.currency);
  if (product.minPrice === product.maxPrice) return minimum;
  return `${minimum} – ${formatMoney(product.maxPrice, product.currency)}`;
}


/** Formats a compare-at price/range only when the server supplied a meaningful discounted-variant range. */
function compareAtPriceLabel(product: MarketplaceProductCardValue): string | null {
  if (!product.minCompareAtPrice || !product.maxCompareAtPrice) return null;
  const minimum = formatMoney(product.minCompareAtPrice, product.currency);
  if (product.minCompareAtPrice === product.maxCompareAtPrice) return minimum;
  return `${minimum} – ${formatMoney(product.maxCompareAtPrice, product.currency)}`;
}

/** Shared marketplace Product card used by both browse and Search surfaces. */
export function MarketplaceProductCard({
  product,
  imageUrl,
  imageMimeType,
}: {
  product: MarketplaceProductCardValue;
  imageUrl?: string;
  imageMimeType?: string;
}) {
  const wishlist = useAddWishlistItemMutation();
  const authRequired = wishlist.error instanceof ApiClientError && wishlist.error.status === 401;
  const hasImage = Boolean(imageUrl && imageMimeType?.startsWith("image/"));
  const hasRating = product.ratingAvg !== undefined && product.ratingCount !== undefined;
  const ratingAverage = product.ratingAvg ?? 0;
  const ratingCount = product.ratingCount ?? 0;
  const compareAtLabel = compareAtPriceLabel(product);

  return (
    <article className="marketplace-product-card">
      <div className="marketplace-product-media">
        <Link
          to="/products/$slug"
          params={{ slug: product.slug }}
          aria-label={`View ${product.name}`}
          className="marketplace-product-media-link"
        >
          {hasImage ? (
            <img src={imageUrl} alt={product.name} loading="lazy" />
          ) : (
            <span className="marketplace-product-media-fallback" aria-hidden="true">◇</span>
          )}
        </Link>

        {product.inStock !== undefined ? (
          <span className={`marketplace-product-stock${product.inStock ? "" : " marketplace-product-stock-muted"}`}>
            {product.inStock ? "In stock" : "Out of stock"}
          </span>
        ) : null}

        <button
          type="button"
          className={`marketplace-product-wishlist${wishlist.isSuccess ? " is-saved" : ""}`}
          aria-label={wishlist.isSuccess ? `${product.name} saved to wishlist` : `Save ${product.name} to wishlist`}
          title={wishlist.isSuccess ? "Saved to wishlist" : "Save to wishlist"}
          disabled={wishlist.isPending}
          onClick={() => wishlist.mutate({ productId: product.productId })}
        >
          <span aria-hidden="true">{wishlist.isSuccess ? "♥" : "♡"}</span>
        </button>
      </div>

      <div className="marketplace-product-copy">
        {product.eyebrow ? <p className="marketplace-product-taxonomy">{product.eyebrow}</p> : null}
        <h2>
          <Link to="/products/$slug" params={{ slug: product.slug }}>{product.name}</Link>
        </h2>
        {product.secondaryLabel ? (
          <p className="marketplace-product-category">{product.secondaryLabel}</p>
        ) : product.description ? (
          <p className="marketplace-product-description">{product.description}</p>
        ) : null}

        {hasRating ? (
          <div
            className="marketplace-product-rating"
            aria-label={ratingCount > 0 ? `${ratingAverage.toFixed(1)} out of 5 from ${ratingCount} ratings` : "No ratings yet"}
          >
            <span aria-hidden="true">★</span>
            {ratingCount > 0
              ? `${ratingAverage.toFixed(1)} (${ratingCount})`
              : "New"}
          </div>
        ) : null}

        <div className="marketplace-product-footer">
          <div className="marketplace-product-pricing">
            <strong>{priceLabel(product)}</strong>
            {compareAtLabel ? <del>{compareAtLabel}</del> : null}
          </div>
          <Link to="/products/$slug" params={{ slug: product.slug }}>View product →</Link>
        </div>

        {authRequired ? (
          <p className="marketplace-product-auth-note">
            <Link to="/login">Sign in</Link> to save products to your wishlist.
          </p>
        ) : null}
      </div>
    </article>
  );
}

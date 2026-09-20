import {
  MarketplaceProductCard,
  type MarketplaceProductCardValue,
} from "@/features/products/components/marketplace-product-card";
import type { SearchProductCard as SearchProductCardValue } from "../schemas/search-discovery.schemas";

/** Adapts the Search projection into the shared marketplace Product card without changing Search's API contract. */
export function SearchProductCard({
  product,
  imageUrl,
  imageMimeType,
}: {
  product: SearchProductCardValue;
  imageUrl?: string;
  imageMimeType?: string;
}) {
  const card: MarketplaceProductCardValue = {
    productId: product.productId,
    slug: product.slug,
    name: product.name,
    minPrice: product.minPrice,
    maxPrice: product.maxPrice,
    currency: product.currency,
    eyebrow: product.brand ?? product.categoryPath,
    secondaryLabel: product.brand ? product.categoryPath : null,
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    inStock: product.inStock,
  };

  return (
    <MarketplaceProductCard
      product={card}
      imageUrl={imageUrl}
      imageMimeType={imageMimeType}
    />
  );
}

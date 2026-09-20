import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { ProductReviewsSection } from "@/features/reviews/components/public-reviews-section";
import { PublicProductDetailsSection } from "../components/public-product-details-section";
import { PublicProductGallery } from "../components/public-product-gallery";
import { PublicProductPurchasePanel } from "../components/public-product-purchase-panel";
import { RelatedProducts } from "../components/related-products";
import { usePublicProductQuery } from "../hooks/use-products";

/** Renders one published Product detail using the safe storefront projection returned by Module 6. */
export function PublicProductDetailPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const product = usePublicProductQuery(slug);
  const media = usePublicMediaQuery([
    ...(product.data?.media.map((item) => item.fileId) ?? []),
    product.data?.store.logoFileId,
  ]);
  const [requestedVariantId, setRequestedVariantId] = useState<string | null>(null);
  const selectedVariantId = product.data?.variants.some((variant) => variant.id === requestedVariantId)
    ? requestedVariantId
    : product.data?.variants[0]?.id ?? null;

  if (product.isPending) return <LoadingState label="Loading product..." />;
  if (product.isError) {
    return (
      <ErrorState
        title="Product could not be loaded"
        message={product.error instanceof Error ? product.error.message : "Please try again."}
        onRetry={() => void product.refetch()}
      />
    );
  }

  const resolvedLogo = product.data.store.logoFileId
    ? media.data?.items.find((item) => item.fileId === product.data.store.logoFileId)
    : undefined;

  return (
    <div className="product-detail-page">
      <nav className="product-detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to="/products">Products</Link>
        <span aria-hidden="true">/</span>
        <span>{product.data.category.name}</span>
      </nav>

      <div className="product-detail-hero">
        <PublicProductGallery
          productName={product.data.name}
          media={product.data.media}
          resolvedMedia={media.data?.items ?? []}
        />
        <PublicProductPurchasePanel
          product={product.data}
          selectedVariantId={selectedVariantId}
          onVariantChange={setRequestedVariantId}
        />
      </div>

      <section className="product-detail-seller-card" aria-labelledby="seller-card-heading">
        <div className="product-detail-seller-identity">
          {resolvedLogo?.mimeType.startsWith("image/") ? (
            <img src={resolvedLogo.url} alt={`${product.data.store.name} logo`} />
          ) : (
            <span className="product-detail-seller-logo-fallback" aria-hidden="true">
              {product.data.store.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <p>Marketplace seller</p>
            <h2 id="seller-card-heading">{product.data.store.name}</h2>
            <span>Operated by {product.data.store.seller.displayName}</span>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/stores/$slug" params={{ slug: product.data.store.slug }}>Visit store</Link>
        </Button>
      </section>

      <PublicProductDetailsSection product={product.data} selectedVariantId={selectedVariantId} />

      <div className="product-detail-reviews">
        <ProductReviewsSection productId={product.data.id} />
      </div>

      <RelatedProducts productId={product.data.id} categoryId={product.data.category.id} />
    </div>
  );
}

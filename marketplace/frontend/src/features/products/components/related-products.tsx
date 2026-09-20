import { MarketplaceProductCard } from "./marketplace-product-card";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { usePublicProductsQuery } from "../hooks/use-products";

/** Small related-products rail sourced from the existing public Product list in the same category. */
export function RelatedProducts({ productId, categoryId }: { productId: string; categoryId: string }) {
  const related = usePublicProductsQuery({
    page: 1,
    pageSize: 5,
    categoryId,
    sort: "createdAt",
    direction: "desc",
  });
  const items = (related.data?.items ?? []).filter((item) => item.id !== productId).slice(0, 4);
  const media = usePublicMediaQuery(items.map((item) => item.thumbnailFileId));
  const mediaById = new Map(media.data?.items.map((item) => [item.fileId, item]) ?? []);

  if (related.isError || (!related.isPending && items.length === 0)) return null;

  return (
    <section className="product-detail-related" aria-labelledby="related-products-heading">
      <div className="product-detail-section-heading">
        <div>
          <p className="product-detail-section-kicker">Keep exploring</p>
          <h2 id="related-products-heading">Related products</h2>
        </div>
      </div>
      {related.isPending ? (
        <div className="product-detail-related-grid" aria-label="Loading related products">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="product-detail-related-skeleton" />)}
        </div>
      ) : (
        <div className="product-detail-related-grid">
          {items.map((item) => {
            const resolved = item.thumbnailFileId ? mediaById.get(item.thumbnailFileId) : undefined;
            return (
              <MarketplaceProductCard
                key={item.id}
                product={{
                  productId: item.id,
                  slug: item.slug,
                  name: item.name,
                  minPrice: item.minPrice,
                  maxPrice: item.maxPrice,
                  currency: item.currency,
                  description: item.description,
                }}
                imageUrl={resolved?.url}
                imageMimeType={resolved?.mimeType}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

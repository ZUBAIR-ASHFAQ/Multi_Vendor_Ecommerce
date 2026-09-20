import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MarketplaceProductCard } from "@/features/products/components/marketplace-product-card";
import { ProductPagination } from "@/features/products/components/product-pagination";
import { usePublicProductsQuery } from "@/features/products/hooks/use-products";
import type { PublicProductListParams } from "@/features/products/types/products.types";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { StoreReviewsSection } from "@/features/reviews/components/public-reviews-section";
import { usePublicStoreQuery } from "../hooks/use-sellers";
import type { PublicStore } from "../types/sellers.types";

type StorefrontTab = "shop" | "reviews" | "about";
type StorefrontSort = "newest" | "name-asc" | "name-desc";

/** Converts the storefront's compact sort control into the existing public Product list contract. */
function productSort(sort: StorefrontSort): Pick<PublicProductListParams, "sort" | "direction"> {
  if (sort === "name-asc") return { sort: "name", direction: "asc" };
  if (sort === "name-desc") return { sort: "name", direction: "desc" };
  return { sort: "createdAt", direction: "desc" };
}

/** Renders the shoppable public storefront once Module 4 has resolved the public-safe Store. */
function StorefrontContent({ store }: { store: PublicStore }) {
  const [activeTab, setActiveTab] = useState<StorefrontTab>("shop");
  const [params, setParams] = useState<PublicProductListParams>({
    storeId: store.id,
    page: 1,
    pageSize: 12,
    sort: "createdAt",
    direction: "desc",
  });
  const products = usePublicProductsQuery(params);
  const productItems = products.data?.items ?? [];
  const publicMedia = usePublicMediaQuery([
    store.logoFileId,
    ...productItems.map((product) => product.thumbnailFileId),
  ]);
  const mediaById = new Map(publicMedia.data?.items.map((item) => [item.fileId, item]) ?? []);
  const resolvedLogo = store.logoFileId ? mediaById.get(store.logoFileId) : undefined;
  const filterForm = useForm({
    defaultValues: { q: "", sort: "newest" as StorefrontSort },
    onSubmit: async ({ value }) => {
      setParams((current) => ({
        ...current,
        page: 1,
        q: value.q.trim() || undefined,
        ...productSort(value.sort),
      }));
    },
  });
  const productCount = products.data?.meta.totalItems;

  return (
    <div className="public-storefront-page">
      <section className="public-storefront-hero">
        <div className="public-storefront-identity">
          {resolvedLogo?.mimeType.startsWith("image/") ? (
            <img src={resolvedLogo.url} alt={`${store.name} logo`} className="public-storefront-logo" />
          ) : (
            <div className="public-storefront-logo public-storefront-logo-fallback" aria-hidden="true">
              {store.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="public-storefront-heading">
            <p>Marketplace storefront</p>
            <h1>{store.name}</h1>
            <span>Sold by {store.seller.displayName}</span>
          </div>
        </div>

        <p className="public-storefront-description">
          {store.description ?? "This store has not added a public description yet."}
        </p>

        <dl className="public-storefront-facts">
          <div>
            <dt>Products</dt>
            <dd>{productCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{store.defaultCurrency}</dd>
          </div>
          <div>
            <dt>Support</dt>
            <dd>{store.supportEmail ? "Available" : "Not published"}</dd>
          </div>
        </dl>
      </section>

      <nav className="public-storefront-tabs" role="tablist" aria-label={`${store.name} sections`}>
        {(["shop", "reviews", "about"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "shop" ? "Shop" : tab === "reviews" ? "Reviews" : "About"}
          </button>
        ))}
      </nav>

      {activeTab === "shop" ? (
        <section className="public-storefront-shop" role="tabpanel">
          <div className="public-storefront-section-heading">
            <div>
              <p>Store catalog</p>
              <h2>Shop {store.name}</h2>
            </div>
            {products.data ? (
              <span aria-live="polite">
                {products.data.meta.totalItems} {products.data.meta.totalItems === 1 ? "product" : "products"}
              </span>
            ) : null}
          </div>

          <form
            className="public-storefront-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void filterForm.handleSubmit();
            }}
          >
            <filterForm.Field name="q">
              {(field) => (
                <Input
                  aria-label={`Search ${store.name} products`}
                  placeholder={`Search ${store.name}`}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              )}
            </filterForm.Field>
            <filterForm.Field name="sort">
              {(field) => (
                <Select
                  aria-label="Store product sort"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value as StorefrontSort)}
                >
                  <option value="newest">Newest</option>
                  <option value="name-asc">Name A–Z</option>
                  <option value="name-desc">Name Z–A</option>
                </Select>
              )}
            </filterForm.Field>
            <Button>Apply</Button>
          </form>

          {products.isPending ? <LoadingState label={`Loading ${store.name} products...`} /> : null}
          {products.isError ? (
            <ErrorState
              title="Store products could not be loaded"
              message={products.error instanceof Error ? products.error.message : "Please try again."}
              onRetry={() => void products.refetch()}
            />
          ) : null}
          {products.data ? (
            <>
              {productItems.length === 0 ? (
                <div className="public-storefront-empty">
                  <span aria-hidden="true">◇</span>
                  <h3>No products found</h3>
                  <p>
                    {params.q
                      ? `No products in ${store.name} match “${params.q}”. Try a broader search.`
                      : "This store does not currently have published products available."}
                  </p>
                </div>
              ) : (
                <div className="public-storefront-product-grid">
                  {productItems.map((product) => {
                    const image = product.thumbnailFileId ? mediaById.get(product.thumbnailFileId) : undefined;
                    return (
                      <MarketplaceProductCard
                        key={product.id}
                        product={{
                          productId: product.id,
                          slug: product.slug,
                          name: product.name,
                          description: product.description,
                          minPrice: product.minPrice,
                          maxPrice: product.maxPrice,
                          currency: product.currency,
                        }}
                        imageUrl={image?.url}
                        imageMimeType={image?.mimeType}
                      />
                    );
                  })}
                </div>
              )}
              <ProductPagination
                meta={products.data.meta}
                onPageChange={(page) => setParams((current) => ({ ...current, page }))}
              />
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === "reviews" ? (
        <div role="tabpanel" className="public-storefront-panel">
          <StoreReviewsSection storeId={store.id} />
        </div>
      ) : null}

      {activeTab === "about" ? (
        <section role="tabpanel" className="public-storefront-about">
          <div>
            <p>About the store</p>
            <h2>{store.name}</h2>
            <span>{store.description ?? "This store has not added a public description yet."}</span>
          </div>
          <dl>
            <div><dt>Seller</dt><dd>{store.seller.displayName}</dd></div>
            <div><dt>Default currency</dt><dd>{store.defaultCurrency}</dd></div>
            <div>
              <dt>Customer support</dt>
              <dd>
                {store.supportEmail ? <a href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a> : "Not published"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** Loads one public-safe Store and delegates storefront commerce to existing Product/Review contracts. */
export function PublicStorePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const store = usePublicStoreQuery(slug);

  if (store.isPending) return <LoadingState label="Loading store..." />;
  if (store.isError) {
    return (
      <ErrorState
        title="Store unavailable"
        message={store.error instanceof Error ? store.error.message : "The store could not be loaded."}
        onRetry={() => void store.refetch()}
      />
    );
  }

  return <StorefrontContent store={store.data} />;
}

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { MarketplaceProductCard } from "../components/marketplace-product-card";
import { ProductPagination } from "../components/product-pagination";
import { PUBLIC_PRODUCT_SORT_OPTIONS } from "../products.constants";
import { usePublicProductsQuery } from "../hooks/use-products";
import type { PublicProductListParams } from "../types/products.types";

/** Displays the public Product catalog using only the published public-safe Product API. */
export function PublicProductsPage() {
  const [params, setParams] = useState<PublicProductListParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    direction: "desc",
  });
  const products = usePublicProductsQuery(params);
  const productItems = products.data?.items ?? [];
  const publicMedia = usePublicMediaQuery(productItems.map((product) => product.thumbnailFileId));
  const mediaById = new Map(publicMedia.data?.items.map((item) => [item.fileId, item]) ?? []);
  const filterForm = useForm({
    defaultValues: { q: "", sort: "createdAt" as const, direction: "desc" as const },
    onSubmit: async ({ value }) => {
      setParams((current) => ({
        ...current,
        page: 1,
        q: value.q.trim() || undefined,
        sort: value.sort,
        direction: value.direction,
      }));
    },
  });

  return (
    <div className="public-product-catalog">
      <section className="public-product-hero">
        <div>
          <p className="public-product-eyebrow">Marketplace catalog</p>
          <h1>Browse products</h1>
          <p>
            Explore published products from active marketplace stores. Product pricing remains
            server-authoritative and is revalidated during checkout.
          </p>
        </div>
        {products.data ? (
          <p className="public-product-result-count" aria-live="polite">
            <strong>{products.data.meta.totalItems}</strong> published {products.data.meta.totalItems === 1 ? "product" : "products"}
          </p>
        ) : null}
      </section>

      <form
        className="public-product-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void filterForm.handleSubmit();
        }}
      >
        <filterForm.Field name="q">
          {(field) => (
            <Input
              aria-label="Search Products"
              placeholder="Search products"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </filterForm.Field>
        <filterForm.Field name="sort">
          {(field) => (
            <Select
              aria-label="Public Product sort"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as "createdAt" | "name")}
            >
              {PUBLIC_PRODUCT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          )}
        </filterForm.Field>
        <filterForm.Field name="direction">
          {(field) => (
            <Select
              aria-label="Public Product sort direction"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as "asc" | "desc")}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </Select>
          )}
        </filterForm.Field>
        <Button>Apply</Button>
      </form>

      {products.isPending ? <LoadingState label="Loading Products..." /> : null}
      {products.isError ? (
        <ErrorState
          title="Products could not be loaded"
          message={products.error instanceof Error ? products.error.message : "Please try again."}
          onRetry={() => void products.refetch()}
        />
      ) : null}
      {products.data ? (
        <>
          {productItems.length === 0 ? (
            <div className="public-product-empty">
              <span aria-hidden="true">◇</span>
              <h2>No products match these filters</h2>
              <p>Try a broader product name or change the current sort options.</p>
            </div>
          ) : (
            <div className="public-product-grid">
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
    </div>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { SellerLayout, RequireSellerPermission } from "@/features/sellers/components/seller-layout";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ProductPagination } from "../components/product-pagination";
import { ProductStatusBadge } from "../components/product-status-badge";
import {
  PRODUCT_PERMISSION,
  PRODUCT_PUBLICATION_STATUS,
  SELLER_PRODUCT_SORT_OPTIONS,
} from "../products.constants";
import { useSellerProductsQuery } from "../hooks/use-products";
import type { SellerProductListItem, SellerProductListParams } from "../types/products.types";

/** Formats one seller Product price range without introducing floating-point money calculations. */
function productPriceLabel(product: SellerProductListItem): string {
  if (product.minPrice === null || product.maxPrice === null) return "No variants";
  if (product.priceCurrency === null) return "Multiple currencies";
  const minimum = formatMoney(product.minPrice, product.priceCurrency);
  return product.minPrice === product.maxPrice
    ? minimum
    : `${minimum} – ${formatMoney(product.maxPrice, product.priceCurrency)}`;
}

/** Renders the seller Product table with server-side filters and management context. */
function SellerProductsContent({
  canCreate,
  canReadInventory,
}: {
  canCreate: boolean;
  canReadInventory: boolean;
}) {
  const [params, setParams] = useState<SellerProductListParams>({
    page: 1,
    pageSize: 20,
    sort: "updatedAt",
    direction: "desc",
  });
  const products = useSellerProductsQuery(params);
  const publicMedia = usePublicMediaQuery(
    products.data?.items
      .filter((product) => product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED)
      .map((product) => product.thumbnailFileId) ?? [],
  );
  const mediaById = new Map(publicMedia.data?.items.map((item) => [item.fileId, item]) ?? []);
  const filterForm = useForm({
    defaultValues: {
      q: "",
      publicationStatus: "",
      sort: "updatedAt" as const,
      direction: "desc" as const,
    },
    onSubmit: async ({ value }) => {
      setParams((current) => ({
        ...current,
        page: 1,
        q: value.q.trim() || undefined,
        publicationStatus: value.publicationStatus
          ? (value.publicationStatus as SellerProductListParams["publicationStatus"])
          : undefined,
        sort: value.sort,
        direction: value.direction,
      }));
    },
  });

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog</p>
            <h1 className="mt-1 text-2xl font-bold">Products</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage listings, variants, pricing, media, publication, and inventory handoff from one catalog view.
            </p>
          </div>
          {canCreate ? <Button asChild><Link to="/seller/products/new">Create Product</Link></Button> : null}
        </div>

        <form
          className="mt-5 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void filterForm.handleSubmit();
          }}
        >
          <filterForm.Field name="q">
            {(field) => (
              <input
                aria-label="Seller Product search"
                placeholder="Search name, slug, or description"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </filterForm.Field>
          <filterForm.Field name="publicationStatus">
            {(field) => (
              <select
                aria-label="Seller Product publication status"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">All publication states</option>
                {Object.values(PRODUCT_PUBLICATION_STATUS).map((status) => (
                  <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                ))}
              </select>
            )}
          </filterForm.Field>
          <filterForm.Field name="sort">
            {(field) => (
              <select
                aria-label="Seller Product sort"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as SellerProductListParams["sort"] & string)}
              >
                {SELLER_PRODUCT_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </filterForm.Field>
          <filterForm.Field name="direction">
            {(field) => (
              <select
                aria-label="Seller Product sort direction"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "asc" | "desc")}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            )}
          </filterForm.Field>
          <Button>Apply</Button>
        </form>
      </section>

      {products.isPending ? <LoadingState label="Loading seller Products..." /> : null}
      {products.isError ? (
        <ErrorState
          title="Seller Products could not be loaded"
          message={products.error instanceof Error ? products.error.message : "Please try again."}
          onRetry={() => void products.refetch()}
        />
      ) : null}
      {products.data ? (
        <>
          {products.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No Products match these filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Store</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Publication</th>
                    <th className="px-4 py-3">Variants</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.data.items.map((product) => {
                    const media = product.thumbnailFileId ? mediaById.get(product.thumbnailFileId) : undefined;
                    const canRenderImage = Boolean(media?.mimeType.startsWith("image/"));
                    return (
                      <tr key={product.id} className="border-b align-middle last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex min-w-64 items-center gap-3">
                            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border bg-slate-50 text-slate-400">
                              {canRenderImage && media ? (
                                <img src={media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <span aria-hidden="true">◇</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <Link
                                className="font-semibold text-slate-950 hover:underline"
                                to="/seller/products/$productId"
                                params={{ productId: product.id }}
                              >
                                {product.name}
                              </Link>
                              <span className="block truncate text-xs text-slate-500">/{product.slug}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <strong className="block font-medium text-slate-900">{product.storeName}</strong>
                          <span className="text-xs text-slate-500">{product.storeCurrency}</span>
                        </td>
                        <td className="px-4 py-3"><ProductStatusBadge status={product.status} /></td>
                        <td className="px-4 py-3"><ProductStatusBadge status={product.publicationStatus} /></td>
                        <td className="px-4 py-3">
                          <strong className="block">{product.variantCount}</strong>
                          {canReadInventory && product.variantCount > 0 ? (
                            <Link className="text-xs font-medium text-emerald-700 hover:underline" to="/seller/inventory">Manage stock</Link>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-semibold">{productPriceLabel(product)}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDateTime(product.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" asChild>
                            <Link to="/seller/products/$productId" params={{ productId: product.id }}>Open</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <ProductPagination meta={products.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
        </>
      ) : null}
    </div>
  );
}

/** Protects the seller Product table with the Module 6 seller read permission. */
export function SellerProductsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={PRODUCT_PERMISSION.SELLER_READ}>
          <SellerProductsContent
            canCreate={user.permissions.includes(PRODUCT_PERMISSION.SELLER_CREATE)}
            canReadInventory={user.permissions.includes("inventory.read")}
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

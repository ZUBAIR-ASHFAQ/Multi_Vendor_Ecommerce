import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { SellerLayout, RequireSellerPermission } from "@/features/sellers/components/seller-layout";
import { ProductPagination } from "../components/product-pagination";
import { ProductStatusBadge } from "../components/product-status-badge";
import {
  PRODUCT_PERMISSION,
  PRODUCT_PUBLICATION_STATUS,
  SELLER_PRODUCT_SORT_OPTIONS,
} from "../products.constants";
import { useSellerProductsQuery } from "../hooks/use-products";
import type { SellerProductListParams } from "../types/products.types";

/** Renders the seller Product table with server-side filters and pagination. */
function SellerProductsContent({ canCreate }: { canCreate: boolean }) {
  const [params, setParams] = useState<SellerProductListParams>({
    page: 1,
    pageSize: 20,
    sort: "updatedAt",
    direction: "desc",
  });
  const products = useSellerProductsQuery(params);
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
            <h1 className="text-2xl font-bold">Products</h1>
            <p className="mt-1 text-sm text-slate-600">Manage Product drafts, variants, prices, media, and publication state.</p>
          </div>
          {canCreate ? <Button asChild><Link to="/seller/products/new">Create Product</Link></Button> : null}
        </div>

        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void filterForm.handleSubmit();
          }}
        >
          <filterForm.Field name="q">
            {(field) => (
              <input
                aria-label="Seller Product search"
                placeholder="Search Products"
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
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Publication</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {products.data.items.map((product) => (
                    <tr key={product.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <strong>{product.name}</strong>
                        <span className="block text-xs text-slate-500">/{product.slug}</span>
                      </td>
                      <td className="px-4 py-3"><ProductStatusBadge status={product.status} /></td>
                      <td className="px-4 py-3"><ProductStatusBadge status={product.publicationStatus} /></td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/seller/products/$productId"
                            params={{ productId: product.id }}
                          >
                            Open
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
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
          <SellerProductsContent canCreate={user.permissions.includes(PRODUCT_PERMISSION.SELLER_CREATE)} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { formatDateTime } from "@/lib/dates";
import { ProductPagination } from "../components/product-pagination";
import { ProductStatusBadge } from "../components/product-status-badge";
import { useAdminProductsQuery } from "../hooks/use-products";
import { PRODUCT_PERMISSION, PRODUCT_PUBLICATION_STATUS } from "../products.constants";
import type { AdminProductListParams, ProductPublicationStatus } from "../types/products.types";

/** Renders the platform-wide product approval queue. */
function AdminProductsContent() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductPublicationStatus>(
    PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL,
  );
  const [params, setParams] = useState<AdminProductListParams>({
    page: 1,
    pageSize: 20,
    publicationStatus: PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL,
    sort: "updatedAt",
    direction: "asc",
  });
  const products = useAdminProductsQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Product approvals</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review seller submissions before they go live. Rejections require a clear seller-visible reason.
        </p>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setParams((current) => ({
              ...current,
              page: 1,
              q: search.trim() || undefined,
              publicationStatus: status,
            }));
          }}
        >
          <input
            aria-label="Search products for moderation"
            className="rounded-md border px-3 py-2"
            placeholder="Search product name or slug"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Product moderation status"
            className="rounded-md border px-3 py-2"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProductPublicationStatus)}
          >
            {Object.values(PRODUCT_PUBLICATION_STATUS).map((value) => (
              <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </select>
          <Button type="submit">Apply filters</Button>
        </form>
      </section>

      {products.isPending ? <LoadingState label="Loading product approval queue..." /> : null}
      {products.isError ? (
        <ErrorState
          title="Product approval queue could not be loaded"
          message={products.error instanceof Error ? products.error.message : "Please try again."}
          onRetry={() => void products.refetch()}
        />
      ) : null}

      {products.data?.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500 shadow-sm">
          No products match the current moderation filters.
        </p>
      ) : null}

      {products.data?.items.length ? (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Seller / store</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
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
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <span className="block break-all">Seller: {product.sellerId}</span>
                    <span className="block break-all">Store: {product.storeId}</span>
                  </td>
                  <td className="px-4 py-3"><ProductStatusBadge status={product.publicationStatus} /></td>
                  <td className="px-4 py-3">{formatDateTime(product.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/admin/products/$productId" params={{ productId: product.id }}>Review</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {products.data ? (
        <ProductPagination
          meta={products.data.meta}
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      ) : null}
    </div>
  );
}

/** Protects the product approval queue with the backend-aligned admin permission. */
export function AdminProductsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={PRODUCT_PERMISSION.ADMIN_REVIEW}>
          <AdminProductsContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  AdminQueueEmpty,
  AdminQueueHeader,
  AdminQueueTable,
  AdminQueueTableHead,
} from "@/features/administration/components/admin-queue";
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
      <AdminQueueHeader
        eyebrow="Marketplace moderation"
        title="Product approval queue"
        description="Review seller submissions before publication. Search and status filters use only the existing admin product API contract."
        meta={products.data?.meta}
        visibleCount={products.data?.items.length}
      />

      <form
        className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)_auto]"
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
        <label className="text-sm font-medium text-foreground">
          Search
          <Input
            aria-label="Search products for moderation"
            className="mt-1"
            placeholder="Product name or slug"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Publication status
          <Select
            aria-label="Product moderation status"
            className="mt-1"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProductPublicationStatus)}
          >
            {Object.values(PRODUCT_PUBLICATION_STATUS).map((value) => (
              <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </Select>
        </label>
        <div className="flex items-end">
          <Button className="w-full sm:w-auto" type="submit">Apply filters</Button>
        </div>
      </form>

      {products.isPending ? <LoadingState variant="table" label="Loading product approval queue..." /> : null}
      {products.isError ? (
        <ErrorState
          title="Product approval queue could not be loaded"
          message={products.error instanceof Error ? products.error.message : "Please try again."}
          onRetry={() => void products.refetch()}
        />
      ) : null}

      {products.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No products match these filters"
          description="Try another publication status or clear the search text. No moderation state is changed by filtering."
        />
      ) : null}

      {products.data?.items.length ? (
        <AdminQueueTable>
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Seller / store</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {products.data.items.map((product) => (
              <tr key={product.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{product.name}</strong>
                  <span className="block text-xs text-foreground-muted">/{product.slug}</span>
                </td>
                <td className="px-4 py-3 text-xs text-foreground-muted">
                  <span className="block break-all">Seller {product.sellerId}</span>
                  <span className="block break-all">Store {product.storeId}</span>
                </td>
                <td className="px-4 py-3"><ProductStatusBadge status={product.publicationStatus} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(product.updatedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/products/$productId" params={{ productId: product.id }}>Review</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
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

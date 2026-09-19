import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { FormError } from "@/features/auth/components/form-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ProductStatusBadge } from "../components/product-status-badge";
import {
  useAdminProductQuery,
  useApproveProductMutation,
  useRejectProductMutation,
} from "../hooks/use-products";
import { PRODUCT_LIMITS, PRODUCT_PERMISSION, PRODUCT_PUBLICATION_STATUS } from "../products.constants";

/** Loads the complete submission and exposes explicit approve/reject decisions. */
function AdminProductReviewContent({ productId }: { productId: string }) {
  const [reason, setReason] = useState("");
  const product = useAdminProductQuery(productId);
  const approve = useApproveProductMutation(productId);
  const reject = useRejectProductMutation(productId);

  if (product.isPending) return <LoadingState label="Loading product submission..." />;
  if (product.isError) {
    return (
      <ErrorState
        title="Product submission could not be loaded"
        message={product.error instanceof Error ? product.error.message : "Please try again."}
        onRetry={() => void product.refetch()}
      />
    );
  }

  const item = product.data;
  const pending = item.publicationStatus === PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Product moderation</p>
            <h1 className="mt-1 text-2xl font-bold">{item.name}</h1>
            <p className="mt-1 text-sm text-slate-500">/{item.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            <ProductStatusBadge status={item.status} />
            <ProductStatusBadge status={item.publicationStatus} />
            <Button variant="ghost" asChild><Link to="/admin/products">Back to queue</Link></Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Submission details</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="font-semibold text-slate-500">Seller</dt><dd className="break-all">{item.sellerId}</dd></div>
          <div><dt className="font-semibold text-slate-500">Store</dt><dd className="break-all">{item.storeId}</dd></div>
          <div><dt className="font-semibold text-slate-500">Category</dt><dd className="break-all">{item.categoryId}</dd></div>
          <div><dt className="font-semibold text-slate-500">Brand</dt><dd className="break-all">{item.brandId ?? "No brand"}</dd></div>
          <div><dt className="font-semibold text-slate-500">Created</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Updated</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
        </dl>
        {item.moderationReason ? (
          <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <strong>Last rejection reason</strong>
            <p className="mt-1 whitespace-pre-wrap">{item.moderationReason}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Variants and pricing</h2>
        <div className="mt-4 space-y-3">
          {item.variants.length === 0 ? <p className="text-sm text-red-700">No variants supplied.</p> : item.variants.map((variant) => (
            <article key={variant.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
              <div><strong>{variant.title}</strong><span className="block text-xs text-slate-500">SKU {variant.sku} · {variant.status}</span></div>
              <strong>{formatMoney(variant.price, variant.currency)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Media</h2>
        <div className="mt-4 space-y-2">
          {item.media.length === 0 ? <p className="text-sm text-red-700">No product media supplied.</p> : item.media.map((media) => (
            <div key={media.id} className="rounded-md border p-3 text-sm">
              <strong>{media.altText || "Product image"}</strong>
              <span className="block break-all text-xs text-slate-500">File {media.fileId} · {media.mediaType} · sort {media.sortOrder}</span>
            </div>
          ))}
        </div>
      </section>

      {pending ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Moderation decision</h2>
          <p className="mt-1 text-sm text-slate-600">Approval publishes the product immediately. A rejection returns it to the seller for correction.</p>
          <div className="mt-5 space-y-2">
            <label htmlFor="product-rejection-reason" className="text-sm font-semibold">Rejection reason</label>
            <textarea
              id="product-rejection-reason"
              className="min-h-28 w-full rounded-md border px-3 py-2"
              maxLength={PRODUCT_LIMITS.MODERATION_REASON_MAX_LENGTH}
              placeholder="Explain exactly what the seller must correct"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-slate-500">Required only for rejection · {reason.length}/{PRODUCT_LIMITS.MODERATION_REASON_MAX_LENGTH}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={approve.isPending || reject.isPending}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? "Approving..." : "Approve and publish"}
            </Button>
            <Button
              variant="outline"
              disabled={!reason.trim() || approve.isPending || reject.isPending}
              onClick={() => reject.mutate({ reason: reason.trim() })}
            >
              {reject.isPending ? "Rejecting..." : "Reject and return to seller"}
            </Button>
          </div>
          <div className="mt-4 space-y-2"><FormError error={approve.error} /><FormError error={reject.error} /></div>
        </section>
      ) : (
        <section className="rounded-xl border bg-slate-50 p-5 text-sm text-slate-700">
          This product is no longer awaiting a moderation decision.
          {item.reviewedAt ? ` Reviewed ${formatDateTime(item.reviewedAt)}.` : ""}
        </section>
      )}
    </div>
  );
}

/** Protects one product moderation detail page with the admin review permission. */
export function AdminProductReviewPage() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={PRODUCT_PERMISSION.ADMIN_REVIEW}>
          <AdminProductReviewContent productId={productId} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

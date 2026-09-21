import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/feedback/confirmation-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
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
  const [confirmReject, setConfirmReject] = useState(false);
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
      <PageHeader
        eyebrow="Marketplace moderation · Product"
        title={item.name}
        description={`/${item.slug}`}
        actions={(
          <>
            <ProductStatusBadge status={item.status} />
            <ProductStatusBadge status={item.publicationStatus} />
            <Button variant="outline" asChild><Link to="/admin/products">Back to queue</Link></Button>
          </>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Surface>
            <h2 className="text-lg font-semibold text-foreground">Submission details</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-muted">{item.description}</p>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="font-semibold text-foreground-muted">Seller</dt><dd className="break-all">{item.sellerId}</dd></div>
              <div><dt className="font-semibold text-foreground-muted">Store</dt><dd className="break-all">{item.storeId}</dd></div>
              <div><dt className="font-semibold text-foreground-muted">Category</dt><dd className="break-all">{item.categoryId}</dd></div>
              <div><dt className="font-semibold text-foreground-muted">Brand</dt><dd className="break-all">{item.brandId ?? "No brand"}</dd></div>
              <div><dt className="font-semibold text-foreground-muted">Created</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
              <div><dt className="font-semibold text-foreground-muted">Updated</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
            </dl>
            {item.moderationReason ? (
              <div className="mt-5 rounded-control border border-negative/20 bg-negative-soft p-4 text-sm text-negative">
                <strong>Last rejection reason</strong>
                <p className="mt-1 whitespace-pre-wrap">{item.moderationReason}</p>
              </div>
            ) : null}
          </Surface>

          <Surface>
            <h2 className="text-lg font-semibold text-foreground">Variants and pricing</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-[0.08em] text-foreground-muted">
                  <tr><th className="py-2 pr-4">Variant</th><th className="py-2 pr-4">SKU</th><th className="py-2 pr-4">State</th><th className="py-2 text-right">Price</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {item.variants.map((variant) => (
                    <tr key={variant.id}>
                      <td className="py-3 pr-4 font-medium">{variant.title}</td>
                      <td className="py-3 pr-4 text-foreground-muted">{variant.sku}</td>
                      <td className="py-3 pr-4 text-foreground-muted">{variant.status}</td>
                      <td className="py-3 text-right font-medium">{formatMoney(variant.price, variant.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {item.variants.length === 0 ? <p className="py-5 text-sm text-negative">No variants supplied.</p> : null}
            </div>
          </Surface>

          <Surface>
            <h2 className="text-lg font-semibold text-foreground">Media evidence</h2>
            <div className="mt-4 space-y-2">
              {item.media.length === 0 ? <p className="text-sm text-negative">No product media supplied.</p> : item.media.map((media) => (
                <div key={media.id} className="rounded-control border border-border p-3 text-sm">
                  <strong>{media.altText || "Product image"}</strong>
                  <span className="block break-all text-xs text-foreground-muted">File {media.fileId} · {media.mediaType} · sort {media.sortOrder}</span>
                </div>
              ))}
            </div>
          </Surface>
        </div>

        <div className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          {pending ? (
            <Surface variant="elevated">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground-muted">Primary decision</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">Moderation decision</h2>
              <p className="mt-2 text-sm leading-6 text-foreground-muted">
                Approval publishes immediately. Rejection returns the product to the seller with the reason below.
              </p>
              <div className="mt-5 space-y-2">
                <label htmlFor="product-rejection-reason" className="text-sm font-semibold">Rejection reason</label>
                <Textarea
                  id="product-rejection-reason"
                  className="min-h-32"
                  maxLength={PRODUCT_LIMITS.MODERATION_REASON_MAX_LENGTH}
                  placeholder="Explain exactly what the seller must correct"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p className="text-xs text-foreground-muted">Required only for rejection · {reason.length}/{PRODUCT_LIMITS.MODERATION_REASON_MAX_LENGTH}</p>
              </div>
              <div className="mt-4 grid gap-2">
                <Button
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => approve.mutate()}
                >
                  {approve.isPending ? "Approving..." : "Approve and publish"}
                </Button>
                <Button
                  variant="destructive"
                  disabled={!reason.trim() || approve.isPending || reject.isPending}
                  onClick={() => setConfirmReject(true)}
                >
                  {reject.isPending ? "Rejecting..." : "Reject and return"}
                </Button>
              </div>
              <div className="mt-4 space-y-2"><FormError error={approve.error} /><FormError error={reject.error} /></div>
            </Surface>
          ) : (
            <Surface variant="muted">
              <h2 className="font-semibold text-foreground">Decision complete</h2>
              <p className="mt-2 text-sm text-foreground-muted">
                This product is no longer awaiting moderation.
                {item.reviewedAt ? ` Reviewed ${formatDateTime(item.reviewedAt)}.` : ""}
              </p>
            </Surface>
          )}
        </div>
      </div>
      <ConfirmationDialog
        open={confirmReject}
        title="Reject this product?"
        description="The product will return to the seller and will not be publicly available. The rejection reason is recorded with the moderation decision."
        confirmLabel="Confirm rejection"
        isPending={reject.isPending}
        onCancel={() => setConfirmReject(false)}
        onConfirm={() => reject.mutate(
          { reason: reason.trim() },
          { onSettled: () => setConfirmReject(false) },
        )}
      />
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

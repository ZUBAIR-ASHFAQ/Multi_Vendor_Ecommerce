import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import {
  AdminQueueEmpty,
  AdminQueueHeader,
  AdminQueueTable,
  AdminQueueTableHead,
} from "@/features/administration/components/admin-queue";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { AdminReviewModerationActions } from "../components/admin-review-moderation-actions";
import { ReviewPagination } from "../components/review-pagination";
import { AdminReviewFilterForm } from "../forms/admin-review-filter.form";
import { useAdminReviewsQuery } from "../hooks/use-reviews";
import { REVIEWS_PERMISSION, REVIEW_STATUS_LABEL } from "../reviews.constants";
import type { AdminReview, AdminReviewListParams, AdminReviewStatus } from "../types/reviews.types";

/** Maps moderation status to the shared status-pill tone. */
function reviewTone(status: AdminReviewStatus): "warning" | "positive" | "negative" {
  if (status === "published") return "positive";
  if (status === "hidden") return "negative";
  return "warning";
}

/** Renders one selected privacy-safe moderation item with its explicit state transition commands. */
function AdminReviewDetail({ review }: { review: AdminReview }) {
  return (
    <Surface variant="elevated" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground-muted">Selected review</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{review.title || "Untitled review"}</h2>
          <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-foreground-muted">
            {review.body || "No written review text."}
          </p>
        </div>
        <StatusPill tone={reviewTone(review.status)}>{REVIEW_STATUS_LABEL[review.status]}</StatusPill>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="font-semibold text-foreground-muted">Rating</dt><dd>{review.rating} / 5</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Helpful</dt><dd>{review.helpfulCount}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Product</dt><dd className="break-all text-xs">{review.productId}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Store</dt><dd className="break-all text-xs">{review.storeId}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Seller</dt><dd className="break-all text-xs">{review.sellerId}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Created</dt><dd>{formatDateTime(review.createdAt)}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Verified purchase</dt><dd>{review.verifiedPurchase ? "Yes" : "No"}</dd></div>
      </dl>

      <AdminReviewModerationActions reviewId={review.id} status={review.status} />
    </Surface>
  );
}

/** Loads and renders the bounded admin Review moderation queue. */
function AdminReviewsContent() {
  const [params, setParams] = useState<AdminReviewListParams>({
    page: 1,
    pageSize: 20,
    status: "pending",
    sort: "created_desc",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reviews = useAdminReviewsQuery(params);
  const selected = reviews.data?.items.find((review) => review.id === selectedId);

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Commerce · Reviews"
        title="Review moderation queue"
        description="Use privacy-safe moderation fields and explicit publish or hide commands. The queue never exposes customer identity or order identity."
        meta={reviews.data?.meta}
        visibleCount={reviews.data?.items.length}
      />

      <div className="rounded-card border border-border bg-surface p-4 shadow-sm">
        <AdminReviewFilterForm
          onApply={(filters) => {
            setSelectedId(null);
            setParams((current) => ({
              ...current,
              ...filters,
              page: 1,
            }));
          }}
        />
      </div>

      {reviews.isPending ? <LoadingState variant="table" label="Loading review moderation queue..." /> : null}
      {reviews.isError ? (
        <ErrorState
          title="Review moderation queue could not be loaded"
          message={reviews.error instanceof Error ? reviews.error.message : "Please try again."}
          requestId={reviews.error instanceof ApiClientError ? reviews.error.requestId : undefined}
          onRetry={() => void reviews.refetch()}
        />
      ) : null}

      {reviews.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No reviews match these moderation filters"
          description="Change status, product, seller, store, or sort order to inspect another review set."
        />
      ) : null}

      {reviews.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[980px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Review</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Product / store</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {reviews.data.items.map((review) => (
              <tr key={review.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="max-w-sm px-4 py-3">
                  <strong className="block truncate text-foreground">{review.title || "Untitled review"}</strong>
                  <span className="block truncate text-xs text-foreground-muted">{review.body || "No written review text."}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{review.rating} / 5</td>
                <td className="px-4 py-3 text-xs text-foreground-muted">
                  <span className="block break-all">Product {review.productId}</span>
                  <span className="block break-all">Store {review.storeId}</span>
                </td>
                <td className="px-4 py-3"><StatusPill tone={reviewTone(review.status)}>{REVIEW_STATUS_LABEL[review.status]}</StatusPill></td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(review.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedId === review.id ? "secondary" : "outline"}
                    onClick={() => setSelectedId((current) => current === review.id ? null : review.id)}
                  >
                    {selectedId === review.id ? "Close moderation" : "Moderate"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {selected ? <AdminReviewDetail review={selected} /> : null}

      {reviews.data ? (
        <ReviewPagination
          meta={reviews.data.meta}
          onPageChange={(page) => {
            setSelectedId(null);
            setParams((current) => ({ ...current, page }));
          }}
        />
      ) : null}
    </div>
  );
}

/** Protects the admin Review moderation page with the server-derived moderation permission. */
export function AdminReviewsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={REVIEWS_PERMISSION.ADMIN_MODERATE}>
          <AdminReviewsContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

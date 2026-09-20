import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { AdminReviewModerationActions } from "../components/admin-review-moderation-actions";
import { ReviewPagination } from "../components/review-pagination";
import { AdminReviewFilterForm } from "../forms/admin-review-filter.form";
import { useAdminReviewsQuery } from "../hooks/use-reviews";
import { REVIEWS_PERMISSION, REVIEW_STATUS_LABEL } from "../reviews.constants";
import type { AdminReview, AdminReviewListParams } from "../types/reviews.types";

/** Renders one privacy-safe moderation queue item with its explicit state transition commands. */
function AdminReviewCard({ review }: { review: AdminReview }) {
  return (
    <article className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{review.title || "Untitled Review"}</h2>
          <p className="mt-1 text-sm text-slate-700">{review.body || "No written Review text."}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
          {REVIEW_STATUS_LABEL[review.status]}
        </span>
      </div>

      <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="font-semibold">Rating</dt><dd>{review.rating} / 5</dd></div>
        <div><dt className="font-semibold">Helpful</dt><dd>{review.helpfulCount}</dd></div>
        <div><dt className="font-semibold">Product</dt><dd className="break-all">{review.productId}</dd></div>
        <div><dt className="font-semibold">Store</dt><dd className="break-all">{review.storeId}</dd></div>
        <div><dt className="font-semibold">Seller</dt><dd className="break-all">{review.sellerId}</dd></div>
        <div><dt className="font-semibold">Created</dt><dd>{new Date(review.createdAt).toLocaleString()}</dd></div>
        <div><dt className="font-semibold">Verified purchase</dt><dd>{review.verifiedPurchase ? "Yes" : "No"}</dd></div>
      </dl>

      <AdminReviewModerationActions reviewId={review.id} status={review.status} />
    </article>
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
  const reviews = useAdminReviewsQuery(params);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Review moderation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Read only the approved moderation fields, then use explicit Hide or Publish commands with an audit reason.
        </p>
        <div className="mt-5">
          <AdminReviewFilterForm
            onApply={(filters) => setParams((current) => ({
              ...current,
              ...filters,
              page: 1,
            }))}
          />
        </div>
      </section>

      {reviews.isPending ? <LoadingState label="Loading Review moderation queue..." /> : null}
      {reviews.isError ? (
        <ErrorState
          title="Review moderation queue could not be loaded"
          message={reviews.error instanceof Error ? reviews.error.message : "Please try again."}
          requestId={reviews.error instanceof ApiClientError ? reviews.error.requestId : undefined}
          onRetry={() => void reviews.refetch()}
        />
      ) : null}

      {reviews.data?.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">
          No Reviews match the current moderation filters.
        </p>
      ) : null}

      {reviews.data?.items.map((review) => (
        <AdminReviewCard key={review.id} review={review} />
      ))}

      {reviews.data ? (
        <ReviewPagination
          meta={reviews.data.meta}
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
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

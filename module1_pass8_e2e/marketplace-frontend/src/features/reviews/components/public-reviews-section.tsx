import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiClientError } from "@/lib/api-error";
import { useProductReviewsQuery, useStoreReviewsQuery } from "../hooks/use-reviews";
import type { PublicReviewsPage } from "../types/reviews.types";
import { ReviewCard } from "./review-card";
import { ReviewPagination } from "./review-pagination";
import { ReviewRatingSummary } from "./review-rating-summary";

const PAGE_SIZE = 10;

interface ReviewsQueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data?: PublicReviewsPage;
  refetch: () => Promise<unknown>;
}

/** Renders one already-loaded public Review query without owning where its data came from. */
function ReviewsContent({
  title,
  query,
  onPageChange,
}: {
  title: string;
  query: ReviewsQueryState;
  onPageChange: (page: number) => void;
}) {
  if (query.isPending) return <LoadingState label={`Loading ${title.toLowerCase()}...`} />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={`${title} could not be loaded`}
        message={query.error instanceof Error ? query.error.message : "Please try again."}
        requestId={query.error instanceof ApiClientError ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">Only published verified-purchase Reviews are shown.</p>
        </div>
        <ReviewRatingSummary rating={query.data.rating} />
      </div>

      {query.data.items.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No published Reviews yet.</p>
      ) : (
        <div className="space-y-3">
          {query.data.items.map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}

      <ReviewPagination meta={query.data.meta} onPageChange={onPageChange} />
    </section>
  );
}

/** Loads published Reviews for one Product without exposing internal Review ownership data. */
export function ProductReviewsSection({ productId }: { productId: string }) {
  const [page, setPage] = useState(1);
  const reviews = useProductReviewsQuery(productId, { page, pageSize: PAGE_SIZE });
  return <ReviewsContent title="Customer Reviews" query={reviews} onPageChange={setPage} />;
}

/** Loads published Reviews for one Store using the canonical seller rating aggregate. */
export function StoreReviewsSection({ storeId }: { storeId: string }) {
  const [page, setPage] = useState(1);
  const reviews = useStoreReviewsQuery(storeId, { page, pageSize: PAGE_SIZE });
  return <ReviewsContent title="Store Reviews" query={reviews} onPageChange={setPage} />;
}

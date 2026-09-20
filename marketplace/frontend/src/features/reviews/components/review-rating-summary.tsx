import type { ReviewRatingSummary } from "../types/reviews.types";

/** Renders the published-only Review aggregate returned by the server. */
export function ReviewRatingSummary({ rating }: { rating: ReviewRatingSummary }) {
  const average = rating.ratingCount > 0 ? rating.ratingAvg.toFixed(1) : "—";

  return (
    <div className="flex flex-wrap items-baseline gap-2" aria-label="Review rating summary">
      <strong className="text-2xl">{average}</strong>
      <span aria-hidden="true" className="text-amber-500">★</span>
      <span className="text-sm text-slate-500">
        {rating.ratingCount} {rating.ratingCount === 1 ? "review" : "reviews"}
      </span>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { getAccessToken } from "@/lib/auth-session";
import { useMarkReviewHelpfulMutation } from "../hooks/use-reviews";
import type { PublicReview } from "../types/reviews.types";

/** Formats one persisted Review timestamp for presentation only. */
function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

/** Renders one privacy-safe public Review card plus the replay-safe Helpful action. */
export function ReviewCard({ review }: { review: PublicReview }) {
  const helpful = useMarkReviewHelpfulMutation(review.id);
  const signedIn = Boolean(getAccessToken());

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold" aria-label={`${review.rating} out of 5 stars`}>
            {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
          </p>
          {review.title ? <h3 className="mt-1 font-semibold">{review.title}</h3> : null}
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Verified purchase</p>
          <time dateTime={review.publishedAt}>{displayDate(review.publishedAt)}</time>
        </div>
      </div>

      {review.body ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{review.body}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {signedIn ? (
          <Button
            type="button"
            variant="outline"
            disabled={helpful.isPending || helpful.isSuccess}
            onClick={() => helpful.mutate()}
          >
            {helpful.isSuccess ? "Marked helpful" : helpful.isPending ? "Saving..." : "Helpful"}
          </Button>
        ) : (
          <Link className="text-sm font-medium underline" to="/login">Sign in to mark helpful</Link>
        )}
        <span className="text-sm text-slate-500">{review.helpfulCount} helpful</span>
      </div>
      <div className="mt-2"><FormError error={helpful.error} /></div>
    </article>
  );
}

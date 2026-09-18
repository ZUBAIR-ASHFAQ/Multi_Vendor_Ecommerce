import { useHideReviewMutation, usePublishReviewMutation } from "../hooks/use-reviews";
import { ReviewModerationForm } from "../forms/review-moderation.form";
import type { Review } from "../types/reviews.types";

/** Exposes only moderation commands that can move the current Review to a different state. */
export function AdminReviewModerationActions({
  reviewId,
  status,
}: {
  reviewId: string;
  status: Review["status"];
}) {
  const hide = useHideReviewMutation(reviewId);
  const publish = usePublishReviewMutation(reviewId);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {status !== "hidden" ? (
        <section className="rounded-lg border p-4">
          <h3 className="font-semibold">Hide Review</h3>
          <p className="mt-1 text-sm text-slate-600">Removes the Review from public lists and published aggregates.</p>
          <div className="mt-3">
            <ReviewModerationForm
              action="hide"
              isPending={hide.isPending}
              error={hide.error}
              onSubmit={(input) => hide.mutateAsync(input).then(() => undefined)}
            />
          </div>
        </section>
      ) : null}
      {status !== "published" ? (
        <section className="rounded-lg border p-4">
          <h3 className="font-semibold">Publish Review</h3>
          <p className="mt-1 text-sm text-slate-600">Publishes the Review and recalculates public rating aggregates.</p>
          <div className="mt-3">
            <ReviewModerationForm
              action="publish"
              isPending={publish.isPending}
              error={publish.error}
              onSubmit={(input) => publish.mutateAsync(input).then(() => undefined)}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

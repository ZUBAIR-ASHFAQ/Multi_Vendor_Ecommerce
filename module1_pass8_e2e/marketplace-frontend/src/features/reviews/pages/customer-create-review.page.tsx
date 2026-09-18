import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { ReviewEditorForm } from "../forms/review-editor.form";
import { useCreateReviewMutation, useUpdateOwnReviewMutation } from "../hooks/use-reviews";
import { REVIEWS_PERMISSION, REVIEW_STATUS_LABEL } from "../reviews.constants";
import type { Review } from "../types/reviews.types";

/** Lets the customer create one verified-purchase Review and edit the returned Review without trusting route-owned eligibility. */
function CustomerReviewEditor({
  orderId,
  orderItemId,
  canUpdate,
}: {
  orderId: string;
  orderItemId: string;
  canUpdate: boolean;
}) {
  const createReview = useCreateReviewMutation();
  const [createdReview, setCreatedReview] = useState<Review | null>(null);
  const updateReview = useUpdateOwnReviewMutation();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link className="text-sm underline" to="/orders/$orderId" params={{ orderId }}>← Back to Order</Link>
        <h1 className="mt-2 text-2xl font-bold">Review your purchase</h1>
        <p className="mt-1 text-sm text-slate-600">
          Order Item {orderItemId}. The server confirms ownership and full delivery before accepting the Review.
        </p>
      </div>

      {createdReview ? (
        <div className="rounded-xl border bg-emerald-50 p-4 text-sm text-emerald-900">
          Review saved. Current status: <strong>{REVIEW_STATUS_LABEL[createdReview.status]}</strong>.
        </div>
      ) : null}

      {createdReview && !canUpdate ? (
        <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
          Your Review was saved. Your current permissions do not allow editing it.
        </p>
      ) : (
        <ReviewEditorForm
          key={createdReview?.updatedAt ?? "create-review"}
          orderItemId={orderItemId}
          review={createdReview ?? undefined}
          isPending={createdReview ? updateReview.isPending : createReview.isPending}
          error={createdReview ? updateReview.error : createReview.error}
          onCreate={(input) =>
            createReview
              .mutateAsync(input)
              .then(setCreatedReview)
              .then(() => undefined)
          }
          onUpdate={
            createdReview
              ? (input) =>
                  updateReview
                    .mutateAsync({ reviewId: createdReview.id, input })
                    .then(setCreatedReview)
                    .then(() => undefined)
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Protects the write-Review route before exposing the customer editor. */
export function CustomerCreateReviewPage() {
  const { orderId, orderItemId } = useParams({ strict: false });

  return (
    <AuthenticatedPanel>
      {(user) =>
        user.permissions.includes(REVIEWS_PERMISSION.CREATE_VERIFIED) ? (
          <CustomerReviewEditor
            orderId={String(orderId)}
            orderItemId={String(orderItemId)}
            canUpdate={user.permissions.includes(REVIEWS_PERMISSION.UPDATE_OWN)}
          />
        ) : (
          <ErrorState title="Access denied" message="Your account cannot create verified-purchase Reviews." />
        )
      }
    </AuthenticatedPanel>
  );
}

import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
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
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={<Link className="hover:underline" to="/orders/$orderId" params={{ orderId }}>← Back to Order</Link>}
        title="Review your purchase"
        description="Share useful feedback about your delivered purchase. The server verifies Order ownership and delivery before accepting the Review."
      />

      <Surface variant="muted" padding="sm" className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-positive-soft text-sm font-bold text-positive" aria-hidden="true">✓</span>
        <div>
          <p className="font-semibold text-foreground">Verified-purchase Review</p>
          <p className="mt-1 text-sm leading-6 text-foreground-muted">Only the Order Item identifier is submitted with your authored rating and text. Product, seller, store and moderation status remain server-owned.</p>
        </div>
      </Surface>

      {createdReview ? (
        <div className="rounded-card border border-positive/20 bg-positive-soft p-4 text-sm text-positive">
          Review saved. Current status: <strong>{REVIEW_STATUS_LABEL[createdReview.status]}</strong>.
        </div>
      ) : null}

      {createdReview && !canUpdate ? (
        <Surface variant="muted" padding="sm">
          <p className="text-sm text-foreground-muted">Your Review was saved. Your current permissions do not allow editing it.</p>
        </Surface>
      ) : (
        <ReviewEditorForm
          key={createdReview?.updatedAt ?? "create-review"}
          orderItemId={orderItemId}
          review={createdReview ?? undefined}
          isPending={createdReview ? updateReview.isPending : createReview.isPending}
          error={createdReview ? updateReview.error : createReview.error}
          onCreate={(input) =>
            createReview.mutateAsync(input).then(setCreatedReview).then(() => undefined)
          }
          onUpdate={
            createdReview
              ? (input) => updateReview.mutateAsync({ reviewId: createdReview.id, input }).then(setCreatedReview).then(() => undefined)
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
    <CustomerAccountLayout>
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
    </CustomerAccountLayout>
  );
}

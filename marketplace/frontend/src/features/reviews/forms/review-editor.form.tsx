import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { REVIEW_RATINGS } from "../reviews.constants";
import { reviewEditorFormSchema } from "../schemas/reviews.schemas";
import type { CreateReviewInput, Review, UpdateReviewInput } from "../types/reviews.types";

/** Converts optional authored fields into the API's absent/null semantics without adding server-owned values. */
function authoredFields(value: { rating: number; title: string; body: string }) {
  return {
    rating: value.rating,
    title: value.title.trim() || undefined,
    body: value.body.trim() || undefined,
  };
}

/** Renders the shared create/edit Review form using TanStack Form + Zod. */
export function ReviewEditorForm({
  orderItemId,
  review,
  isPending,
  error,
  onCreate,
  onUpdate,
}: {
  orderItemId: string;
  review?: Review;
  isPending: boolean;
  error: unknown;
  onCreate?: (input: CreateReviewInput) => Promise<void>;
  onUpdate?: (input: UpdateReviewInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      rating: review?.rating ?? 5,
      title: review?.title ?? "",
      body: review?.body ?? "",
    },
    validators: { onChange: reviewEditorFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = reviewEditorFormSchema.parse(value);
      const fields = authoredFields(parsed);

      try {
        if (review && onUpdate) {
          await onUpdate({
            rating: fields.rating,
            title: fields.title ?? null,
            body: fields.body ?? null,
          });
        } else if (onCreate) {
          await onCreate({ orderItemId, ...fields });
        }
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-5 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{review ? "Edit your Review" : "Write a Review"}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Purchase and delivery eligibility are checked by the server when you submit.
        </p>
      </div>

      <form.Field name="rating">
        {(field) => (
          <label className="block text-sm font-medium">
            Rating
            <select
              aria-label="Review rating"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={String(field.state.value)}
              onChange={(event) => field.handleChange(Number(event.target.value))}
            >
              {REVIEW_RATINGS.map((rating) => (
                <option key={rating} value={rating}>{rating} / 5</option>
              ))}
            </select>
            {firstFieldError(field.state.meta.errors) ? (
              <span className="mt-1 block text-xs text-red-600">{firstFieldError(field.state.meta.errors)}</span>
            ) : null}
          </label>
        )}
      </form.Field>

      <form.Field name="title">
        {(field) => (
          <label className="block text-sm font-medium">
            Title <span className="font-normal text-slate-500">(optional)</span>
            <input
              aria-label="Review title"
              className="mt-1 w-full rounded-md border px-3 py-2"
              maxLength={200}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {firstFieldError(field.state.meta.errors) ? (
              <span className="mt-1 block text-xs text-red-600">{firstFieldError(field.state.meta.errors)}</span>
            ) : null}
          </label>
        )}
      </form.Field>

      <form.Field name="body">
        {(field) => (
          <label className="block text-sm font-medium">
            Review <span className="font-normal text-slate-500">(optional)</span>
            <textarea
              aria-label="Review body"
              className="mt-1 min-h-32 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <FormError error={error} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving Review..." : review ? "Save Review" : "Submit Review"}
      </Button>
    </form>
  );
}

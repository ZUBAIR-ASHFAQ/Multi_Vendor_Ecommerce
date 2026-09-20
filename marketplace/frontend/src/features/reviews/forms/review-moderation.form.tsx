import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { reviewModerationFormSchema } from "../schemas/reviews.schemas";
import type { ModerateReviewInput } from "../types/reviews.types";

/** Renders one explicit hide/publish moderation command with its mandatory audit reason. */
export function ReviewModerationForm({
  action,
  isPending,
  error,
  onSubmit,
}: {
  action: "hide" | "publish";
  isPending: boolean;
  error: unknown;
  onSubmit: (input: ModerateReviewInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reason: "" },
    validators: { onChange: reviewModerationFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = reviewModerationFormSchema.parse(value);
      try {
        await onSubmit(parsed);
        form.reset();
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {(field) => (
          <label className="block text-sm font-medium">
            Moderation reason
            <textarea
              aria-label={`${action === "hide" ? "Hide" : "Publish"} Review reason`}
              className="mt-1 min-h-24 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {firstFieldError(field.state.meta.errors) ? (
              <span className="mt-1 block text-xs text-red-600">{firstFieldError(field.state.meta.errors)}</span>
            ) : null}
          </label>
        )}
      </form.Field>
      <FormError error={error} />
      <Button type="submit" variant={action === "hide" ? "outline" : "default"} disabled={isPending}>
        {isPending ? "Saving..." : action === "hide" ? "Hide Review" : "Publish Review"}
      </Button>
    </form>
  );
}

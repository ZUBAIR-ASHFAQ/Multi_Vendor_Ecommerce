import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  approveReturnFormSchema,
  rejectReturnFormSchema,
} from "../schemas/returns-refunds.schemas";
import type {
  ApproveReturnInput,
  RejectReturnInput,
} from "../types/returns-refunds.types";

/** Approves one requested Return with an optional support note. */
export function ApproveReturnForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: ApproveReturnInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { note: "" },
    validators: { onChange: approveReturnFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = approveReturnFormSchema.parse(value);
      try {
        await onSubmit(parsed.note ? { note: parsed.note } : {});
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="note">
        {(field) => (
          <label className="block text-sm font-medium">
            Approval note <span className="font-normal text-slate-500">(optional)</span>
            <input
              aria-label="Return approval note"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <FormError error={error} />
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Approving..." : "Approve Return"}
      </Button>
    </form>
  );
}

/** Rejects one requested Return and requires a human-readable reason. */
export function RejectReturnForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: RejectReturnInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reason: "" },
    validators: { onChange: rejectReturnFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = rejectReturnFormSchema.parse(value);
      try {
        await onSubmit(parsed);
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {(field) => {
          const errorMessage = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Rejection reason
              <input
                aria-label="Return rejection reason"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {errorMessage ? <span className="mt-1 block text-xs text-red-600">{errorMessage}</span> : null}
            </label>
          );
        }}
      </form.Field>
      <FormError error={error} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Rejecting..." : "Reject Return"}
      </Button>
    </form>
  );
}

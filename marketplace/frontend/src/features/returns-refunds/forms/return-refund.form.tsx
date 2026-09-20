import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { returnRefundFormSchema } from "../schemas/returns-refunds.schemas";
import type { IssueReturnRefundInput, ReturnRefundResult } from "../types/returns-refunds.types";

/** Executes the privileged provider refund with a fresh retry key and no browser-owned amount fields. */
export function ReturnRefundForm({
  isPending,
  error,
  result,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  result?: ReturnRefundResult;
  onSubmit: (input: IssueReturnRefundInput, idempotencyKey: string) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { note: "" },
    validators: { onChange: returnRefundFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = returnRefundFormSchema.parse(value);
      try {
        await onSubmit(parsed.note ? { note: parsed.note } : {}, crypto.randomUUID());
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-3 rounded-lg border bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h3 className="font-semibold">Issue refund</h3>
        <p className="text-xs text-slate-600">
          The API derives Payment, amount, currency, Commission reversal, and any approved restock effect.
        </p>
      </div>
      <form.Field name="note">
        {(field) => (
          <label className="block text-sm font-medium">
            Refund note <span className="font-normal text-slate-500">(optional)</span>
            <input
              aria-label="Return refund note"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <FormError error={error} />
      {result ? (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          Refund completed: {result.amount} {result.currency}{result.providerRef ? ` · ${result.providerRef}` : ""}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Issuing refund..." : "Issue Refund"}
      </Button>
    </form>
  );
}

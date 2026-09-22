import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/feedback/confirmation-dialog";
import { SuccessFeedback } from "@/components/feedback/system-state";
import { Button } from "@/components/ui/button";
import { useStableIdempotencyKey } from "@/lib/use-stable-idempotency-key";
import { FormError } from "@/features/auth/components/form-error";
import { returnRefundFormSchema } from "../schemas/returns-refunds.schemas";
import type { IssueReturnRefundInput, ReturnRefundResult } from "../types/returns-refunds.types";

/** Executes the privileged provider refund with a retry-stable key and no browser-owned amount fields. */
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
  const [pendingRefund, setPendingRefund] = useState<{ input: IssueReturnRefundInput; idempotencyKey: string; fingerprint: string } | null>(null);
  const commandKey = useStableIdempotencyKey();
  const form = useForm({
    defaultValues: { note: "" },
    validators: { onChange: returnRefundFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = returnRefundFormSchema.parse(value);
      const input: IssueReturnRefundInput = parsed.note ? { note: parsed.note } : {};
      const fingerprint = JSON.stringify(input);
      setPendingRefund({
        input,
        fingerprint,
        idempotencyKey: commandKey.keyFor(fingerprint),
      });
    },
  });

  return (
    <>
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
        <SuccessFeedback>
          Refund completed: {result.amount} {result.currency}{result.providerRef ? ` · ${result.providerRef}` : ""}
        </SuccessFeedback>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Issuing refund..." : "Issue Refund"}
      </Button>
    </form>
    <ConfirmationDialog
      open={pendingRefund !== null}
      title="Issue this refund?"
      description="The marketplace server derives the authoritative payment, refund amount, commission reversal, and approved restock effect. This financial action should only be confirmed after reviewing the return."
      confirmLabel="Confirm refund"
      isPending={isPending}
      onCancel={() => setPendingRefund(null)}
      onConfirm={() => {
        if (!pendingRefund) return;
        void onSubmit(pendingRefund.input, pendingRefund.idempotencyKey)
          .then(() => {
            commandKey.complete(pendingRefund.fingerprint);
            setPendingRefund(null);
          })
          .catch(() => {
            // Keep the retry key so an uncertain network failure replays the same refund command.
            setPendingRefund(null);
          });
      }}
    />
    </>
  );
}

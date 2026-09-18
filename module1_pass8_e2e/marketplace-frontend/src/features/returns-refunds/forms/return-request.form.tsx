import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { RETURN_REASON_LABEL, RETURN_REASON_VALUES } from "../returns-refunds.constants";
import { returnRequestFormSchema } from "../schemas/returns-refunds.schemas";
import type { CreateReturnRequestInput } from "../types/returns-refunds.types";

interface ReturnItemOption {
  orderItemId: string;
  label: string;
  maxQuantity: number;
}

/** Finds the first readable issue from a form-level TanStack/Zod error collection. */
function formMessage(errors: unknown[]): string | null {
  for (const error of errors) {
    const message = firstFieldError([error]);
    if (message) return message;
  }
  return null;
}

/** Collects customer Return quantities only from items that the page identified as potentially eligible. */
export function ReturnRequestForm({
  sellerOrderId,
  items,
  isPending,
  error,
  onSubmit,
}: {
  sellerOrderId: string;
  items: ReturnItemOption[];
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateReturnRequestInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      reasonCode: "" as "" | (typeof RETURN_REASON_VALUES)[number],
      items: items.map((item) => ({ ...item, quantity: "" })),
    },
    validators: { onChange: returnRequestFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = returnRequestFormSchema.parse(value);
      if (!parsed.reasonCode) return;

      const input: CreateReturnRequestInput = {
        sellerOrderId,
        reasonCode: parsed.reasonCode,
        items: parsed.items
          .filter((item) => item.quantity.trim())
          .map((item) => ({
            orderItemId: item.orderItemId,
            quantity: Number(item.quantity),
          })),
      };

      try {
        await onSubmit(input);
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
        No delivered quantity is currently available for a new Return Request. The API remains authoritative
        for final eligibility and the Return window.
      </p>
    );
  }

  return (
    <form
      className="space-y-5 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Return request</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose a reason and enter only the delivered quantities you want to return.
        </p>
      </div>

      <form.Field name="reasonCode">
        {(field) => {
          const errorMessage = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Reason
              <select
                aria-label="Return reason"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
              >
                <option value="">Choose a reason</option>
                {RETURN_REASON_VALUES.map((value) => (
                  <option key={value} value={value}>{RETURN_REASON_LABEL[value]}</option>
                ))}
              </select>
              {errorMessage ? <span className="mt-1 block text-xs text-red-600">{errorMessage}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="items">
        {(field) => {
          const errorMessage = formMessage(field.state.meta.errors);
          return (
            <div className="space-y-3">
              {field.state.value.map((item, index) => (
                <label key={item.orderItemId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem] sm:items-center">
                  <span>
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-slate-500">Up to {item.maxQuantity} potentially eligible</span>
                  </span>
                  <input
                    aria-label={`Return quantity for ${item.label}`}
                    inputMode="numeric"
                    className="rounded-md border px-3 py-2"
                    placeholder="0"
                    value={item.quantity}
                    onChange={(event) => {
                      const next = field.state.value.map((current, currentIndex) =>
                        currentIndex === index ? { ...current, quantity: event.target.value } : current,
                      );
                      field.handleChange(next);
                    }}
                  />
                </label>
              ))}
              {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
            </div>
          );
        }}
      </form.Field>

      <FormError error={error} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Submitting Return..." : "Submit Return Request"}
      </Button>
    </form>
  );
}

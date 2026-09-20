import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  RETURN_ITEM_CONDITION_LABEL,
  RETURN_ITEM_CONDITION_VALUES,
  RETURN_ITEM_RESOLUTION_LABEL,
  RETURN_ITEM_RESOLUTION_VALUES,
} from "../returns-refunds.constants";
import { receiveReturnFormSchema } from "../schemas/returns-refunds.schemas";
import type { ReceiveReturnInput, ReturnRequest } from "../types/returns-refunds.types";

/** Finds the first readable validation issue in one nested inspection field. */
function nestedMessage(errors: unknown[]): string | null {
  for (const error of errors) {
    const message = firstFieldError([error]);
    if (message) return message;
  }
  return null;
}

/** Records physical condition/resolution decisions while leaving refund money and restock quantity server-derived. */
export function ReturnInspectionForm({
  value,
  isPending,
  error,
  onSubmit,
}: {
  value: ReturnRequest;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: ReceiveReturnInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      items: value.items.map((item) => ({
        returnItemId: item.id,
        label: `${item.orderItemId} · quantity ${item.quantity}`,
        itemCondition: "" as "" | (typeof RETURN_ITEM_CONDITION_VALUES)[number],
        resolution: "" as "" | (typeof RETURN_ITEM_RESOLUTION_VALUES)[number],
      })),
      note: "",
    },
    validators: { onChange: receiveReturnFormSchema },
    onSubmit: async ({ value: formValue }) => {
      const parsed = receiveReturnFormSchema.parse(formValue);
      const items: ReceiveReturnInput["items"] = [];
      for (const item of parsed.items) {
        if (!item.itemCondition || !item.resolution) return;
        items.push({
          returnItemId: item.returnItemId,
          itemCondition: item.itemCondition,
          resolution: item.resolution,
        });
      }

      try {
        await onSubmit({ items, ...(parsed.note ? { note: parsed.note } : {}) });
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-4 rounded-lg border bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h3 className="font-semibold">Receive and inspect</h3>
        <p className="text-xs text-slate-600">
          Choose physical condition and resolution only. Refund and restock amounts are calculated by the API.
        </p>
      </div>

      <form.Field name="items">
        {(field) => (
          <div className="space-y-3">
            {field.state.value.map((item, index) => (
              <div
                key={item.returnItemId}
                className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-[1fr_12rem_14rem] md:items-end"
              >
                <p className="text-xs font-mono text-slate-600">{item.label}</p>
                <label className="text-sm font-medium">
                  Condition
                  <select
                    aria-label={`Condition for Return Item ${item.returnItemId}`}
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    value={item.itemCondition}
                    onChange={(event) => {
                      const next = field.state.value.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, itemCondition: event.target.value as typeof current.itemCondition }
                          : current,
                      );
                      field.handleChange(next);
                    }}
                  >
                    <option value="">Choose</option>
                    {RETURN_ITEM_CONDITION_VALUES.map((condition) => (
                      <option key={condition} value={condition}>{RETURN_ITEM_CONDITION_LABEL[condition]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Resolution
                  <select
                    aria-label={`Resolution for Return Item ${item.returnItemId}`}
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    value={item.resolution}
                    onChange={(event) => {
                      const next = field.state.value.map((current, currentIndex) =>
                        currentIndex === index
                          ? { ...current, resolution: event.target.value as typeof current.resolution }
                          : current,
                      );
                      field.handleChange(next);
                    }}
                  >
                    <option value="">Choose</option>
                    {RETURN_ITEM_RESOLUTION_VALUES.map((resolution) => (
                      <option key={resolution} value={resolution}>{RETURN_ITEM_RESOLUTION_LABEL[resolution]}</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            {nestedMessage(field.state.meta.errors) ? (
              <p className="text-sm text-red-600">{nestedMessage(field.state.meta.errors)}</p>
            ) : null}
          </div>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <label className="block text-sm font-medium">
            Inspection note <span className="font-normal text-slate-500">(optional)</span>
            <input
              aria-label="Return inspection note"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <FormError error={error} />
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Recording inspection..." : "Receive Return"}
      </Button>
    </form>
  );
}

import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import {
  firstFieldError,
  FormError,
} from "@/features/auth/components/form-error";
import { orderCancellationFormSchema } from "../schemas/orders.schemas";
import type { CancelOrderInput } from "../types/orders.types";

interface CancellationItemOption {
  id: string;
  label: string;
  remainingQuantity: number;
}

/** Collects either a whole-Order cancellation or one partial Order Item cancellation. */
export function OrderCancellationForm({
  items = [],
  isPending,
  error,
  onSubmit,
}: {
  items?: CancellationItemOption[];
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CancelOrderInput, idempotencyKey: string) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      orderItemId: "",
      quantity: "",
      reason: "",
    },
    validators: { onChange: orderCancellationFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = orderCancellationFormSchema.parse(value);
      const input: CancelOrderInput = {};

      if (parsed.orderItemId) {
        input.items = [
          {
            orderItemId: parsed.orderItemId,
            quantity: Number(parsed.quantity),
          },
        ];
      }
      if (parsed.reason) input.reason = parsed.reason;

      try {
        await onSubmit(input, crypto.randomUUID());
        form.reset();
      } catch {
        // TanStack Query owns the normalized request error shown below.
      }
    },
  });

  return (
    <form
      className="space-y-3 rounded-xl border bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h3 className="font-semibold">Cancellation</h3>
        <p className="mt-1 text-xs text-slate-500">
          Leave the item blank to cancel all currently eligible remaining quantities.
        </p>
      </div>

      {items.length > 0 ? (
        <form.Field name="orderItemId">
          {(field) => (
            <label className="block text-sm font-medium">
              Order Item
              <select
                aria-label="Order Item"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setFieldValue("quantity", "");
                }}
              >
                <option value="">All eligible items</option>
                {items
                  .filter((item) => item.remainingQuantity > 0)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {item.remainingQuantity} remaining
                    </option>
                  ))}
              </select>
            </label>
          )}
        </form.Field>
      ) : null}

      <form.Subscribe selector={(state) => state.values.orderItemId}>
        {(selectedId) =>
          selectedId ? (
            <form.Field name="quantity">
              {(field) => {
                const selected = items.find((item) => item.id === selectedId);
                const fieldError = firstFieldError(field.state.meta.errors);

                return (
                  <label className="block text-sm font-medium">
                    Quantity
                    <input
                      aria-label="Cancellation quantity"
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      value={field.state.value}
                      max={selected?.remainingQuantity}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    {fieldError ? (
                      <span className="mt-1 block text-xs text-red-600">
                        {fieldError}
                      </span>
                    ) : null}
                  </label>
                );
              }}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      <form.Field name="reason">
        {(field) => (
          <label className="block text-sm font-medium">
            Reason <span className="font-normal text-slate-500">(optional)</span>
            <textarea
              aria-label="Cancellation reason"
              className="mt-1 min-h-20 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      <FormError error={error} />
      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? "Cancelling..." : "Cancel eligible quantity"}
      </Button>
    </form>
  );
}

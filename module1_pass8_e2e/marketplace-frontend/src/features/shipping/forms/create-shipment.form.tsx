import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { createShipmentFormSchema } from "../schemas/shipping.schemas";
import type { CreateShipmentInput } from "../types/shipping.types";

interface ShipmentItemOption {
  id: string;
  label: string;
  availableQuantity: number;
}

/** Reads one form-level validation message from TanStack Form's Zod issue values. */
function formMessage(errors: unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return undefined;
}

/** Collects one or more unallocated Seller Order item quantities for a new Shipment. */
export function CreateShipmentForm({
  items,
  isPending,
  error,
  onSubmit,
}: {
  items: ShipmentItemOption[];
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateShipmentInput, idempotencyKey: string) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      items: items.map((item) => ({
        orderItemId: item.id,
        label: item.label,
        maxQuantity: item.availableQuantity,
        quantity: "",
      })),
    },
    validators: { onChange: createShipmentFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = createShipmentFormSchema.parse(value);
      const input: CreateShipmentInput = {
        items: parsed.items
          .filter((item) => item.quantity.trim())
          .map((item) => ({
            orderItemId: item.orderItemId,
            quantity: Number(item.quantity),
          })),
      };

      try {
        await onSubmit(input, crypto.randomUUID());
        form.reset();
      } catch {
        // TanStack Query owns the normalized API error rendered below.
      }
    },
  });

  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
        Every eligible Order Item quantity is already allocated to a Shipment.
      </p>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Create Shipment</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter only the quantities that should be allocated to this Shipment.
        </p>
      </div>

      <form.Field name="items">
        {(field) => (
          <div className="space-y-3">
            {field.state.value.map((item, index) => (
              <label key={item.orderItemId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem] sm:items-center">
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-slate-500">Up to {item.maxQuantity} available</span>
                </span>
                <input
                  aria-label={`Shipment quantity for ${item.label}`}
                  inputMode="numeric"
                  className="rounded-md border px-3 py-2"
                  placeholder="0"
                  value={item.quantity}
                  onChange={(event) => {
                    const nextItems = field.state.value.map((current, currentIndex) =>
                      currentIndex === index ? { ...current, quantity: event.target.value } : current,
                    );
                    field.handleChange(nextItems);
                  }}
                />
              </label>
            ))}
            {formMessage(field.state.meta.errors) ? (
              <p className="text-sm text-red-600">{formMessage(field.state.meta.errors)}</p>
            ) : null}
          </div>
        )}
      </form.Field>

      <FormError error={error} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating Shipment..." : "Create Shipment"}
      </Button>
    </form>
  );
}

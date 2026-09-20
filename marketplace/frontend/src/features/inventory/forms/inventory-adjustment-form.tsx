import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { inventoryAdjustmentFormSchema } from "../schemas/inventory.schemas";

/** Collects one explicit seller stock adjustment with TanStack Form + Zod. */
export function InventoryAdjustmentForm({
  variantId,
  isPending,
  error,
  onSubmit,
}: {
  variantId: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (quantityDelta: number) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { quantityDelta: "" },
    validators: { onChange: inventoryAdjustmentFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = inventoryAdjustmentFormSchema.parse(value);
      try {
        await onSubmit(Number(parsed.quantityDelta));
        form.reset();
      } catch {
        // TanStack Query owns the normalized request error rendered below.
      }
    },
  });

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h3 className="font-semibold">Adjust physical stock</h3>
        <p className="mt-1 text-xs text-slate-500">
          Use a positive number to add stock or a negative number to reduce stock. Variant {variantId.slice(0, 8)}…
        </p>
      </div>
      <form.Field name="quantityDelta">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Quantity adjustment
              <input
                aria-label="Inventory quantity adjustment"
                inputMode="numeric"
                placeholder="Example: 10 or -3"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>
      <FormError error={error} />
      <Button disabled={isPending}>{isPending ? "Adjusting..." : "Apply adjustment"}</Button>
    </form>
  );
}

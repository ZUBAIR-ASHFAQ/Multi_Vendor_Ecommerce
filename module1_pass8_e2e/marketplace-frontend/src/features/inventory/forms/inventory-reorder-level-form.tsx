import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { inventoryReorderLevelFormSchema } from "../schemas/inventory.schemas";

/** Collects one low-stock threshold and allows blank input to disable the threshold. */
export function InventoryReorderLevelForm({
  reorderLevel,
  isPending,
  error,
  onSubmit,
}: {
  reorderLevel: number | null;
  isPending: boolean;
  error: unknown;
  onSubmit: (reorderLevel: number | null) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reorderLevel: reorderLevel === null ? "" : String(reorderLevel) },
    validators: { onChange: inventoryReorderLevelFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = inventoryReorderLevelFormSchema.parse(value);
      try {
        await onSubmit(parsed.reorderLevel === "" ? null : Number(parsed.reorderLevel));
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
        <h3 className="font-semibold">Low-stock threshold</h3>
        <p className="mt-1 text-xs text-slate-500">Leave blank to disable the low-stock alert for this variant.</p>
      </div>
      <form.Field name="reorderLevel">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Reorder level
              <input
                aria-label="Inventory reorder level"
                inputMode="numeric"
                placeholder="Example: 5"
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
      <Button disabled={isPending}>{isPending ? "Saving..." : "Save threshold"}</Button>
    </form>
  );
}

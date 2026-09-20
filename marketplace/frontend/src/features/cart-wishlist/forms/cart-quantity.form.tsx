import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { CART_WISHLIST_LIMITS } from "../cart-wishlist.constants";
import {
  cartQuantityFormSchema,
  type CartQuantityFormValues,
} from "../schemas/cart-wishlist.schemas";

/** Reusable quantity form for Cart updates and Product add-to-cart actions. */
export function CartQuantityForm({
  initialQuantity,
  submitLabel,
  isPending,
  error,
  onSubmit,
  compact = false,
}: {
  initialQuantity: number;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (quantity: number) => Promise<void>;
  compact?: boolean;
}) {
  const form = useForm({
    defaultValues: { quantity: initialQuantity } satisfies CartQuantityFormValues,
    validators: { onChange: cartQuantityFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(value.quantity);
      } catch {
        // TanStack Query owns the normalized request error rendered below.
      }
    },
  });

  return (
    <form
      className={compact ? "space-y-2" : "space-y-3"}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="quantity">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Quantity
              <input
                aria-label="Quantity"
                type="number"
                min={1}
                max={CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY}
                step={1}
                className="mt-1 w-24 rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(Number(event.target.value))}
                aria-invalid={Boolean(fieldError)}
              />
              {fieldError ? (
                <span className="mt-1 block text-xs text-red-600">{fieldError}</span>
              ) : null}
            </label>
          );
        }}
      </form.Field>
      <FormError error={error} />
      <Button size="sm" disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}

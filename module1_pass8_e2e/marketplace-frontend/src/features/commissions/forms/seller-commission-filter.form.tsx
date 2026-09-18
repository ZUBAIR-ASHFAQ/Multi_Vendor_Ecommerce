import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { COMMISSION_ENTRY_TYPE } from "../commissions.constants";
import { sellerCommissionFilterSchema } from "../schemas/commissions.schemas";
import type { SellerCommissionStatementParams } from "../types/commissions.types";

/** Filters the seller's own statement without exposing any seller-id input. */
export function SellerCommissionFilterForm({
  onApply,
}: {
  onApply: (filters: Partial<SellerCommissionStatementParams>) => void;
}) {
  const form = useForm({
    defaultValues: { type: "", sellerOrderId: "" },
    validators: { onChange: sellerCommissionFilterSchema },
    onSubmit: ({ value }) => {
      const parsed = sellerCommissionFilterSchema.parse(value);
      onApply({
        type: parsed.type || undefined,
        sellerOrderId: parsed.sellerOrderId || undefined,
      });
    },
  });

  return (
    <form
      className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="type">
        {(field) => (
          <label className="text-sm font-medium">
            Entry type
            <select
              aria-label="Seller Commission entry type filter"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
            >
              <option value="">Any</option>
              <option value={COMMISSION_ENTRY_TYPE.SALE}>Sale</option>
              <option value={COMMISSION_ENTRY_TYPE.REFUND}>Refund</option>
              <option value={COMMISSION_ENTRY_TYPE.ADJUSTMENT}>Adjustment</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="sellerOrderId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Seller Order UUID
              <input
                aria-label="Seller Commission order UUID"
                aria-invalid={Boolean(error)}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <div className="flex items-end">
        <Button className="w-full">Apply filters</Button>
      </div>
    </form>
  );
}

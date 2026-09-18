import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { COMMISSION_ENTRY_TYPE } from "../commissions.constants";
import { adminCommissionEntryFilterSchema } from "../schemas/commissions.schemas";
import type { AdminCommissionEntriesParams } from "../types/commissions.types";

/** Collects documented finance-ledger filters and validates UUID/currency input before querying. */
export function AdminCommissionEntryFilterForm({
  onApply,
}: {
  onApply: (filters: Partial<AdminCommissionEntriesParams>) => void;
}) {
  const form = useForm({
    defaultValues: { sellerId: "", sellerOrderId: "", type: "", currency: "" },
    validators: { onChange: adminCommissionEntryFilterSchema },
    onSubmit: ({ value }) => {
      const parsed = adminCommissionEntryFilterSchema.parse(value);
      onApply({
        sellerId: parsed.sellerId || undefined,
        sellerOrderId: parsed.sellerOrderId || undefined,
        type: parsed.type || undefined,
        currency: parsed.currency || undefined,
      });
    },
  });

  return (
    <form
      className="grid gap-3 rounded-xl border bg-white p-4 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="sellerId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Seller UUID
              <input
                aria-label="Finance Commission seller UUID"
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

      <form.Field name="sellerOrderId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Seller Order UUID
              <input
                aria-label="Finance Commission order UUID"
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

      <form.Field name="type">
        {(field) => (
          <label className="text-sm font-medium">
            Entry type
            <select
              aria-label="Finance Commission entry type filter"
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

      <form.Field name="currency">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Currency
              <input
                aria-label="Finance Commission currency filter"
                aria-invalid={Boolean(error)}
                className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                placeholder="USD"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
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

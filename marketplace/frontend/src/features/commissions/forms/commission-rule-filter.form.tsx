import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { COMMISSION_RULE_SCOPE, COMMISSION_RULE_STATUS } from "../commissions.constants";
import { commissionRuleFilterSchema } from "../schemas/commissions.schemas";
import type { AdminCommissionRulesParams } from "../types/commissions.types";

/** Collects only documented Commission-rule filters before updating TanStack Query state. */
export function CommissionRuleFilterForm({
  onApply,
}: {
  onApply: (filters: Partial<AdminCommissionRulesParams>) => void;
}) {
  const form = useForm({
    defaultValues: { scopeType: "", status: "" },
    validators: { onChange: commissionRuleFilterSchema },
    onSubmit: ({ value }) => {
      const parsed = commissionRuleFilterSchema.parse(value);
      onApply({
        scopeType: parsed.scopeType || undefined,
        status: parsed.status || undefined,
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
      <form.Field name="scopeType">
        {(field) => (
          <label className="text-sm font-medium">
            Scope
            <select
              aria-label="Commission rule scope filter"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
            >
              <option value="">Any</option>
              <option value={COMMISSION_RULE_SCOPE.DEFAULT}>Default</option>
              <option value={COMMISSION_RULE_SCOPE.SELLER}>Seller</option>
              <option value={COMMISSION_RULE_SCOPE.CATEGORY}>Category</option>
              <option value={COMMISSION_RULE_SCOPE.PRODUCT}>Product</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="status">
        {(field) => (
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Commission rule status filter"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
            >
              <option value="">Any</option>
              <option value={COMMISSION_RULE_STATUS.ACTIVE}>Active</option>
              <option value={COMMISSION_RULE_STATUS.INACTIVE}>Inactive</option>
            </select>
          </label>
        )}
      </form.Field>

      <div className="flex items-end">
        <Button className="w-full">Apply filters</Button>
      </div>
    </form>
  );
}

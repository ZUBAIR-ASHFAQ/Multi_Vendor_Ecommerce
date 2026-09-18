import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { FormError, firstFieldError } from "@/features/auth/components/form-error";
import {
  COMMISSION_RULE_SCOPE,
  COMMISSION_RULE_STATUS,
} from "../commissions.constants";
import {
  commissionRuleFormSchema,
  type CommissionRule,
  type CommissionRuleFormValues,
} from "../schemas/commissions.schemas";
import type {
  CreateCommissionRuleInput,
  UpdateCommissionRuleInput,
} from "../types/commissions.types";

/** Converts an API timestamp into the local value expected by a datetime-local input. */
function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Converts a local datetime input into the offset-aware ISO string required by the API. */
function toIsoDateTime(value: string): string {
  return new Date(value).toISOString();
}

/** Builds predictable form values for a new or existing Commission rule. */
function defaultValues(rule?: CommissionRule): CommissionRuleFormValues {
  if (!rule) {
    return {
      priority: 0,
      scopeType: COMMISSION_RULE_SCOPE.DEFAULT,
      scopeId: "",
      ratePercent: "0.000000",
      fixedFee: "",
      startAt: "",
      endAt: "",
      status: COMMISSION_RULE_STATUS.ACTIVE,
    };
  }

  return {
    priority: rule.priority,
    scopeType: rule.scopeType,
    scopeId: rule.scopeId ?? "",
    ratePercent: rule.ratePercent,
    fixedFee: rule.fixedFee ?? "",
    startAt: toLocalDateTimeInput(rule.startAt),
    endAt: rule.endAt ? toLocalDateTimeInput(rule.endAt) : "",
    status: rule.status,
  };
}

/** Maps validated browser form state to the documented create-rule request body. */
function toCreateInput(value: CommissionRuleFormValues): CreateCommissionRuleInput {
  return {
    priority: value.priority,
    scopeType: value.scopeType,
    scopeId: value.scopeType === COMMISSION_RULE_SCOPE.DEFAULT ? null : value.scopeId,
    ratePercent: value.ratePercent,
    fixedFee: value.fixedFee === "" ? null : value.fixedFee,
    startAt: toIsoDateTime(value.startAt),
    endAt: value.endAt === "" ? null : toIsoDateTime(value.endAt),
    status: value.status,
  };
}

/** Maps validated edit state without overwriting funding metadata that this UI does not own. */
function toUpdateInput(value: CommissionRuleFormValues): UpdateCommissionRuleInput {
  return {
    priority: value.priority,
    scopeType: value.scopeType,
    scopeId: value.scopeType === COMMISSION_RULE_SCOPE.DEFAULT ? null : value.scopeId,
    ratePercent: value.ratePercent,
    fixedFee: value.fixedFee === "" ? null : value.fixedFee,
    startAt: toIsoDateTime(value.startAt),
    endAt: value.endAt === "" ? null : toIsoDateTime(value.endAt),
    status: value.status,
  };
}

/** Renders the create/edit form for future-effective Commission rules using TanStack Form and Zod. */
export function CommissionRuleForm({
  rule,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  rule?: CommissionRule;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateCommissionRuleInput | UpdateCommissionRuleInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const editing = Boolean(rule);
  const form = useForm({
    defaultValues: defaultValues(rule),
    validators: { onSubmit: commissionRuleFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = commissionRuleFormSchema.parse(value);
      await onSubmit(editing ? toUpdateInput(parsed) : toCreateInput(parsed));
    },
  });

  return (
    <form
      className="space-y-5 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Marketplace Finance
        </p>
        <h2 className="mt-1 text-xl font-bold">
          {editing ? "Edit future-effective Commission rule" : "Create Commission rule"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Historical Order Item snapshots are immutable. The API rejects ambiguous rule resolution.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <form.Field name="priority">
          {(field) => (
            <label className="text-sm font-medium">
              Priority
              <input
                aria-label="Commission rule priority"
                type="number"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(Number(event.target.value))}
              />
              <span className="mt-1 block text-xs text-slate-500">Higher numeric priority wins.</span>
            </label>
          )}
        </form.Field>

        <form.Field name="scopeType">
          {(field) => (
            <label className="text-sm font-medium">
              Scope
              <select
                aria-label="Commission rule scope"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => {
                  const value = event.target.value as CommissionRuleFormValues["scopeType"];
                  field.handleChange(value);
                  if (value === COMMISSION_RULE_SCOPE.DEFAULT) form.setFieldValue("scopeId", "");
                }}
              >
                <option value={COMMISSION_RULE_SCOPE.DEFAULT}>Default</option>
                <option value={COMMISSION_RULE_SCOPE.SELLER}>Seller</option>
                <option value={COMMISSION_RULE_SCOPE.CATEGORY}>Category</option>
                <option value={COMMISSION_RULE_SCOPE.PRODUCT}>Product</option>
              </select>
            </label>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.scopeType}>
          {(scopeType) => (
            <form.Field name="scopeId">
              {(field) => {
                const fieldError = firstFieldError(field.state.meta.errors);
                return (
                  <label className="text-sm font-medium">
                    Scope UUID
                    <input
                      aria-label="Commission rule scope UUID"
                      disabled={scopeType === COMMISSION_RULE_SCOPE.DEFAULT}
                      aria-invalid={Boolean(fieldError)}
                      className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-slate-100"
                      placeholder={scopeType === COMMISSION_RULE_SCOPE.DEFAULT ? "Not used" : "UUID"}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
                  </label>
                );
              }}
            </form.Field>
          )}
        </form.Subscribe>

        <form.Field name="ratePercent">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Rate percent
                <input
                  aria-label="Commission rate percent"
                  inputMode="decimal"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="10.000000"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="fixedFee">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Fixed fee
                <input
                  aria-label="Commission fixed fee"
                  inputMode="decimal"
                  aria-invalid={Boolean(fieldError)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="0.0000"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Commission rule status"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) =>
                  field.handleChange(event.target.value as CommissionRuleFormValues["status"])
                }
              >
                <option value={COMMISSION_RULE_STATUS.ACTIVE}>Active</option>
                <option value={COMMISSION_RULE_STATUS.INACTIVE}>Inactive</option>
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Only active rules can participate in settlement.
              </span>
            </label>
          )}
        </form.Field>

        <form.Field name="startAt">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Starts at
                <input
                  type="datetime-local"
                  aria-label="Commission rule start time"
                  aria-invalid={Boolean(fieldError)}
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

        <form.Field name="endAt">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Ends at
                <input
                  type="datetime-local"
                  aria-label="Commission rule end time"
                  aria-invalid={Boolean(fieldError)}
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
      </div>

      <FormError error={error} />

      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending}>{isPending ? "Saving..." : editing ? "Save rule" : "Create rule"}</Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        ) : null}
      </div>
    </form>
  );
}

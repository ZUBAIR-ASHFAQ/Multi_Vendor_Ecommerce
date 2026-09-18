import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import {
  CUSTOMER_PROFILE_STATUS,
  CUSTOMER_SORT,
  CUSTOMER_SORT_OPTIONS,
  type CustomerSort,
} from "../customers.constants";
import {
  adminCustomerFilterFormSchema,
  type AdminCustomerFilterFormValues,
} from "../schemas/customers.schemas";
import type { CustomerListParams } from "../types/customers.types";

/** Converts simple form values into the bounded admin customer API filters. */
function toParams(value: AdminCustomerFilterFormValues): CustomerListParams {
  return {
    search: value.search || undefined,
    profileStatus: value.profileStatus || undefined,
    accountStatus: value.accountStatus || undefined,
    sort: value.sort,
  };
}

/** Collects the documented admin customer filters with TanStack Form + Zod. */
export function AdminCustomerFilterForm({ onApply }: { onApply: (params: CustomerListParams) => void }) {
  const form = useForm({
    defaultValues: {
      search: "",
      profileStatus: "" as "" | "active" | "inactive",
      accountStatus: "" as "" | "active" | "inactive" | "locked" | "pending",
      sort: CUSTOMER_SORT.CREATED_DESC as CustomerSort,
    },
    validators: { onChange: adminCustomerFilterFormSchema },
    onSubmit: ({ value }) => onApply(toParams(value)),
  });

  return (
    <form
      className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="search">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Search
              <input
                aria-label="Search customers"
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="Name or email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="profileStatus">
        {(field) => (
          <label className="text-sm font-medium">
            Profile status
            <select
              aria-label="Customer profile status"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as "" | "active" | "inactive")}
            >
              <option value="">All</option>
              <option value={CUSTOMER_PROFILE_STATUS.ACTIVE}>Active</option>
              <option value={CUSTOMER_PROFILE_STATUS.INACTIVE}>Inactive</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="accountStatus">
        {(field) => (
          <label className="text-sm font-medium">
            Account status
            <select
              aria-label="Customer account status"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as "" | "active" | "inactive" | "locked" | "pending")}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="locked">Locked</option>
              <option value="pending">Pending</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium">
            Sort
            <select
              aria-label="Customer sort"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as CustomerSort)}
            >
              {CUSTOMER_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
        <Button>Apply filters</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset();
            onApply({ sort: CUSTOMER_SORT.CREATED_DESC });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

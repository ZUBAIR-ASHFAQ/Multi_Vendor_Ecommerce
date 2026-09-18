import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { dashboardFilterFormSchema } from "../schemas/dashboard.schemas";
import type { DashboardFilter } from "../types/dashboard.types";

/** Converts an API ISO timestamp into a datetime-local browser value. */
function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Converts a datetime-local browser value into the API ISO timestamp format. */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Converts blank UUID text to undefined so empty filters are never sent to the API. */
function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

/** Selects only documented Dashboard filter fields and keeps seller scope server-authoritative for seller users. */
function toDashboardFilters(
  value: { from: string; to: string; sellerId: string; storeId: string; categoryId: string },
  user: AuthenticatedUser,
): DashboardFilter {
  return {
    from: toIsoDateTime(value.from),
    to: toIsoDateTime(value.to),
    sellerId: user.accountType === "platform_admin" ? optionalText(value.sellerId) : undefined,
    storeId: optionalText(value.storeId),
    categoryId: optionalText(value.categoryId),
  };
}

/** Renders shared date/seller/store/category filters with TanStack Form and Zod validation. */
export function DashboardFilterForm({
  user,
  filters,
  onApply,
}: {
  user: AuthenticatedUser;
  filters: DashboardFilter;
  onApply: (filters: DashboardFilter) => void;
}) {
  const form = useForm({
    defaultValues: {
      from: toLocalDateTime(filters.from),
      to: toLocalDateTime(filters.to),
      sellerId: filters.sellerId ?? "",
      storeId: filters.storeId ?? "",
      categoryId: filters.categoryId ?? "",
    },
    validators: { onChange: dashboardFilterFormSchema },
    onSubmit: ({ value }) => onApply(toDashboardFilters(value, user)),
  });

  return (
    <form
      className="grid gap-4 rounded-xl border bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="from">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              From
              <input
                aria-label="Dashboard from"
                type="datetime-local"
                className="mt-1 w-full rounded-md border px-3 py-2"
                aria-invalid={Boolean(error)}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="to">
        {(field) => (
          <label className="text-sm font-medium">
            To
            <input
              aria-label="Dashboard to"
              type="datetime-local"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>

      {user.accountType === "platform_admin" ? (
        <form.Field name="sellerId">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Seller UUID
                <input
                  aria-label="Dashboard seller UUID"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  aria-invalid={Boolean(error)}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      ) : null}

      <form.Field name="storeId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Store UUID
              <input
                aria-label="Dashboard store UUID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                aria-invalid={Boolean(error)}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="categoryId">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Category UUID
              <input
                aria-label="Dashboard category UUID"
                className="mt-1 w-full rounded-md border px-3 py-2"
                aria-invalid={Boolean(error)}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <div className="flex items-end gap-2 md:col-span-2 xl:col-span-5">
        <Button>Apply filters</Button>
        <Button type="button" variant="outline" onClick={() => onApply({})}>
          Clear
        </Button>
      </div>
      <p className="text-xs text-slate-500 md:col-span-2 xl:col-span-5">
        Category filtering is available only where the backend has an authoritative category grain.
        Widgets that cannot safely apply it return an unavailable state instead of misleading data.
      </p>
    </form>
  );
}

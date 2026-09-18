import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { useUpdateDashboardPreferencesMutation } from "../hooks/use-dashboard";
import { dashboardSavedFilterFormSchema } from "../schemas/dashboard.schemas";
import type { DashboardFilter, DashboardPreferences } from "../types/dashboard.types";

/** Converts persisted saved filters into the replacement payload owned by PATCH /dashboard/preferences. */
function savedFilterInputs(preferences: DashboardPreferences) {
  return preferences.savedFilters.map((item) => ({ name: item.name, filters: item.filters }));
}

/** Returns persisted filter inputs except the saved filter being removed. */
function savedFilterInputsWithout(preferences: DashboardPreferences, savedFilterId: string) {
  return preferences.savedFilters
    .filter((item) => item.id !== savedFilterId)
    .map((item) => ({ name: item.name, filters: item.filters }));
}

/** Renders server-persisted user-owned Dashboard filter presets without inventing extra CRUD routes. */
export function SavedDashboardFilters({
  preferences,
  currentFilters,
  onLoad,
}: {
  preferences: DashboardPreferences;
  currentFilters: DashboardFilter;
  onLoad: (filters: DashboardFilter) => void;
}) {
  const update = useUpdateDashboardPreferencesMutation();
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onChange: dashboardSavedFilterFormSchema },
    onSubmit: ({ value }) => {
      update.mutate({
        savedFilters: [...savedFilterInputs(preferences), { name: value.name.trim(), filters: currentFilters }],
      });
    },
  });

  return (
    <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Saved filters</h2>
        <p className="text-sm text-slate-600">
          Saved filters belong to your account and are persisted by the documented Dashboard preferences command.
        </p>
      </div>

      {preferences.savedFilters.length === 0 ? (
        <p className="text-sm text-slate-500">You have no saved Dashboard filters.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {preferences.savedFilters.map((saved) => (
            <div key={saved.id} className="flex items-center gap-1 rounded-md border p-1">
              <Button type="button" variant="ghost" onClick={() => onLoad(saved.filters)}>{saved.name}</Button>
              <button
                type="button"
                className="px-2 text-xs text-slate-500 hover:text-red-700"
                aria-label={`Delete ${saved.name}`}
                onClick={() => update.mutate({
                  savedFilters: savedFilterInputsWithout(preferences, saved.id),
                })}
              >
                Delete
              </button>
              <span className="sr-only">Saved {formatDateTime(saved.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="min-w-64 text-sm font-medium">
                Filter name
                <input
                  aria-label="Saved Dashboard filter name"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
        <Button className="mt-6" disabled={update.isPending}>Save current filters</Button>
      </form>

      {update.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {update.error instanceof Error ? update.error.message : "Saved filters could not be updated."}
          {update.error instanceof ApiClientError && update.error.requestId ? ` Request ID: ${update.error.requestId}` : ""}
        </p>
      ) : null}
    </section>
  );
}

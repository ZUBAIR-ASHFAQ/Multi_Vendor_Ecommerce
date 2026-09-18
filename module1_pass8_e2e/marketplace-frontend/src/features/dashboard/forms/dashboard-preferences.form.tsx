import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import {
  DASHBOARD_DATE_RANGE_LABEL,
  DASHBOARD_DATE_RANGE_VALUES,
  DASHBOARD_WIDGET_LABEL,
  DASHBOARD_WIDGET_VALUES,
} from "../dashboard.constants";
import { useUpdateDashboardPreferencesMutation } from "../hooks/use-dashboard";
import { dashboardPreferencesFormSchema } from "../schemas/dashboard.schemas";
import type { DashboardPreferences } from "../types/dashboard.types";

/** Returns currently visible widget codes in deterministic layout order. */
function visibleWidgetCodes(preferences: DashboardPreferences) {
  return [...preferences.layout.widgets]
    .sort((left, right) => left.order - right.order)
    .filter((widget) => widget.visible)
    .map((widget) => widget.widgetCode);
}

/** Normalizes optional UUID text to the null form expected by the preference command. */
function nullableUuid(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

/** Renders user-owned Dashboard default scope and widget visibility preferences. */
export function DashboardPreferencesForm({ preferences }: { preferences: DashboardPreferences }) {
  const update = useUpdateDashboardPreferencesMutation();
  const form = useForm({
    defaultValues: {
      defaultDateRange: preferences.defaultDateRange,
      defaultStoreId: preferences.defaultStoreId ?? "",
      visibleWidgets: visibleWidgetCodes(preferences),
    },
    validators: { onChange: dashboardPreferencesFormSchema },
    onSubmit: ({ value }) => {
      update.mutate({
        defaultDateRange: value.defaultDateRange,
        defaultStoreId: nullableUuid(value.defaultStoreId),
        layout: {
          widgets: DASHBOARD_WIDGET_VALUES.map((widgetCode, order) => ({
            widgetCode,
            order,
            visible: value.visibleWidgets.includes(widgetCode),
          })),
        },
      });
    },
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-white p-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Dashboard preferences</h2>
        <p className="text-sm text-slate-600">Choose your default date/store scope and visible widgets.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form.Field name="defaultDateRange">
          {(field) => (
            <label className="text-sm font-medium">
              Default date range
              <select
                aria-label="Dashboard default date range"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as typeof field.state.value)}
              >
                {DASHBOARD_DATE_RANGE_VALUES.map((value) => (
                  <option key={value} value={value}>{DASHBOARD_DATE_RANGE_LABEL[value]}</option>
                ))}
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="defaultStoreId">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Default store UUID
                <input
                  aria-label="Dashboard default store UUID"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="Optional"
                  aria-invalid={Boolean(error)}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>

      <form.Field name="visibleWidgets">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <fieldset>
              <legend className="text-sm font-medium">Visible widgets</legend>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {DASHBOARD_WIDGET_VALUES.map((widgetCode) => {
                  const checked = field.state.value.includes(widgetCode);
                  return (
                    <label key={widgetCode} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          field.handleChange(
                            event.target.checked
                              ? [...field.state.value, widgetCode]
                              : field.state.value.filter((value) => value !== widgetCode),
                          );
                        }}
                      />
                      {DASHBOARD_WIDGET_LABEL[widgetCode]}
                    </label>
                  );
                })}
              </div>
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </fieldset>
          );
        }}
      </form.Field>

      {update.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {update.error instanceof Error ? update.error.message : "Preferences could not be saved."}
          {update.error instanceof ApiClientError && update.error.requestId ? ` Request ID: ${update.error.requestId}` : ""}
        </p>
      ) : null}
      {update.isSuccess ? <p className="text-sm text-emerald-700">Preferences saved.</p> : null}

      <Button disabled={update.isPending}>{update.isPending ? "Saving..." : "Save preferences"}</Button>
    </form>
  );
}

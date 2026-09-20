import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { AdminLayout } from "../components/admin-layout";
import { RequirePagePermission } from "../components/permission-gate";
import { ADMIN_PERMISSION, PLATFORM_SETTING_KEY } from "../administration.constants";
import { platformSettingsFormSchema } from "../schemas/administration.schemas";
import type { PlatformSettingsResponse } from "../types/administration.types";
import {
  usePlatformSettingsQuery,
  useUpdatePlatformSettingsMutation,
} from "../hooks/use-administration";

/** Reads one setting value from the API response while keeping unknown JSON at the boundary. */
function settingValue(settings: PlatformSettingsResponse, key: string): unknown {
  return settings.settings.find((setting) => setting.key === key)?.value;
}

/** Converts the persisted supported-currency JSON array into a friendly comma-separated input value. */
function currenciesText(settings: PlatformSettingsResponse): string {
  const value = settingValue(settings, PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "USD";
}

/** Converts one persisted currency value into a safe form default. */
function currencyText(settings: PlatformSettingsResponse): string {
  const value = settingValue(settings, PLATFORM_SETTING_KEY.DEFAULT_CURRENCY);
  return typeof value === "string" ? value : "USD";
}

/** Converts one persisted tax-rate value into a form string without losing its numeric meaning. */
function taxRateText(settings: PlatformSettingsResponse): string {
  const value = settingValue(settings, PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

/** Parses a human-entered currency list into normalized three-letter codes for the API. */
function parseCurrencies(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((currency) => currency.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

/** Renders and submits the allow-listed Module 2 platform settings. */
function SettingsForm({ settings }: { settings: PlatformSettingsResponse }) {
  const update = useUpdatePlatformSettingsMutation();
  const form = useForm({
    defaultValues: {
      supportedCurrencies: currenciesText(settings),
      defaultCurrency: currencyText(settings),
      defaultTaxRatePercent: taxRateText(settings),
    },
    validators: { onChange: platformSettingsFormSchema },
    onSubmit: async ({ value }) => {
      await update.mutateAsync([
        {
          key: PLATFORM_SETTING_KEY.SUPPORTED_CURRENCIES,
          value: parseCurrencies(value.supportedCurrencies),
        },
        {
          key: PLATFORM_SETTING_KEY.DEFAULT_CURRENCY,
          value: value.defaultCurrency.trim().toUpperCase(),
        },
        {
          key: PLATFORM_SETTING_KEY.DEFAULT_TAX_RATE_PERCENT,
          value: Number(value.defaultTaxRatePercent),
        },
      ]);
    },
  });

  useEffect(() => {
    form.setFieldValue("supportedCurrencies", currenciesText(settings));
    form.setFieldValue("defaultCurrency", currencyText(settings));
    form.setFieldValue("defaultTaxRatePercent", taxRateText(settings));
  }, [form, settings]);

  return (
    <section className="rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">Platform settings</h1>
      <p className="mt-2 text-sm text-slate-600">
        Only non-secret, allow-listed commerce settings are editable here. Environment secrets stay outside the database.
      </p>

      <form
        className="mt-6 grid gap-5 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="supportedCurrencies">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium md:col-span-2">
                Supported currencies
                <input
                  aria-label="Supported currencies"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="USD, EUR, GBP"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Comma-separated ISO-style three-letter currency codes.
                </span>
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="defaultCurrency">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Default currency
                <input
                  aria-label="Default currency"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="defaultTaxRatePercent">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Default tax rate (%)
                <input
                  aria-label="Default tax rate"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  inputMode="decimal"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error && <span className="block text-xs text-red-600">{error}</span>}
              </label>
            );
          }}
        </form.Field>

        <div className="md:col-span-2">
          <FormError error={update.error} />
          {update.isSuccess && (
            <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
              Platform settings saved.
            </p>
          )}
          <Button className="mt-3" disabled={update.isPending}>
            {update.isPending ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Loads the platform settings and protects the page with admin.settings.manage. */
export function SettingsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={ADMIN_PERMISSION.SETTINGS_MANAGE}>
          <SettingsPageContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

/** Handles the query loading/error states before rendering the settings form. */
function SettingsPageContent() {
  const query = usePlatformSettingsQuery();

  if (query.isPending) return <LoadingState label="Loading platform settings..." />;
  if (query.isError) {
    return (
      <ErrorState
        title="Settings could not be loaded"
        message={query.error instanceof Error ? query.error.message : "Please try again."}
        requestId={query.error instanceof ApiClientError ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return <SettingsForm settings={query.data} />;
}

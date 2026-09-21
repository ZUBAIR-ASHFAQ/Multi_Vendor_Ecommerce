import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { firstFieldError } from "@/features/auth/components/form-error";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  REPORT_CODE,
  REPORT_DEFAULT_SORT,
  REPORT_SORT_OPTIONS,
  type ReportCode,
} from "../reports.constants";
import { reportFilterFormSchema } from "../schemas/reports.schemas";
import type { ReportUiFilters } from "../types/reports.types";

/** Converts an API ISO timestamp into a datetime-local value for the browser input. */
function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Converts one datetime-local value into the API ISO format. */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Converts blank text into undefined so unsupported empty filters are not sent to the API. */
function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

/** Returns the report-specific default sort without accepting arbitrary browser sort keys. */
function defaultSort(reportCode: Exclude<ReportCode, "audit_log">): string {
  return REPORT_DEFAULT_SORT[reportCode];
}

/** Selects only fields supported by the chosen backend report route. */
function selectReportFilters(
  reportCode: Exclude<ReportCode, "audit_log">,
  value: {
    from: string;
    to: string;
    sellerId: string;
    storeId: string;
    currency: string;
    lowStockOnly: "" | "true" | "false";
    sort: string;
  },
  user: AuthenticatedUser,
): ReportUiFilters {
  const sellerId = user.accountType === "platform_admin" ? optionalText(value.sellerId) : undefined;
  const storeId = optionalText(value.storeId);

  if (reportCode === REPORT_CODE.INVENTORY) {
    return {
      sellerId,
      storeId,
      lowStockOnly: value.lowStockOnly === "" ? undefined : value.lowStockOnly === "true",
      sort: value.sort,
    };
  }

  const common = {
    from: toIsoDateTime(value.from),
    to: toIsoDateTime(value.to),
    sellerId,
    currency: optionalText(value.currency)?.toUpperCase(),
    sort: value.sort,
  };

  if (reportCode === REPORT_CODE.SALES || reportCode === REPORT_CODE.REFUNDS) {
    return { ...common, storeId };
  }

  return common;
}

/** Renders one TanStack Form + Zod filter panel while keeping report-specific fields allow-listed. */
export function ReportFilterForm({
  user,
  reportCode,
  filters,
  onApply,
}: {
  user: AuthenticatedUser;
  reportCode: Exclude<ReportCode, "audit_log">;
  filters: ReportUiFilters;
  onApply: (filters: ReportUiFilters) => void;
}) {
  const form = useForm({
    defaultValues: {
      from: toLocalDateTime(filters.from),
      to: toLocalDateTime(filters.to),
      sellerId: filters.sellerId ?? "",
      storeId: filters.storeId ?? "",
      currency: filters.currency ?? "",
      lowStockOnly:
        filters.lowStockOnly === undefined ? "" : filters.lowStockOnly ? "true" : "false",
      sort: filters.sort ?? defaultSort(reportCode),
    },
    validators: { onChange: reportFilterFormSchema },
    onSubmit: ({ value }) => onApply(selectReportFilters(reportCode, value, user)),
  });

  const showDates = reportCode !== REPORT_CODE.INVENTORY;
  const showCurrency = reportCode !== REPORT_CODE.INVENTORY;
  const showStore = reportCode === REPORT_CODE.SALES || reportCode === REPORT_CODE.REFUNDS || reportCode === REPORT_CODE.INVENTORY;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Surface>
        <SectionHeader
          title="Filters"
          description="Narrow the server-side report scope, then run or export the same filter set."
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {showDates ? (
        <>
          <form.Field name="from">
            {(field) => {
              const error = firstFieldError(field.state.meta.errors);
              return (
                <label className="text-sm font-medium">
                  From
                  <Input
                    aria-label="Report from"
                    type="datetime-local"
                    className="mt-1"
                    aria-invalid={Boolean(error)}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {error ? <span className="mt-1 block text-xs text-negative">{error}</span> : null}
                </label>
              );
            }}
          </form.Field>
          <form.Field name="to">
            {(field) => (
              <label className="text-sm font-medium">
                To
                <Input
                  aria-label="Report to"
                  type="datetime-local"
                  className="mt-1"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </label>
            )}
          </form.Field>
        </>
      ) : null}

      {user.accountType === "platform_admin" ? (
        <form.Field name="sellerId">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Seller UUID
                <Input
                  aria-label="Report seller UUID"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  aria-invalid={Boolean(error)}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-negative">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      ) : null}

      {showStore ? (
        <form.Field name="storeId">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Store UUID
                <Input
                  aria-label="Report store UUID"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  aria-invalid={Boolean(error)}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-negative">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      ) : null}

      {showCurrency ? (
        <form.Field name="currency">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Currency
                <Input
                  aria-label="Report currency"
                  className="mt-1 uppercase"
                  maxLength={3}
                  placeholder="USD"
                  aria-invalid={Boolean(error)}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
                />
                {error ? <span className="mt-1 block text-xs text-negative">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      ) : null}

      {reportCode === REPORT_CODE.INVENTORY ? (
        <form.Field name="lowStockOnly">
          {(field) => (
            <label className="text-sm font-medium">
              Stock risk
              <Select
                aria-label="Report low stock filter"
                className="mt-1"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "" | "true" | "false")}
              >
                <option value="">All inventory</option>
                <option value="true">Low stock only</option>
                <option value="false">Not low stock only</option>
              </Select>
            </label>
          )}
        </form.Field>
      ) : null}

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium">
            Sort
            <Select
              aria-label="Report sort"
              className="mt-1"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              {REPORT_SORT_OPTIONS[reportCode].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </label>
        )}
      </form.Field>

          <div className="flex items-end gap-2">
            <Button>Apply filters</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onApply({ sort: defaultSort(reportCode) })}
            >
              Clear
            </Button>
          </div>
        </div>
      </Surface>
    </form>
  );
}

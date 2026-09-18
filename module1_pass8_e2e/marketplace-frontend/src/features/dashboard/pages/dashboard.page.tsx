import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { ApiClientError } from "@/lib/api-error";
import { DashboardOperationalAlerts } from "../components/dashboard-alerts";
import { DashboardCommissionPayoutSummary, DashboardRefundReturnSummary } from "../components/dashboard-finance-summary";
import { DashboardKpiCards } from "../components/dashboard-kpi-cards";
import { DashboardLayout } from "../components/dashboard-layout";
import { DashboardOrdersTrend } from "../components/dashboard-orders-trend";
import { DashboardSellerTable } from "../components/dashboard-seller-table";
import { SavedDashboardFilters } from "../components/saved-dashboard-filters";
import {
  DASHBOARD_PERMISSION,
  DASHBOARD_WIDGET,
  DASHBOARD_WIDGET_VALUES,
} from "../dashboard.constants";
import { DashboardFilterForm } from "../forms/dashboard-filter.form";
import { DashboardPreferencesForm } from "../forms/dashboard-preferences.form";
import {
  useDashboardAlertsQuery,
  useDashboardOrdersQuery,
  useDashboardSellersQuery,
  useDashboardSummaryQuery,
} from "../hooks/use-dashboard";
import type { DashboardFilter, DashboardPreferences } from "../types/dashboard.types";

/** Converts a saved default date preset into an explicit bounded UTC filter window. */
function presetDateFilter(
  preset: DashboardPreferences["defaultDateRange"],
  now = new Date(),
): Pick<DashboardFilter, "from" | "to"> {
  const to = new Date(now);
  const from = new Date(now);

  if (preset === "today") {
    from.setUTCHours(0, 0, 0, 0);
  } else if (preset === "this_month") {
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
  } else {
    const dayCount = preset === "last_7_days" ? 7 : preset === "last_90_days" ? 90 : 30;
    from.setUTCDate(from.getUTCDate() - (dayCount - 1));
  }

  return { from: from.toISOString(), to: to.toISOString() };
}

/** Returns a default visible layout while the preference snapshot is still loading. */
function defaultVisibleWidgets(): Set<string> {
  return new Set(DASHBOARD_WIDGET_VALUES);
}

/** Returns the user-selected visible widget set from a validated preference snapshot. */
function visibleWidgets(preferences?: DashboardPreferences): Set<string> {
  if (!preferences) return defaultVisibleWidgets();
  return new Set(
    [...preferences.layout.widgets]
      .sort((left, right) => left.order - right.order)
      .filter((widget) => widget.visible)
      .map((widget) => widget.widgetCode),
  );
}

/** Renders a safe retryable query error including the API request ID when available. */
function DashboardQueryError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <ErrorState
      title={error instanceof ApiClientError && error.code === "DASHBOARD_WIDGET_UNAVAILABLE" ? "Widget unavailable" : title}
      message={error instanceof Error ? error.message : "Please try again."}
      requestId={error instanceof ApiClientError ? error.requestId : undefined}
      onRetry={onRetry}
    />
  );
}

/** Coordinates the role-aware Dashboard widgets while keeping each server read independently retryable. */
function DashboardContent({ user }: { user: AuthenticatedUser }) {
  const [filters, setFilters] = useState<DashboardFilter>({});
  const [sellerPage, setSellerPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);
  const [sellerSort, setSellerSort] = useState<"gmv_desc" | "gmv_asc" | "orders_desc" | "orders_asc">("gmv_desc");
  const initializedPreferences = useRef(false);

  const summary = useDashboardSummaryQuery(filters);
  const orders = useDashboardOrdersQuery(filters);
  const canReadSellers = user.permissions.includes(DASHBOARD_PERMISSION.SELLER_READ);
  const sellers = useDashboardSellersQuery({ ...filters, page: sellerPage, pageSize: 10, sort: sellerSort }, canReadSellers);
  const alerts = useDashboardAlertsQuery({ ...filters, page: alertPage, pageSize: 10 });

  useEffect(() => {
    if (!summary.data || initializedPreferences.current) return;
    initializedPreferences.current = true;
    const preferences = summary.data.preferences;
    setFilters({
      ...presetDateFilter(preferences.defaultDateRange),
      storeId: preferences.defaultStoreId ?? undefined,
    });
  }, [summary.data]);

  const shownWidgets = visibleWidgets(summary.data?.preferences);

  /** Applies one new filter set and resets all server pagination to the first page. */
  function applyFilters(next: DashboardFilter): void {
    setFilters(next);
    setSellerPage(1);
    setAlertPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Executive & operations</p>
        <h1 className="mt-1 text-3xl font-bold">Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Permission-filtered marketplace KPIs and operational summaries. Orders, payments, stock,
          refunds, commissions and payouts remain owned by their source modules.
        </p>
      </section>

      <DashboardFilterForm key={JSON.stringify(filters)} user={user} filters={filters} onApply={applyFilters} />

      {summary.isPending ? <LoadingState label="Loading Dashboard summary..." /> : null}
      {summary.isError ? (
        <DashboardQueryError title="Dashboard summary could not be loaded" error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {summary.data && user.permissions.includes(DASHBOARD_PERMISSION.MANAGE_PREFERENCES) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SavedDashboardFilters preferences={summary.data.preferences} currentFilters={filters} onLoad={applyFilters} />
          <DashboardPreferencesForm key={summary.data.preferences.updatedAt ?? "default"} preferences={summary.data.preferences} />
        </div>
      ) : null}

      {shownWidgets.has(DASHBOARD_WIDGET.EXECUTIVE_KPIS) && summary.data ? <DashboardKpiCards summary={summary.data} /> : null}

      {shownWidgets.has(DASHBOARD_WIDGET.ORDERS_TREND) ? (
        <div className="space-y-3">
          {orders.isPending ? <LoadingState label="Loading order trend..." /> : null}
          {orders.isError ? (
            <DashboardQueryError
              title="Order trend could not be loaded"
              error={orders.error}
              onRetry={() => void orders.refetch()}
            />
          ) : null}
          {orders.data ? <DashboardOrdersTrend orders={orders.data} /> : null}
        </div>
      ) : null}

      {shownWidgets.has(DASHBOARD_WIDGET.SELLER_PERFORMANCE) && canReadSellers ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <label className="text-sm font-medium">
              Seller sort
              <select
                aria-label="Dashboard seller sort"
                className="ml-2 rounded-md border px-3 py-2"
                value={sellerSort}
                onChange={(event) => {
                  setSellerSort(event.target.value as typeof sellerSort);
                  setSellerPage(1);
                }}
              >
                <option value="gmv_desc">GMV high to low</option>
                <option value="gmv_asc">GMV low to high</option>
                <option value="orders_desc">Orders high to low</option>
                <option value="orders_asc">Orders low to high</option>
              </select>
            </label>
          </div>
          {sellers.isPending ? <LoadingState label="Loading seller performance..." /> : null}
          {sellers.isError ? (
            <DashboardQueryError
              title="Seller performance could not be loaded"
              error={sellers.error}
              onRetry={() => void sellers.refetch()}
            />
          ) : null}
          {sellers.data ? <DashboardSellerTable sellers={sellers.data.data} meta={sellers.data.meta} onPageChange={setSellerPage} /> : null}
        </div>
      ) : null}

      {shownWidgets.has(DASHBOARD_WIDGET.OPERATIONAL_ALERTS) ? (
        <div className="space-y-3">
          {alerts.isPending ? <LoadingState label="Loading operational alerts..." /> : null}
          {alerts.isError ? (
            <DashboardQueryError
              title="Operational alerts could not be loaded"
              error={alerts.error}
              onRetry={() => void alerts.refetch()}
            />
          ) : null}
          {alerts.data ? (
            <DashboardOperationalAlerts
              alerts={alerts.data.data}
              meta={alerts.data.meta}
              onPageChange={setAlertPage}
            />
          ) : null}
        </div>
      ) : null}

      {shownWidgets.has(DASHBOARD_WIDGET.REFUND_RETURN_SUMMARY) && summary.data ? (
        <DashboardRefundReturnSummary summary={summary.data} />
      ) : null}
      {shownWidgets.has(DASHBOARD_WIDGET.COMMISSION_PAYOUT_SUMMARY) && summary.data?.finance ? (
        <DashboardCommissionPayoutSummary summary={summary.data} />
      ) : null}

      {!user.permissions.includes(DASHBOARD_PERMISSION.FINANCE_READ) ? (
        <p className="rounded-lg border bg-white p-4 text-sm text-slate-600">
          Finance-sensitive Dashboard values are hidden for this account. Operational KPIs remain
          available within your server-derived scope.
        </p>
      ) : null}
    </div>
  );
}

/** Renders the authenticated Module 1 Dashboard route. */
export function DashboardPage() {
  return <DashboardLayout>{(user) => <DashboardContent user={user} />}</DashboardLayout>;
}

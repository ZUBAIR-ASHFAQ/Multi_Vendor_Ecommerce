import { Link } from "@tanstack/react-router";
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

function DashboardWorkspaceNavigation({ user }: { user: AuthenticatedUser }) {
  const has = (permission: string) => user.permissions.includes(permission);
  const isSeller = user.accountType === "seller";

  return (
    <aside className="workspace-sidebar" aria-label={isSeller ? "Seller dashboard navigation" : "Admin dashboard navigation"}>
      <div className="workspace-sidebar-header">
        <p className="workspace-sidebar-kicker">{isSeller ? "Seller workspace" : "Marketplace control center"}</p>
        <h2 className="workspace-sidebar-title">{user.displayName}</h2>
        <p className="workspace-sidebar-subtitle">{user.email}</p>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Overview</p>
        <nav className="workspace-nav-list">
          <Link to="/dashboard" className="workspace-nav-link" activeProps={{ className: "workspace-nav-link workspace-nav-link-active" }}>Dashboard <span>⌂</span></Link>
          {isSeller && has("seller.orders.read") ? <Link to="/seller/orders" className="workspace-nav-link">Orders <span>›</span></Link> : null}
          {isSeller && has("seller.products.read") ? <Link to="/seller/products" className="workspace-nav-link">Products <span>›</span></Link> : null}
          {isSeller && has("inventory.read") ? <Link to="/seller/inventory" className="workspace-nav-link">Inventory <span>›</span></Link> : null}
          {!isSeller && has("admin.orders.read") ? <Link to="/admin/orders" className="workspace-nav-link">Orders <span>›</span></Link> : null}
          {!isSeller && has("admin.sellers.review") ? <Link to="/admin/seller-applications" className="workspace-nav-link">Sellers <span>›</span></Link> : null}
          {!isSeller && has("admin.customers.read") ? <Link to="/admin/customers" className="workspace-nav-link">Customers <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">{isSeller ? "Growth & finance" : "Commerce"}</p>
        <nav className="workspace-nav-list">
          {isSeller && has("seller.promotions.manage") ? <Link to="/seller/promotions" className="workspace-nav-link">Promotions <span>›</span></Link> : null}
          {isSeller && has("seller.returns.manage") ? <Link to="/seller/returns" className="workspace-nav-link">Returns <span>›</span></Link> : null}
          {isSeller && has("seller.wallet.read") ? <Link to="/seller/wallet" className="workspace-nav-link">Wallet & payouts <span>›</span></Link> : null}
          {isSeller && has("seller.commissions.read") ? <Link to="/seller/commissions" className="workspace-nav-link">Commissions <span>›</span></Link> : null}
          {!isSeller && has("admin.payments.read") ? <Link to="/admin/payments" className="workspace-nav-link">Payments <span>›</span></Link> : null}
          {!isSeller && has("admin.returns.manage") ? <Link to="/admin/returns" className="workspace-nav-link">Returns & refunds <span>›</span></Link> : null}
          {!isSeller && has("admin.payouts.read") ? <Link to="/admin/payouts" className="workspace-nav-link">Payouts <span>›</span></Link> : null}
          {!isSeller && has("admin.commissions.read") ? <Link to="/admin/commissions/entries" className="workspace-nav-link">Commissions <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Workspace</p>
        <nav className="workspace-nav-list">
          {isSeller && has("seller.store.manage") ? <Link to="/seller/stores" className="workspace-nav-link">Stores <span>›</span></Link> : null}
          {isSeller && has("seller.staff.manage") ? <Link to="/seller/staff" className="workspace-nav-link">Staff <span>›</span></Link> : null}
          {isSeller && has("seller.profile.read") ? <Link to="/seller/profile" className="workspace-nav-link">Seller profile <span>›</span></Link> : null}
          {!isSeller && has("catalog.manage_categories") ? <Link to="/admin/catalog/categories" className="workspace-nav-link">Catalog & taxonomy <span>›</span></Link> : null}
          {!isSeller && has("admin.users.read") ? <Link to="/admin/users" className="workspace-nav-link">Users & roles <span>›</span></Link> : null}
          {has("reports.sales.read") || has("reports.seller.read") || has("reports.finance.read") || has("reports.inventory.read") ? <Link to="/reports" className="workspace-nav-link">Reports <span>›</span></Link> : null}
          {!isSeller && has("audit.read") ? <Link to="/audit" className="workspace-nav-link">Documents & audit <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-sidebar-footer">
        <strong>● Platform healthy</strong>
        <p>Dashboard data remains permission-filtered and sourced from the existing backend modules.</p>
        <div className="workspace-account-actions"><Link to="/account" className="workspace-nav-link">Account <span>›</span></Link></div>
      </div>
    </aside>
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
    <div className="workspace-frame">
      <DashboardWorkspaceNavigation user={user} />
      <div className="workspace-main">
      <div className="dashboard-shell space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {user.accountType === "seller" ? "Seller workspace" : "Marketplace control center"}
        </p>
        <h1 className="mt-1 text-3xl font-bold">
          <span className="sr-only">Dashboard</span>
          <span aria-hidden="true">
            {user.accountType === "seller" ? `Good morning, ${user.displayName}.` : "Platform overview"}
          </span>
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Permission-aware marketplace KPIs across orders, payments, sellers, inventory, returns, commissions and payouts.
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
      </div>
    </div>
  );
}

/** Renders the authenticated Module 1 Dashboard route. */
export function DashboardPage() {
  return <DashboardLayout>{(user) => <DashboardContent user={user} />}</DashboardLayout>;
}

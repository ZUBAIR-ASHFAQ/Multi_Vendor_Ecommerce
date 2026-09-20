import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import {
  WORKSPACE_NAV_ACTIVE_CLASS,
  WORKSPACE_NAV_LINK_CLASS,
  WorkspaceNavGroup,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@/components/workspace/workspace-shell";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { ORDERS_PERMISSION } from "@/features/orders/orders.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { ApiClientError } from "@/lib/api-error";
import { DashboardOperationalAlerts } from "../components/dashboard-alerts";
import { DashboardRecentOrders } from "../components/dashboard-recent-orders";
import { DashboardCommissionPayoutSummary, DashboardRefundReturnSummary } from "../components/dashboard-finance-summary";
import { DashboardKpiCards } from "../components/dashboard-kpi-cards";
import { DashboardLayout } from "../components/dashboard-layout";
import { DashboardOrdersTrend } from "../components/dashboard-orders-trend";
import { DashboardSellerTable } from "../components/dashboard-seller-table";
import { DashboardSellerWalletSummary } from "../components/dashboard-seller-wallet-summary";
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
    <WorkspaceSidebar
      ariaLabel={isSeller ? "Seller dashboard navigation" : "Admin dashboard navigation"}
      kicker={isSeller ? "Seller workspace" : "Marketplace control center"}
      title={user.displayName}
      subtitle={user.email}
      footer={(
        <>
          <strong>● Platform healthy</strong>
          <p>Dashboard data remains permission-filtered and sourced from the existing backend modules.</p>
          <div className="workspace-account-actions">
            <Link to="/account" className={WORKSPACE_NAV_LINK_CLASS}>Account <span>›</span></Link>
          </div>
        </>
      )}
    >
      <WorkspaceNavGroup label="Overview">
        <Link to="/dashboard" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Dashboard <span>⌂</span></Link>
        {isSeller && has("seller.orders.read") ? <Link to="/seller/orders" className={WORKSPACE_NAV_LINK_CLASS}>Orders <span>›</span></Link> : null}
        {isSeller && has("seller.products.read") ? <Link to="/seller/products" className={WORKSPACE_NAV_LINK_CLASS}>Products <span>›</span></Link> : null}
        {isSeller && has("inventory.read") ? <Link to="/seller/inventory" className={WORKSPACE_NAV_LINK_CLASS}>Inventory <span>›</span></Link> : null}
        {!isSeller && has("admin.orders.read") ? <Link to="/admin/orders" className={WORKSPACE_NAV_LINK_CLASS}>Orders <span>›</span></Link> : null}
        {!isSeller && has("admin.sellers.review") ? <Link to="/admin/seller-applications" className={WORKSPACE_NAV_LINK_CLASS}>Sellers <span>›</span></Link> : null}
        {!isSeller && has("admin.customers.read") ? <Link to="/admin/customers" className={WORKSPACE_NAV_LINK_CLASS}>Customers <span>›</span></Link> : null}
      </WorkspaceNavGroup>

      <WorkspaceNavGroup label={isSeller ? "Growth & finance" : "Commerce"}>
        {isSeller && has("seller.promotions.manage") ? <Link to="/seller/promotions" className={WORKSPACE_NAV_LINK_CLASS}>Promotions <span>›</span></Link> : null}
        {isSeller && has("seller.returns.manage") ? <Link to="/seller/returns" className={WORKSPACE_NAV_LINK_CLASS}>Returns <span>›</span></Link> : null}
        {isSeller && has("seller.wallet.read") ? <Link to="/seller/wallet" className={WORKSPACE_NAV_LINK_CLASS}>Wallet & payouts <span>›</span></Link> : null}
        {isSeller && has("seller.commissions.read") ? <Link to="/seller/commissions" className={WORKSPACE_NAV_LINK_CLASS}>Commissions <span>›</span></Link> : null}
        {!isSeller && has("admin.payments.read") ? <Link to="/admin/payments" className={WORKSPACE_NAV_LINK_CLASS}>Payments <span>›</span></Link> : null}
        {!isSeller && has("admin.returns.manage") ? <Link to="/admin/returns" className={WORKSPACE_NAV_LINK_CLASS}>Returns & refunds <span>›</span></Link> : null}
        {!isSeller && has("admin.payouts.read") ? <Link to="/admin/payouts" className={WORKSPACE_NAV_LINK_CLASS}>Payouts <span>›</span></Link> : null}
        {!isSeller && has("admin.commissions.read") ? <Link to="/admin/commissions/entries" className={WORKSPACE_NAV_LINK_CLASS}>Commissions <span>›</span></Link> : null}
      </WorkspaceNavGroup>

      <WorkspaceNavGroup label="Workspace">
        {isSeller && has("seller.store.manage") ? <Link to="/seller/stores" className={WORKSPACE_NAV_LINK_CLASS}>Stores <span>›</span></Link> : null}
        {isSeller && has("seller.staff.manage") ? <Link to="/seller/staff" className={WORKSPACE_NAV_LINK_CLASS}>Staff <span>›</span></Link> : null}
        {isSeller && has("seller.profile.read") ? <Link to="/seller/profile" className={WORKSPACE_NAV_LINK_CLASS}>Seller profile <span>›</span></Link> : null}
        {!isSeller && has("catalog.manage_categories") ? <Link to="/admin/catalog/categories" className={WORKSPACE_NAV_LINK_CLASS}>Catalog & taxonomy <span>›</span></Link> : null}
        {!isSeller && has("admin.users.read") ? <Link to="/admin/users" className={WORKSPACE_NAV_LINK_CLASS}>Users & roles <span>›</span></Link> : null}
        {has("reports.sales.read") || has("reports.seller.read") || has("reports.finance.read") || has("reports.inventory.read") ? <Link to="/reports" className={WORKSPACE_NAV_LINK_CLASS}>Reports <span>›</span></Link> : null}
        {!isSeller && has("audit.read") ? <Link to="/audit" className={WORKSPACE_NAV_LINK_CLASS}>Documents & audit <span>›</span></Link> : null}
      </WorkspaceNavGroup>
    </WorkspaceSidebar>
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
  const isSeller = user.accountType === "seller";
  const canReadSellers = !isSeller && user.permissions.includes(DASHBOARD_PERMISSION.SELLER_READ);
  const canReadSellerOrders = isSeller && user.permissions.includes(ORDERS_PERMISSION.SELLER_READ);
  const canReadWallet = isSeller && user.permissions.includes(WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ);
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
    <WorkspaceShell sidebar={<DashboardWorkspaceNavigation user={user} />}>
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
          {isSeller
            ? "Track sales, fulfillment exceptions, inventory pressure, returns, and settlement balances from one operating view."
            : "Permission-aware marketplace KPIs across orders, payments, sellers, inventory, returns, commissions and payouts."}
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

      {shownWidgets.has(DASHBOARD_WIDGET.EXECUTIVE_KPIS) && summary.data ? (
        <DashboardKpiCards summary={summary.data} sellerMode={isSeller} />
      ) : null}

      {isSeller && shownWidgets.has(DASHBOARD_WIDGET.OPERATIONAL_ALERTS) ? (
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
              sellerMode
            />
          ) : null}
        </div>
      ) : null}

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
          {orders.data ? <DashboardOrdersTrend orders={orders.data} sellerMode={isSeller} /> : null}
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

      {!isSeller && shownWidgets.has(DASHBOARD_WIDGET.OPERATIONAL_ALERTS) ? (
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

      {isSeller && (canReadSellerOrders || canReadWallet) ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <DashboardRecentOrders enabled={canReadSellerOrders} />
          <DashboardSellerWalletSummary enabled={canReadWallet} />
        </div>
      ) : null}

      {shownWidgets.has(DASHBOARD_WIDGET.REFUND_RETURN_SUMMARY) && summary.data ? (
        <DashboardRefundReturnSummary summary={summary.data} />
      ) : null}
      {shownWidgets.has(DASHBOARD_WIDGET.COMMISSION_PAYOUT_SUMMARY) && summary.data?.finance && (!isSeller || !canReadWallet) ? (
        <DashboardCommissionPayoutSummary summary={summary.data} />
      ) : null}

      {!user.permissions.includes(DASHBOARD_PERMISSION.FINANCE_READ) && !(isSeller && canReadWallet) ? (
        <p className="rounded-lg border bg-white p-4 text-sm text-slate-600">
          Finance-sensitive Dashboard values are hidden for this account. Operational KPIs remain
          available within your server-derived scope.
        </p>
      ) : null}
      </div>
    </WorkspaceShell>
  );
}

/** Renders the authenticated Module 1 Dashboard route. */
export function DashboardPage() {
  return <DashboardLayout>{(user) => <DashboardContent user={user} />}</DashboardLayout>;
}

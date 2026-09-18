/** Frontend permission names mirror the server-owned Dashboard RBAC contract. */
export const DASHBOARD_PERMISSION = {
  READ: "dashboard.read",
  FINANCE_READ: "dashboard.finance.read",
  SELLER_READ: "dashboard.seller.read",
  MANAGE_PREFERENCES: "dashboard.manage_preferences",
} as const;

/** Allow-listed Dashboard widgets persisted by the backend preference command. */
export const DASHBOARD_WIDGET = {
  EXECUTIVE_KPIS: "executive_kpis",
  ORDERS_TREND: "orders_trend",
  SELLER_PERFORMANCE: "seller_performance",
  OPERATIONAL_ALERTS: "operational_alerts",
  REFUND_RETURN_SUMMARY: "refund_return_summary",
  COMMISSION_PAYOUT_SUMMARY: "commission_payout_summary",
} as const;

export const DASHBOARD_WIDGET_VALUES = [
  DASHBOARD_WIDGET.EXECUTIVE_KPIS,
  DASHBOARD_WIDGET.ORDERS_TREND,
  DASHBOARD_WIDGET.SELLER_PERFORMANCE,
  DASHBOARD_WIDGET.OPERATIONAL_ALERTS,
  DASHBOARD_WIDGET.REFUND_RETURN_SUMMARY,
  DASHBOARD_WIDGET.COMMISSION_PAYOUT_SUMMARY,
] as const;

/** Human-readable widget names keep layout controls and sections consistent. */
export const DASHBOARD_WIDGET_LABEL: Record<(typeof DASHBOARD_WIDGET_VALUES)[number], string> = {
  executive_kpis: "Executive KPIs",
  orders_trend: "Orders & GMV trend",
  seller_performance: "Seller performance",
  operational_alerts: "Operational alerts",
  refund_return_summary: "Refund & return summary",
  commission_payout_summary: "Commission & payout summary",
};

/** Supported persisted default date presets. */
export const DASHBOARD_DATE_RANGE_VALUES = [
  "today",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
] as const;

/** Human-readable date preset labels for the preference editor. */
export const DASHBOARD_DATE_RANGE_LABEL: Record<(typeof DASHBOARD_DATE_RANGE_VALUES)[number], string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
};

/** Bounded seller table sort keys accepted by the Dashboard API. */
export const DASHBOARD_SELLER_SORT_VALUES = [
  "gmv_desc",
  "gmv_asc",
  "orders_desc",
  "orders_asc",
] as const;

/** Stable operational alert labels shown without taking ownership of source state. */
export const DASHBOARD_ALERT_LABEL: Record<string, string> = {
  low_stock: "Low stock",
  fulfillment_attention: "Fulfillment",
  return_attention: "Return",
  payout_attention: "Payout",
};

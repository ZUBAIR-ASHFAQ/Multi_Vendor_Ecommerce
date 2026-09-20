/** Stable Module 1 permissions required by the controlling Dashboard contract. */
export const DASHBOARD_PERMISSION = {
  READ: "dashboard.read",
  FINANCE_READ: "dashboard.finance.read",
  SELLER_READ: "dashboard.seller.read",
  MANAGE_PREFERENCES: "dashboard.manage_preferences",
} as const;

/** Module-owned permission catalog composed into the central platform RBAC seed. */
export const DASHBOARD_PERMISSION_CATALOG = [
  {
    code: DASHBOARD_PERMISSION.READ,
    domain: "dashboard",
    description: "Read Dashboard summaries and operational widgets inside the actor's allowed scope.",
  },
  {
    code: DASHBOARD_PERMISSION.FINANCE_READ,
    domain: "dashboard",
    description: "Read finance-sensitive Dashboard widgets inside the actor's allowed scope.",
  },
  {
    code: DASHBOARD_PERMISSION.SELLER_READ,
    domain: "dashboard",
    description: "Read seller-scoped Dashboard summaries for assigned seller and store resources.",
  },
  {
    code: DASHBOARD_PERMISSION.MANAGE_PREFERENCES,
    domain: "dashboard",
    description: "Update the authenticated user's Dashboard layout and saved filter preferences.",
  },
] as const;

/** Stable Module 1 business error codes required by the controlling guide. */
export const DASHBOARD_ERROR_CODE = {
  SCOPE_FORBIDDEN: "DASHBOARD_SCOPE_FORBIDDEN",
  WIDGET_UNAVAILABLE: "DASHBOARD_WIDGET_UNAVAILABLE",
  FILTER_INVALID: "INVALID_DASHBOARD_FILTER",
} as const;

/** Exact five-operation Module 1 HTTP surface required by the controlling guide. */
export const DASHBOARD_PATH = {
  SUMMARY: "/api/v1/dashboard/summary",
  ORDERS: "/api/v1/dashboard/orders",
  SELLERS: "/api/v1/dashboard/sellers",
  ALERTS: "/api/v1/dashboard/alerts",
  PREFERENCES: "/api/v1/dashboard/preferences",
} as const;

/** Allow-listed Dashboard widget codes persisted in user layout preferences. */
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

/** Supported default date presets stored in Dashboard preferences. */
export const DASHBOARD_DATE_RANGE = {
  TODAY: "today",
  LAST_7_DAYS: "last_7_days",
  LAST_30_DAYS: "last_30_days",
  LAST_90_DAYS: "last_90_days",
  THIS_MONTH: "this_month",
} as const;

export const DASHBOARD_DATE_RANGE_VALUES = [
  DASHBOARD_DATE_RANGE.TODAY,
  DASHBOARD_DATE_RANGE.LAST_7_DAYS,
  DASHBOARD_DATE_RANGE.LAST_30_DAYS,
  DASHBOARD_DATE_RANGE.LAST_90_DAYS,
  DASHBOARD_DATE_RANGE.THIS_MONTH,
] as const;

/** Bounded seller-performance sorting supported by the Dashboard seller table. */
export const DASHBOARD_SELLER_SORT = [
  "gmv_desc",
  "gmv_asc",
  "orders_desc",
  "orders_asc",
] as const;

/** Durable event emitted after a user successfully changes Dashboard preferences. */
export const DASHBOARD_OUTBOX_EVENT = {
  PREFERENCES_UPDATED: "dashboard.preferences_updated",
} as const;

/** Audit action used for preference changes and privileged Dashboard exports if later exposed. */
export const DASHBOARD_AUDIT_ACTION = {
  PREFERENCES_UPDATED: "dashboard.preferences_updated",
} as const;

/** Small explicit limits keep Dashboard input and persisted preference data bounded. */
export const DASHBOARD_LIMITS = {
  MAX_DATE_RANGE_DAYS: 366,
  SAVED_FILTER_NAME_MAX_LENGTH: 160,
  MAX_SAVED_FILTERS: 25,
  MAX_WIDGETS: DASHBOARD_WIDGET_VALUES.length,
  CURRENCY_LENGTH: 3,
} as const;

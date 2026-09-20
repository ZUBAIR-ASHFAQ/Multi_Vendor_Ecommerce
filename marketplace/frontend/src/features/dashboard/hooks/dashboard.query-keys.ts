import type { DashboardAlertsParams, DashboardFilter, DashboardSellersParams } from "../types/dashboard.types";

/** Stable Dashboard query keys keep invalidation focused on Module 1 server state. */
export const dashboardQueryKeys = {
  all: ["dashboard"] as const,
  summary: (params: DashboardFilter) => ["dashboard", "summary", params] as const,
  orders: (params: DashboardFilter) => ["dashboard", "orders", params] as const,
  sellers: (params: DashboardSellersParams) => ["dashboard", "sellers", params] as const,
  alerts: (params: DashboardAlertsParams) => ["dashboard", "alerts", params] as const,
};

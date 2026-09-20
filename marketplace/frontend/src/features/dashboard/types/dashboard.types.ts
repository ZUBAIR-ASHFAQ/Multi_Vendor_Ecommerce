import type { z } from "zod";
import type { PaginationMeta } from "@/types/api";
import type {
  dashboardAlertsSchema,
  dashboardFilterSchema,
  dashboardOrdersSchema,
  dashboardPreferencesSchema,
  dashboardSellersSchema,
  dashboardSummarySchema,
  updateDashboardPreferencesSchema,
} from "../schemas/dashboard.schemas";

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type DashboardOrders = z.infer<typeof dashboardOrdersSchema>;
export type DashboardSellers = z.infer<typeof dashboardSellersSchema>;
export type DashboardAlerts = z.infer<typeof dashboardAlertsSchema>;
export type DashboardPreferences = z.infer<typeof dashboardPreferencesSchema>;
export type UpdateDashboardPreferences = z.infer<typeof updateDashboardPreferencesSchema>;

/** Seller-table request fields accepted by the documented Dashboard endpoint. */
export interface DashboardSellersParams extends DashboardFilter {
  page: number;
  pageSize: number;
  sort: "gmv_desc" | "gmv_asc" | "orders_desc" | "orders_asc";
}

/** Alert-list request fields accepted by the documented Dashboard endpoint. */
export interface DashboardAlertsParams extends DashboardFilter {
  page: number;
  pageSize: number;
}

/** Standard page wrapper used by the two paginated Dashboard reads. */
export interface DashboardPage<T> {
  data: T;
  meta: PaginationMeta;
}

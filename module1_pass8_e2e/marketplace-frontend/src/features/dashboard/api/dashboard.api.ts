import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  dashboardAlertsSchema,
  dashboardOrdersSchema,
  dashboardPreferencesSchema,
  dashboardSellersSchema,
  dashboardSummarySchema,
  updateDashboardPreferencesSchema,
} from "../schemas/dashboard.schemas";
import type {
  DashboardAlertsParams,
  DashboardFilter,
  DashboardPage,
  DashboardSellersParams,
  UpdateDashboardPreferences,
} from "../types/dashboard.types";

/** Unwraps and validates one successful non-paginated Dashboard response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps and validates one successful paginated Dashboard response. */
async function page<T>(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
  parse: (value: unknown) => T,
): Promise<DashboardPage<T>> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Dashboard pagination metadata is missing.");
  return { data: parse(response.data.data), meta: response.data.meta };
}

export const dashboardApi = {
  /** Reads role/scope-aware Dashboard KPI summary and effective preferences. */
  getSummary: (params: DashboardFilter) =>
    one(apiClient.get("/dashboard/summary", { params }), (value) => dashboardSummarySchema.parse(value)),

  /** Reads order state counts and the exact-money GMV trend. */
  getOrders: (params: DashboardFilter) =>
    one(apiClient.get("/dashboard/orders", { params }), (value) => dashboardOrdersSchema.parse(value)),

  /** Reads one permission-safe page of seller performance. */
  getSellers: (params: DashboardSellersParams) =>
    page(apiClient.get("/dashboard/sellers", { params }), (value) => dashboardSellersSchema.parse(value)),

  /** Reads one permission-scoped page of source-owned operational alerts. */
  getAlerts: (params: DashboardAlertsParams) =>
    page(apiClient.get("/dashboard/alerts", { params }), (value) => dashboardAlertsSchema.parse(value)),

  /** Updates only the authenticated user's Dashboard preferences and saved filters. */
  updatePreferences: (input: UpdateDashboardPreferences) =>
    one(
      apiClient.patch("/dashboard/preferences", updateDashboardPreferencesSchema.parse(input)),
      (value) => dashboardPreferencesSchema.parse(value),
    ),
};

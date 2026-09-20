import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard.api";
import { dashboardQueryKeys } from "./dashboard.query-keys";
import type {
  DashboardAlertsParams,
  DashboardFilter,
  DashboardSellersParams,
  UpdateDashboardPreferences,
} from "../types/dashboard.types";

/** Loads the role/scope-aware Dashboard summary and preference snapshot. */
export function useDashboardSummaryQuery(params: DashboardFilter) {
  return useQuery({
    queryKey: dashboardQueryKeys.summary(params),
    queryFn: () => dashboardApi.getSummary(params),
    retry: false,
  });
}

/** Loads order-state counts and GMV trend for the current Dashboard filters. */
export function useDashboardOrdersQuery(params: DashboardFilter) {
  return useQuery({
    queryKey: dashboardQueryKeys.orders(params),
    queryFn: () => dashboardApi.getOrders(params),
    retry: false,
  });
}

/** Loads one seller-performance page only when the actor holds its dedicated permission. */
export function useDashboardSellersQuery(params: DashboardSellersParams, enabled: boolean) {
  return useQuery({
    queryKey: dashboardQueryKeys.sellers(params),
    queryFn: () => dashboardApi.getSellers(params),
    enabled,
    retry: false,
  });
}

/** Loads one page of source-owned operational alerts for the current actor scope. */
export function useDashboardAlertsQuery(params: DashboardAlertsParams) {
  return useQuery({
    queryKey: dashboardQueryKeys.alerts(params),
    queryFn: () => dashboardApi.getAlerts(params),
    retry: false,
  });
}

/** Updates user-owned Dashboard preferences and refreshes all Module 1 reads after success. */
export function useUpdateDashboardPreferencesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDashboardPreferences) => dashboardApi.updatePreferences(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.all });
    },
  });
}

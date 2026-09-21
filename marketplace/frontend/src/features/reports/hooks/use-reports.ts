import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "../api/reports.api";
import type {
  CommissionsReportParams,
  InventoryReportParams,
  PayoutsReportParams,
  RefundsReportParams,
  ReportExportCommand,
  ReportRunListParams,
  SalesReportParams,
  SellersReportParams,
} from "../types/reports.types";
import { reportsQueryKeys } from "./reports.query-keys";

/** Loads the permission-filtered report catalog. */
export function useReportsCatalogQuery() {
  return useQuery({
    queryKey: reportsQueryKeys.catalog,
    queryFn: reportsApi.getCatalog,
    retry: false,
  });
}

/** Loads one bounded Sales/Orders report page. */
export function useSalesReportQuery(params: SalesReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.sales(params),
    queryFn: () => reportsApi.getSales(params),
    retry: false,
  });
}

/** Loads one bounded Seller performance report page. */
export function useSellersReportQuery(params: SellersReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.sellers(params),
    queryFn: () => reportsApi.getSellers(params),
    retry: false,
  });
}

/** Loads one bounded Inventory/low-stock report page. */
export function useInventoryReportQuery(params: InventoryReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.inventory(params),
    queryFn: () => reportsApi.getInventory(params),
    retry: false,
  });
}

/** Loads one bounded Return/refund report page. */
export function useRefundsReportQuery(params: RefundsReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.refunds(params),
    queryFn: () => reportsApi.getRefunds(params),
    retry: false,
  });
}

/** Loads one bounded immutable Commission report page. */
export function useCommissionsReportQuery(params: CommissionsReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.commissions(params),
    queryFn: () => reportsApi.getCommissions(params),
    retry: false,
  });
}

/** Loads one bounded Seller payout/liability report page. */
export function usePayoutsReportQuery(params: PayoutsReportParams) {
  return useQuery({
    queryKey: reportsQueryKeys.payouts(params),
    queryFn: () => reportsApi.getPayouts(params),
    retry: false,
  });
}

/** Loads one bounded durable export-history page for the current authenticated user. */
export function useReportRunsQuery(userId: string, params: ReportRunListParams) {
  return useQuery({
    queryKey: reportsQueryKeys.runs(userId, params),
    queryFn: () => reportsApi.listRuns(params),
    retry: false,
  });
}

/** Queues one report export and invalidates the server-backed history for the current user. */
export function useCreateReportRunMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReportExportCommand) => reportsApi.createRun(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reportsQueryKeys.runsAll(userId) });
    },
  });
}

/** Polls one requester-owned report run until it reaches a terminal state. */
export function useReportRunQuery(runId: string) {
  return useQuery({
    queryKey: reportsQueryKeys.run(runId),
    queryFn: () => reportsApi.getRun(runId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2_000 : false;
    },
  });
}

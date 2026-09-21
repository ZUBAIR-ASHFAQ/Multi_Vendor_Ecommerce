import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  commissionsReportResponseSchema,
  inventoryReportResponseSchema,
  payoutsReportResponseSchema,
  refundsReportResponseSchema,
  reportDefinitionSchema,
  reportRunSchema,
  salesReportResponseSchema,
  sellersReportResponseSchema,
} from "../schemas/reports.schemas";
import type {
  CommissionsReportParams,
  InventoryReportParams,
  PayoutsReportParams,
  RefundsReportParams,
  ReportExportCommand,
  ReportPage,
  ReportRunListParams,
  SalesReportParams,
  SellersReportParams,
} from "../types/reports.types";

/** Unwraps and validates one successful non-paginated Reports response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps and validates one paginated Reports response. */
async function page<T>(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
  parse: (value: unknown) => T,
): Promise<ReportPage<T>> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Report pagination metadata is missing.");
  return { data: parse(response.data.data), meta: response.data.meta };
}

export const reportsApi = {
  /** Lists only report definitions allowed for the authenticated actor. */
  getCatalog: () =>
    one(apiClient.get("/reports/catalog"), (value) => reportDefinitionSchema.array().parse(value)),

  /** Reads one bounded page of Sales/Orders reporting. */
  getSales: (params: SalesReportParams) =>
    page(apiClient.get("/reports/sales", { params }), (value) => salesReportResponseSchema.parse(value)),

  /** Reads one bounded page of Seller performance reporting. */
  getSellers: (params: SellersReportParams) =>
    page(apiClient.get("/reports/sellers", { params }), (value) => sellersReportResponseSchema.parse(value)),

  /** Reads one bounded page of Inventory/low-stock reporting. */
  getInventory: (params: InventoryReportParams) =>
    page(apiClient.get("/reports/inventory", { params }), (value) => inventoryReportResponseSchema.parse(value)),

  /** Reads one bounded page of Return/refund reporting. */
  getRefunds: (params: RefundsReportParams) =>
    page(apiClient.get("/reports/refunds", { params }), (value) => refundsReportResponseSchema.parse(value)),

  /** Reads one bounded page of immutable Commission reporting. */
  getCommissions: (params: CommissionsReportParams) =>
    page(apiClient.get("/reports/commissions", { params }), (value) => commissionsReportResponseSchema.parse(value)),

  /** Reads one bounded page of Seller payout/liability reporting. */
  getPayouts: (params: PayoutsReportParams) =>
    page(apiClient.get("/reports/payouts", { params }), (value) => payoutsReportResponseSchema.parse(value)),

  /** Lists durable requester-owned report exports from the server. */
  listRuns: (params: ReportRunListParams) =>
    page(apiClient.get("/reports/runs", { params }), (value) => reportRunSchema.array().parse(value)),

  /** Queues one authorized CSV/PDF report run. */
  createRun: (input: ReportExportCommand) =>
    one(apiClient.post("/reports/runs", input), (value) => reportRunSchema.parse(value)),

  /** Reads one requester-owned asynchronous report run. */
  getRun: (runId: string) =>
    one(apiClient.get(`/reports/runs/${runId}`), (value) => reportRunSchema.parse(value)),
};

import type { PaginationMeta } from "@/types/api";
import type { z } from "zod";
import type {
  reportExportCommandSchema,
  reportFilterPresetSchema,
  reportRunSchema,
} from "../schemas/reports.schemas";

export type ReportExportCommand = z.infer<typeof reportExportCommandSchema>;
export type ReportFilterPreset = z.infer<typeof reportFilterPresetSchema>;
export type ReportRun = z.infer<typeof reportRunSchema>;

/** Shared bounded pagination fields for interactive Reports reads. */
export interface ReportPaginationParams {
  page: number;
  pageSize: number;
}

/** Bounded server-side export-history query. */
export type ReportRunListParams = ReportPaginationParams;

/** Shared seller/date/currency filters used where the server contract allows them. */
export interface CommonReportFilters {
  from?: string;
  to?: string;
  sellerId?: string;
  storeId?: string;
  currency?: string;
}

export interface SalesReportParams extends ReportPaginationParams, CommonReportFilters {
  sort: "created_desc" | "created_asc" | "total_desc" | "total_asc";
}

export interface SellersReportParams extends ReportPaginationParams, Omit<CommonReportFilters, "storeId"> {
  sort: "gmv_desc" | "gmv_asc" | "orders_desc" | "orders_asc";
}

export interface InventoryReportParams extends ReportPaginationParams {
  sellerId?: string;
  storeId?: string;
  lowStockOnly?: boolean;
  sort: "available_asc" | "available_desc" | "updated_desc" | "updated_asc";
}

export interface RefundsReportParams extends ReportPaginationParams, CommonReportFilters {
  sort: "created_desc" | "created_asc" | "amount_desc" | "amount_asc";
}

export interface CommissionsReportParams extends ReportPaginationParams, Omit<CommonReportFilters, "storeId"> {
  sort: "occurred_desc" | "occurred_asc" | "amount_desc" | "amount_asc";
}

export interface PayoutsReportParams extends ReportPaginationParams, Omit<CommonReportFilters, "storeId"> {
  sort: "requested_desc" | "requested_asc" | "amount_desc" | "amount_asc";
}

export interface ReportPage<TData> {
  data: TData;
  meta: PaginationMeta;
}

/** Common UI filter values before report-specific fields are selected for an API request. */
export interface ReportUiFilters {
  from?: string;
  to?: string;
  sellerId?: string;
  storeId?: string;
  currency?: string;
  lowStockOnly?: boolean;
  sort?: string;
}

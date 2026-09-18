/** Stable Reports permissions supplied by the backend RBAC contract. */
export const REPORTS_PERMISSION = {
  SALES_READ: "reports.sales.read",
  INVENTORY_READ: "reports.inventory.read",
  FINANCE_READ: "reports.finance.read",
  SELLER_READ: "reports.seller.read",
  EXPORT: "reports.export",
} as const;

/** Stable report codes returned by the permission-filtered report catalog. */
export const REPORT_CODE = {
  SALES: "sales",
  SELLERS: "sellers",
  INVENTORY: "inventory",
  REFUNDS: "refunds",
  COMMISSIONS: "commissions",
  PAYOUTS: "payouts",
  AUDIT_LOG: "audit_log",
} as const;

export const REPORT_CODE_VALUES = [
  REPORT_CODE.SALES,
  REPORT_CODE.SELLERS,
  REPORT_CODE.INVENTORY,
  REPORT_CODE.REFUNDS,
  REPORT_CODE.COMMISSIONS,
  REPORT_CODE.PAYOUTS,
  REPORT_CODE.AUDIT_LOG,
] as const;

export type ReportCode = (typeof REPORT_CODE_VALUES)[number];

/** Formats accepted by the asynchronous export API. */
export const REPORT_OUTPUT_FORMAT = {
  CSV: "csv",
  PDF: "pdf",
} as const;

export const REPORT_OUTPUT_FORMAT_VALUES = [
  REPORT_OUTPUT_FORMAT.CSV,
  REPORT_OUTPUT_FORMAT.PDF,
] as const;


/** Lifecycle states returned for one asynchronous report run. */
export const REPORT_RUN_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const REPORT_RUN_STATUS_VALUES = [
  REPORT_RUN_STATUS.QUEUED,
  REPORT_RUN_STATUS.PROCESSING,
  REPORT_RUN_STATUS.COMPLETED,
  REPORT_RUN_STATUS.FAILED,
] as const;

/** Readable titles for report navigation and catalog cards. */
export const REPORT_LABELS: Record<ReportCode, string> = {
  [REPORT_CODE.SALES]: "Sales & orders",
  [REPORT_CODE.SELLERS]: "Seller performance",
  [REPORT_CODE.INVENTORY]: "Inventory & low stock",
  [REPORT_CODE.REFUNDS]: "Returns & refunds",
  [REPORT_CODE.COMMISSIONS]: "Commissions",
  [REPORT_CODE.PAYOUTS]: "Seller payouts & liability",
  [REPORT_CODE.AUDIT_LOG]: "Audit log export",
};

/** Server allow-listed sort values for each interactive report. */
export const REPORT_SORT_OPTIONS = {
  [REPORT_CODE.SALES]: ["created_desc", "created_asc", "total_desc", "total_asc"],
  [REPORT_CODE.SELLERS]: ["gmv_desc", "gmv_asc", "orders_desc", "orders_asc"],
  [REPORT_CODE.INVENTORY]: ["available_asc", "available_desc", "updated_desc", "updated_asc"],
  [REPORT_CODE.REFUNDS]: ["created_desc", "created_asc", "amount_desc", "amount_asc"],
  [REPORT_CODE.COMMISSIONS]: ["occurred_desc", "occurred_asc", "amount_desc", "amount_asc"],
  [REPORT_CODE.PAYOUTS]: ["requested_desc", "requested_asc", "amount_desc", "amount_asc"],
} as const;

/** Default sort sent for each report so browser and backend behavior stay predictable. */
export const REPORT_DEFAULT_SORT = {
  [REPORT_CODE.SALES]: "created_desc",
  [REPORT_CODE.SELLERS]: "gmv_desc",
  [REPORT_CODE.INVENTORY]: "available_asc",
  [REPORT_CODE.REFUNDS]: "created_desc",
  [REPORT_CODE.COMMISSIONS]: "occurred_desc",
  [REPORT_CODE.PAYOUTS]: "requested_desc",
} as const;

/** Browser-local key for optional filter presets; no server API exists for saved filters. */
export const REPORT_FILTER_PRESET_STORAGE_KEY = "marketplace.report-filter-presets.v1";

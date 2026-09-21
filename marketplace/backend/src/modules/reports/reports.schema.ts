import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  decimalStringSchema,
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  DOCUMENT_AUDIT_LIMITS,
  DOCUMENT_AUDIT_PATTERN,
} from "../documents-audit/documents-audit.constants.js";
import {
  ORDER_STATUS_VALUES,
  SELLER_ORDER_STATUS_VALUES,
} from "../orders/orders.constants.js";
import { RETURN_REFUND_STATUS } from "../returns-refunds/returns-refunds.constants.js";
import { COMMISSION_ENTRY_TYPE_VALUES } from "../commissions/commissions.constants.js";
import { PAYOUT_STATUS_VALUES } from "../seller-wallet-payouts/seller-wallet-payouts.constants.js";
import {
  REPORT_CODE,
  REPORT_CODE_VALUES,
  REPORT_DEFINITION_STATUS_VALUES,
  REPORT_OUTPUT_FORMAT_VALUES,
  REPORT_RUN_STATUS_VALUES,
  REPORTS_LIMITS,
  REPORTS_SORT,
} from "./reports.constants.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns whether an optional report date range is ordered and inside the explicit Module 20 safety cap. */
function isValidReportDateRange(value: {
  from?: string | undefined;
  to?: string | undefined;
}): boolean {
  if (!value.from || !value.to) return true;
  const fromTime = new Date(value.from).getTime();
  const toTime = new Date(value.to).getTime();
  if (fromTime > toTime) return false;
  return toTime - fromTime <= REPORTS_LIMITS.MAX_DATE_RANGE_DAYS * MILLISECONDS_PER_DAY;
}

/** Shared date-range refinement message for bounded report reads and exports. */
const REPORT_DATE_RANGE_MESSAGE = `from/to must be ordered and no more than ${REPORTS_LIMITS.MAX_DATE_RANGE_DAYS} days apart`;

/** ISO-4217-shaped currency code; supported-currency membership remains a service rule. */
export const reportCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(REPORTS_LIMITS.CURRENCY_LENGTH)
  .regex(/^[A-Z]{3}$/u, "Invalid currency code");

/** Exact report money transport; reports never convert authoritative NUMERIC values to JS floating point. */
export const reportMoneySchema = nonNegativeDecimalStringSchema;

/** Signed exact decimal transport used by immutable ledgers and net liability/revenue summaries. */
export const reportSignedMoneySchema = decimalStringSchema;

/** Export format accepted by asynchronous report runs. */
export const reportOutputFormatSchema = z.enum(REPORT_OUTPUT_FORMAT_VALUES);

/** Persisted report-definition lifecycle contract. */
export const reportDefinitionStatusSchema = z.enum(REPORT_DEFINITION_STATUS_VALUES);

/** Persisted asynchronous report-run lifecycle contract. */
export const reportRunStatusSchema = z.enum(REPORT_RUN_STATUS_VALUES);

/** Stable report code contract shared by catalog and run commands. */
export const reportCodeSchema = z.enum(REPORT_CODE_VALUES);

const reportDateRangeFields = {
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
};

const reportSellerScopeFields = {
  sellerId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
};

const reportCurrencyFilterField = {
  currency: reportCurrencySchema.optional(),
};

/** Query-string boolean that does not treat the string "false" as truthy. */
const booleanQuerySchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

/** Sales/orders report export filters. Pagination and sort are intentionally not part of persisted export filters. */
export const salesReportFilterSchema = z
  .object({
    ...reportDateRangeFields,
    ...reportSellerScopeFields,
    ...reportCurrencyFilterField,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** Seller performance/settlement export filters. Store is omitted because seller identity is the report grain. */
export const sellersReportFilterSchema = z
  .object({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** Inventory/low-stock export filters. Aging is not exposed because the current source schema has no stock-lot age. */
export const inventoryReportFilterSchema = z
  .object({
    ...reportSellerScopeFields,
    lowStockOnly: booleanQuerySchema.optional(),
  })
  .strict();

/** Return/refund export filters. */
export const refundsReportFilterSchema = z
  .object({
    ...reportDateRangeFields,
    ...reportSellerScopeFields,
    ...reportCurrencyFilterField,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** Marketplace commission export filters. */
export const commissionsReportFilterSchema = z
  .object({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** Seller payout/liability export filters. */
export const payoutsReportFilterSchema = z
  .object({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

const normalizedAuditResourceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_TYPE_MAX_LENGTH)
  .regex(new RegExp(DOCUMENT_AUDIT_PATTERN.RESOURCE_TYPE), "Invalid resource type")
  .transform((value) => value.toLowerCase());

/** Audit-log export filters mirror the existing Module 21 audit search surface without pagination. */
export const auditLogReportFilterSchema = z
  .object({
    actorUserId: uuidSchema.optional(),
    action: z
      .string()
      .trim()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.AUDIT_ACTION_MAX_LENGTH)
      .optional(),
    resourceType: normalizedAuditResourceTypeSchema.optional(),
    resourceId: z
      .string()
      .trim()
      .min(1)
      .max(DOCUMENT_AUDIT_LIMITS.RESOURCE_ID_MAX_LENGTH)
      .optional(),
    sellerId: uuidSchema.optional(),
    ...reportDateRangeFields,
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** GET /reports/sales query contract with bounded pagination and an explicit sort allow-list. */
export const salesReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportDateRangeFields,
    ...reportSellerScopeFields,
    ...reportCurrencyFilterField,
    sort: z.enum(REPORTS_SORT.SALES).default("created_desc"),
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** GET /reports/sellers query contract. */
export const sellersReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
    sort: z.enum(REPORTS_SORT.SELLERS).default("gmv_desc"),
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** GET /reports/inventory query contract. */
export const inventoryReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportSellerScopeFields,
    lowStockOnly: booleanQuerySchema.optional(),
    sort: z.enum(REPORTS_SORT.INVENTORY).default("available_asc"),
  })
  .strict();

/** GET /reports/refunds query contract. */
export const refundsReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportDateRangeFields,
    ...reportSellerScopeFields,
    ...reportCurrencyFilterField,
    sort: z.enum(REPORTS_SORT.REFUNDS).default("created_desc"),
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** GET /reports/commissions query contract. */
export const commissionsReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
    sort: z.enum(REPORTS_SORT.COMMISSIONS).default("occurred_desc"),
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** GET /reports/payouts query contract. */
export const payoutsReportQuerySchema = paginationQuerySchema
  .extend({
    ...reportDateRangeFields,
    sellerId: uuidSchema.optional(),
    ...reportCurrencyFilterField,
    sort: z.enum(REPORTS_SORT.PAYOUTS).default("requested_desc"),
  })
  .strict()
  .refine(isValidReportDateRange, { message: REPORT_DATE_RANGE_MESSAGE, path: ["from"] });

/** One catalog entry after the service has filtered definitions by actor permission. */
export const reportDefinitionResponseSchema = z
  .object({
    code: reportCodeSchema,
    domain: z.string().trim().min(1).max(REPORTS_LIMITS.DOMAIN_MAX_LENGTH),
    requiredPermissions: z.array(z.string().trim().min(1)).min(1),
    outputFormats: z.array(reportOutputFormatSchema).min(1),
    status: reportDefinitionStatusSchema,
  })
  .strict();

/** Permission-filtered report catalog. */
export const reportsCatalogResponseSchema = z.array(reportDefinitionResponseSchema);

/** Currency-specific non-negative amount for GMV, captured value, refunds and paid Payout totals. */
export const reportCurrencyAmountSchema = z
  .object({
    currency: reportCurrencySchema,
    amount: reportMoneySchema,
  })
  .strict();

/** Currency-specific signed amount for net Commission revenue and point-in-time seller payable. */
export const reportSignedCurrencyAmountSchema = z
  .object({
    currency: reportCurrencySchema,
    amount: reportSignedMoneySchema,
  })
  .strict();

/** One paged sales report row at Seller Order grain so seller scope is explicit. */
export const salesReportRowSchema = z
  .object({
    orderId: uuidSchema,
    orderNo: z.string().trim().min(1),
    sellerOrderId: uuidSchema,
    sellerOrderNo: z.string().trim().min(1),
    sellerId: uuidSchema,
    storeId: uuidSchema,
    orderStatus: z.enum(ORDER_STATUS_VALUES),
    sellerOrderStatus: z.enum(SELLER_ORDER_STATUS_VALUES),
    currency: reportCurrencySchema,
    grandTotal: reportMoneySchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Sales summary keeps GMV, captured cash, and refunds as separate financial concepts. */
export const salesReportSummarySchema = z
  .object({
    orderCount: z.number().int().nonnegative(),
    sellerOrderCount: z.number().int().nonnegative(),
    gmvByCurrency: z.array(reportCurrencyAmountSchema),
    capturedCashByCurrency: z.array(reportCurrencyAmountSchema),
    refundsByCurrency: z.array(reportCurrencyAmountSchema),
  })
  .strict();

/** GET /reports/sales data payload. */
export const salesReportResponseSchema = z
  .object({
    summary: salesReportSummarySchema,
    rows: z.array(salesReportRowSchema),
  })
  .strict();

/** One seller-performance row; every financial concept remains separately labeled. */
export const sellerPerformanceRowSchema = z
  .object({
    sellerId: uuidSchema,
    sellerName: z.string().trim().min(1),
    orderCount: z.number().int().nonnegative(),
    currency: reportCurrencySchema,
    gmv: reportMoneySchema,
    commissionRevenue: reportSignedMoneySchema,
    sellerPayable: reportSignedMoneySchema,
    refunds: reportMoneySchema,
    payouts: reportMoneySchema,
  })
  .strict();

/** GET /reports/sellers data payload. */
export const sellersReportResponseSchema = z
  .object({
    rows: z.array(sellerPerformanceRowSchema),
  })
  .strict();

/** One inventory/low-stock row derived from current Inventory source state. */
export const inventoryReportRowSchema = z
  .object({
    inventoryItemId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    variantId: uuidSchema,
    sku: z.string().trim().min(1),
    onHandQty: z.number().int().nonnegative(),
    reservedQty: z.number().int().nonnegative(),
    availableQty: z.number().int().nonnegative(),
    reorderLevel: z.number().int().nonnegative().nullable(),
    lowStock: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** GET /reports/inventory data payload. */
export const inventoryReportResponseSchema = z
  .object({
    rows: z.array(inventoryReportRowSchema),
  })
  .strict();

/** One Return/refund row. Provider secrets and raw processor payloads are deliberately absent. */
export const refundReportRowSchema = z
  .object({
    refundId: uuidSchema,
    returnRequestId: uuidSchema.nullable(),
    orderId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    status: z.enum([RETURN_REFUND_STATUS.PENDING, RETURN_REFUND_STATUS.COMPLETED]),
    currency: reportCurrencySchema,
    amount: reportMoneySchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** GET /reports/refunds data payload. */
export const refundsReportResponseSchema = z
  .object({
    rows: z.array(refundReportRowSchema),
    refundedByCurrency: z.array(reportCurrencyAmountSchema),
  })
  .strict();

/** One immutable Commission-ledger reporting row. */
export const commissionReportRowSchema = z
  .object({
    commissionEntryId: uuidSchema,
    sellerId: uuidSchema,
    sellerOrderId: uuidSchema,
    orderItemId: uuidSchema,
    entryType: z.enum(COMMISSION_ENTRY_TYPE_VALUES),
    currency: reportCurrencySchema,
    grossAmount: reportSignedMoneySchema,
    commissionAmount: reportSignedMoneySchema,
    sellerNetAmount: reportSignedMoneySchema,
    occurredAt: isoDateTimeSchema,
  })
  .strict();

/** GET /reports/commissions data payload. */
export const commissionsReportResponseSchema = z
  .object({
    rows: z.array(commissionReportRowSchema),
    marketplaceCommissionRevenueByCurrency: z.array(reportSignedCurrencyAmountSchema),
  })
  .strict();

/** One payout reporting row with no provider account secret or token value. */
export const payoutReportRowSchema = z
  .object({
    payoutId: uuidSchema,
    payoutNo: z.string().trim().min(1),
    sellerId: uuidSchema,
    status: z.enum(PAYOUT_STATUS_VALUES),
    currency: reportCurrencySchema,
    amount: reportMoneySchema,
    requestedAt: isoDateTimeSchema,
    processedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

/** GET /reports/payouts data payload. */
export const payoutsReportResponseSchema = z
  .object({
    rows: z.array(payoutReportRowSchema),
    sellerPayableByCurrency: z.array(reportSignedCurrencyAmountSchema),
    paidOutByCurrency: z.array(reportCurrencyAmountSchema),
  })
  .strict();

/** Bounded requester-owned export-history query. */
export const reportRunListQuerySchema = paginationQuerySchema.strict();

/** Path parameter for reading one asynchronous report run. */
export const reportRunIdParamsSchema = z.object({ id: uuidSchema }).strict();

/** POST /reports/runs body validates filters according to the selected report definition. */
export const createReportRunBodySchema = z.discriminatedUnion("reportCode", [
  z
    .object({
      reportCode: z.literal(REPORT_CODE.SALES),
      filters: salesReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.SELLERS),
      filters: sellersReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.INVENTORY),
      filters: inventoryReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.REFUNDS),
      filters: refundsReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.COMMISSIONS),
      filters: commissionsReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.PAYOUTS),
      filters: payoutsReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
  z
    .object({
      reportCode: z.literal(REPORT_CODE.AUDIT_LOG),
      filters: auditLogReportFilterSchema.default({}),
      outputFormat: reportOutputFormatSchema,
    })
    .strict(),
]);

/** Short-lived authorized download metadata returned only after a completed export run. */
export const reportRunDownloadSchema = z
  .object({
    fileId: uuidSchema,
    downloadUrl: z.url(),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

/** Asynchronous export status response. Actor ownership/scope is enforced in the service before this is returned. */
export const reportRunResponseSchema = z
  .object({
    id: uuidSchema,
    reportCode: reportCodeSchema,
    filters: z.record(z.string(), z.unknown()),
    outputFormat: reportOutputFormatSchema,
    status: reportRunStatusSchema,
    errorCode: z.string().trim().min(1).max(REPORTS_LIMITS.ERROR_CODE_MAX_LENGTH).nullable(),
    createdAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    download: reportRunDownloadSchema.nullable(),
  })
  .strict();

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type SellersReportQuery = z.infer<typeof sellersReportQuerySchema>;
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;
export type RefundsReportQuery = z.infer<typeof refundsReportQuerySchema>;
export type CommissionsReportQuery = z.infer<typeof commissionsReportQuerySchema>;
export type PayoutsReportQuery = z.infer<typeof payoutsReportQuerySchema>;
export type ReportRunListQuery = z.infer<typeof reportRunListQuerySchema>;
export type CreateReportRunBody = z.infer<typeof createReportRunBodySchema>;
export type ReportDefinitionResponse = z.infer<typeof reportDefinitionResponseSchema>;
export type SalesReportResponse = z.infer<typeof salesReportResponseSchema>;
export type SellersReportResponse = z.infer<typeof sellersReportResponseSchema>;
export type InventoryReportResponse = z.infer<typeof inventoryReportResponseSchema>;
export type RefundsReportResponse = z.infer<typeof refundsReportResponseSchema>;
export type CommissionsReportResponse = z.infer<typeof commissionsReportResponseSchema>;
export type PayoutsReportResponse = z.infer<typeof payoutsReportResponseSchema>;
export type ReportRunResponse = z.infer<typeof reportRunResponseSchema>;

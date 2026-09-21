import { z } from "zod";
import { COMMISSION_ENTRY_TYPE } from "@/features/commissions/commissions.constants";
import { ORDER_STATUS, SELLER_ORDER_STATUS } from "@/features/orders/orders.constants";
import { PAYOUT_STATUS_VALUES } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import {
  REPORT_CODE_VALUES,
  REPORT_OUTPUT_FORMAT_VALUES,
  REPORT_RUN_STATUS_VALUES,
} from "../reports.constants";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();
const moneySchema = z.string().regex(/^\d+(?:\.\d+)?$/, "Invalid money value.");
const signedMoneySchema = z.string().regex(/^-?\d+(?:\.\d+)?$/, "Invalid money value.");
const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/);
const optionalUuidText = z
  .string()
  .trim()
  .refine((value) => value === "" || z.string().uuid().safeParse(value).success, "Enter a valid UUID.");
const optionalCurrencyText = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => value === "" || /^[A-Z]{3}$/.test(value), "Use a three-letter currency code.");

/** Client form contract shared by the six interactive report filter panels. */
export const reportFilterFormSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    sellerId: optionalUuidText,
    storeId: optionalUuidText,
    currency: optionalCurrencyText,
    lowStockOnly: z.enum(["", "true", "false"]),
    sort: z.string().trim().min(1),
  })
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to),
    { message: "From must be earlier than or equal to To.", path: ["from"] },
  );

/** Stable catalog entry returned after backend permission filtering. */
export const reportDefinitionSchema = z.object({
  code: z.enum(REPORT_CODE_VALUES),
  domain: z.string().trim().min(1),
  requiredPermissions: z.array(z.string().trim().min(1)).min(1),
  outputFormats: z.array(z.enum(REPORT_OUTPUT_FORMAT_VALUES)).min(1),
  status: z.enum(["active", "inactive"]),
}).strict();

/** Exact money summary grouped by currency. */
export const reportCurrencyAmountSchema = z.object({
  currency: currencySchema,
  amount: moneySchema,
}).strict();

/** Signed exact money summary grouped by currency. */
export const reportSignedCurrencyAmountSchema = z.object({
  currency: currencySchema,
  amount: signedMoneySchema,
}).strict();

/** One seller-order-grain Sales report row. */
export const salesReportRowSchema = z.object({
  orderId: uuidSchema,
  orderNo: z.string().min(1),
  sellerOrderId: uuidSchema,
  sellerOrderNo: z.string().min(1),
  sellerId: uuidSchema,
  storeId: uuidSchema,
  orderStatus: z.enum(ORDER_STATUS),
  sellerOrderStatus: z.enum(SELLER_ORDER_STATUS),
  currency: currencySchema,
  grandTotal: moneySchema,
  createdAt: isoDateTimeSchema,
}).strict();

/** Sales report payload keeps GMV, captured cash, and refunds separate. */
export const salesReportResponseSchema = z.object({
  summary: z.object({
    orderCount: z.number().int().nonnegative(),
    sellerOrderCount: z.number().int().nonnegative(),
    gmvByCurrency: z.array(reportCurrencyAmountSchema),
    capturedCashByCurrency: z.array(reportCurrencyAmountSchema),
    refundsByCurrency: z.array(reportCurrencyAmountSchema),
  }).strict(),
  rows: z.array(salesReportRowSchema),
}).strict();

/** One Seller performance row with each financial concept labeled separately. */
export const sellerPerformanceRowSchema = z.object({
  sellerId: uuidSchema,
  sellerName: z.string().trim().min(1),
  orderCount: z.number().int().nonnegative(),
  currency: currencySchema,
  gmv: moneySchema,
  commissionRevenue: signedMoneySchema,
  sellerPayable: signedMoneySchema,
  refunds: moneySchema,
  payouts: moneySchema,
}).strict();

/** Seller performance report payload. */
export const sellersReportResponseSchema = z.object({
  rows: z.array(sellerPerformanceRowSchema),
}).strict();

/** One current Inventory report row. */
export const inventoryReportRowSchema = z.object({
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
}).strict();

/** Inventory report payload. */
export const inventoryReportResponseSchema = z.object({
  rows: z.array(inventoryReportRowSchema),
}).strict();

/** One finalized Refund reporting row. */
export const refundReportRowSchema = z.object({
  refundId: uuidSchema,
  returnRequestId: uuidSchema.nullable(),
  orderId: uuidSchema,
  sellerId: uuidSchema,
  storeId: uuidSchema,
  status: z.enum(["pending", "completed"]),
  currency: currencySchema,
  amount: moneySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

/** Refund report payload. */
export const refundsReportResponseSchema = z.object({
  rows: z.array(refundReportRowSchema),
  refundedByCurrency: z.array(reportCurrencyAmountSchema),
}).strict();

/** One immutable Commission reporting row. */
export const commissionReportRowSchema = z.object({
  commissionEntryId: uuidSchema,
  sellerId: uuidSchema,
  sellerOrderId: uuidSchema,
  orderItemId: uuidSchema,
  entryType: z.enum([
    COMMISSION_ENTRY_TYPE.SALE,
    COMMISSION_ENTRY_TYPE.REFUND,
    COMMISSION_ENTRY_TYPE.ADJUSTMENT,
  ]),
  currency: currencySchema,
  grossAmount: signedMoneySchema,
  commissionAmount: signedMoneySchema,
  sellerNetAmount: signedMoneySchema,
  occurredAt: isoDateTimeSchema,
}).strict();

/** Commission report payload. */
export const commissionsReportResponseSchema = z.object({
  rows: z.array(commissionReportRowSchema),
  marketplaceCommissionRevenueByCurrency: z.array(reportSignedCurrencyAmountSchema),
}).strict();

/** One privacy-safe Payout reporting row. */
export const payoutReportRowSchema = z.object({
  payoutId: uuidSchema,
  payoutNo: z.string().trim().min(1),
  sellerId: uuidSchema,
  status: z.enum(PAYOUT_STATUS_VALUES),
  currency: currencySchema,
  amount: moneySchema,
  requestedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
}).strict();

/** Payout/liability report payload. */
export const payoutsReportResponseSchema = z.object({
  rows: z.array(payoutReportRowSchema),
  sellerPayableByCurrency: z.array(reportSignedCurrencyAmountSchema),
  paidOutByCurrency: z.array(reportCurrencyAmountSchema),
}).strict();

/** Asynchronous report-run response and optional signed download metadata. */
export const reportRunSchema = z.object({
  id: uuidSchema,
  reportCode: z.enum(REPORT_CODE_VALUES),
  filters: z.record(z.string(), z.unknown()),
  outputFormat: z.enum(REPORT_OUTPUT_FORMAT_VALUES),
  status: z.enum(REPORT_RUN_STATUS_VALUES),
  errorCode: z.string().trim().min(1).nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  download: z.object({
    fileId: uuidSchema,
    downloadUrl: z.string().url(),
    expiresAt: isoDateTimeSchema,
  }).strict().nullable(),
}).strict();

/** Minimal browser-local reference to a requester-owned export run. */
export const reportRunHistoryEntrySchema = reportRunSchema.pick({
  id: true,
  reportCode: true,
  outputFormat: true,
  createdAt: true,
});

/** Export command payload shape; report-specific filters are selected by UI helpers before submission. */
export const reportExportCommandSchema = z.object({
  reportCode: z.enum(REPORT_CODE_VALUES),
  filters: z.record(z.string(), z.unknown()),
  outputFormat: z.enum(REPORT_OUTPUT_FORMAT_VALUES),
}).strict();

/** Browser-local saved filter preset with no server authority. */
export const reportFilterPresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  reportCode: z.enum(REPORT_CODE_VALUES),
  filters: z.record(z.string(), z.unknown()),
}).strict();

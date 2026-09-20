import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  decimalStringSchema,
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import { ORDER_STATUS_VALUES } from "../orders/orders.constants.js";
import {
  DASHBOARD_DATE_RANGE_VALUES,
  DASHBOARD_LIMITS,
  DASHBOARD_SELLER_SORT,
  DASHBOARD_WIDGET_VALUES,
} from "./dashboard.constants.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns true when an optional Dashboard date window is ordered and inside the safety limit. */
function isValidDashboardDateRange(value: {
  from?: string | undefined;
  to?: string | undefined;
}): boolean {
  if (!value.from || !value.to) return true;
  const fromTime = new Date(value.from).getTime();
  const toTime = new Date(value.to).getTime();
  if (fromTime > toTime) return false;
  return toTime - fromTime <= DASHBOARD_LIMITS.MAX_DATE_RANGE_DAYS * MILLISECONDS_PER_DAY;
}

/** Returns true when a preference PATCH contains at least one field to change. */
function hasPreferenceUpdate(value: Record<string, unknown>): boolean {
  return Object.values(value).some((fieldValue) => fieldValue !== undefined);
}

/** Returns true when a Dashboard layout contains each allow-listed widget at most once. */
function hasUniqueWidgetCodes(value: { widgets: Array<{ widgetCode: string }> }): boolean {
  const widgetCodes = value.widgets.map((widget) => widget.widgetCode);
  return new Set(widgetCodes).size === widgetCodes.length;
}

const DASHBOARD_DATE_RANGE_MESSAGE =
  `from/to must be ordered and no more than ${DASHBOARD_LIMITS.MAX_DATE_RANGE_DAYS} days apart`;

const dashboardFilterFields = {
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  sellerId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
};

/** ISO-4217-shaped currency code used only to label exact monetary Dashboard values. */
export const dashboardCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(DASHBOARD_LIMITS.CURRENCY_LENGTH)
  .regex(/^[A-Z]{3}$/u, "Invalid currency code");

/** Exact non-negative money transport; authoritative NUMERIC values never become JS floats. */
export const dashboardMoneySchema = nonNegativeDecimalStringSchema;

/** Exact signed money transport for liabilities and adjustment-aware finance values. */
export const dashboardSignedMoneySchema = decimalStringSchema;

/** Allow-listed Dashboard widget code stored in layout preferences. */
export const dashboardWidgetCodeSchema = z.enum(DASHBOARD_WIDGET_VALUES);

/** Default date preset stored with one authenticated user's Dashboard preferences. */
export const dashboardDateRangePresetSchema = z.enum(DASHBOARD_DATE_RANGE_VALUES);

/** Shared Dashboard read filters. Seller/store scope is still revalidated by the service. */
export const dashboardFilterSchema = z
  .object(dashboardFilterFields)
  .strict()
  .refine(isValidDashboardDateRange, {
    message: DASHBOARD_DATE_RANGE_MESSAGE,
    path: ["from"],
  });

/** GET /dashboard/summary query contract. */
export const dashboardSummaryQuerySchema = z
  .object(dashboardFilterFields)
  .strict()
  .refine(isValidDashboardDateRange, {
    message: DASHBOARD_DATE_RANGE_MESSAGE,
    path: ["from"],
  });

/** GET /dashboard/orders query contract for status and GMV trend reads. */
export const dashboardOrdersQuerySchema = z
  .object(dashboardFilterFields)
  .strict()
  .refine(isValidDashboardDateRange, {
    message: DASHBOARD_DATE_RANGE_MESSAGE,
    path: ["from"],
  });

/** GET /dashboard/sellers query contract with bounded pagination and an explicit sort allow-list. */
export const dashboardSellersQuerySchema = paginationQuerySchema
  .extend({
    ...dashboardFilterFields,
    sort: z.enum(DASHBOARD_SELLER_SORT).default("gmv_desc"),
  })
  .strict()
  .refine(isValidDashboardDateRange, {
    message: DASHBOARD_DATE_RANGE_MESSAGE,
    path: ["from"],
  });

/** GET /dashboard/alerts query contract with bounded pagination. */
export const dashboardAlertsQuerySchema = paginationQuerySchema
  .extend(dashboardFilterFields)
  .strict()
  .refine(isValidDashboardDateRange, {
    message: DASHBOARD_DATE_RANGE_MESSAGE,
    path: ["from"],
  });

/** One allow-listed widget placement stored inside the Dashboard layout JSON object. */
export const dashboardWidgetLayoutSchema = z
  .object({
    widgetCode: dashboardWidgetCodeSchema,
    order: z.number().int().min(0),
    visible: z.boolean(),
  })
  .strict();

/** Persisted Dashboard layout contract. Unknown layout keys are rejected. */
export const dashboardLayoutSchema = z
  .object({
    widgets: z.array(dashboardWidgetLayoutSchema).max(DASHBOARD_LIMITS.MAX_WIDGETS),
  })
  .strict()
  .refine(hasUniqueWidgetCodes, {
    message: "Dashboard layout cannot contain the same widget more than once",
    path: ["widgets"],
  });

/** One named user-owned saved filter stored by the existing Dashboard preferences command. */
export const dashboardSavedFilterInputSchema = z
  .object({
    name: z.string().trim().min(1).max(DASHBOARD_LIMITS.SAVED_FILTER_NAME_MAX_LENGTH),
    filters: dashboardFilterSchema,
  })
  .strict();

/** PATCH /dashboard/preferences body; the single documented command owns layout/defaults/saved filter preferences. */
export const updateDashboardPreferencesBodySchema = z
  .object({
    layout: dashboardLayoutSchema.optional(),
    defaultDateRange: dashboardDateRangePresetSchema.optional(),
    defaultStoreId: uuidSchema.nullable().optional(),
    savedFilters: z
      .array(dashboardSavedFilterInputSchema)
      .max(DASHBOARD_LIMITS.MAX_SAVED_FILTERS)
      .optional(),
  })
  .strict()
  .refine(hasPreferenceUpdate, {
    message: "At least one Dashboard preference field must be provided",
  });

/** Currency-specific non-negative amount shown by Dashboard read models. */
export const dashboardCurrencyAmountSchema = z
  .object({
    currency: dashboardCurrencySchema,
    amount: dashboardMoneySchema,
  })
  .strict();

/** Currency-specific signed amount used for liabilities and adjustment-aware summaries. */
export const dashboardSignedCurrencyAmountSchema = z
  .object({
    currency: dashboardCurrencySchema,
    amount: dashboardSignedMoneySchema,
  })
  .strict();

/** One persisted saved filter returned with Dashboard preferences. */
export const dashboardSavedFilterResponseSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(1).max(DASHBOARD_LIMITS.SAVED_FILTER_NAME_MAX_LENGTH),
    filters: dashboardFilterSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Persisted Dashboard preference snapshot returned by summary and preference updates. */
export const dashboardPreferencesResponseSchema = z
  .object({
    id: uuidSchema.nullable(),
    layout: dashboardLayoutSchema,
    defaultDateRange: dashboardDateRangePresetSchema,
    defaultStoreId: uuidSchema.nullable(),
    savedFilters: z.array(dashboardSavedFilterResponseSchema),
    updatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

/** Effective filter scope echoed by Dashboard responses for clear UI/debug behavior. */
export const dashboardResolvedScopeSchema = z
  .object({
    sellerId: uuidSchema.nullable(),
    storeId: uuidSchema.nullable(),
    categoryId: uuidSchema.nullable(),
    from: isoDateTimeSchema.nullable(),
    to: isoDateTimeSchema.nullable(),
  })
  .strict();

/** Finance-sensitive KPI group; services return null when the actor cannot read finance widgets. */
export const dashboardFinanceSummarySchema = z
  .object({
    capturedCashByCurrency: z.array(dashboardCurrencyAmountSchema),
    refundedPaymentsByCurrency: z.array(dashboardCurrencyAmountSchema),
    marketplaceCommissionRevenueByCurrency: z.array(dashboardSignedCurrencyAmountSchema),
    sellerPayableByCurrency: z.array(dashboardSignedCurrencyAmountSchema),
    sellerPayoutsPaidByCurrency: z.array(dashboardCurrencyAmountSchema),
  })
  .strict();

/** GET /dashboard/summary payload with finance values separated from ordinary operational KPIs. */
export const dashboardSummaryResponseSchema = z
  .object({
    scope: dashboardResolvedScopeSchema,
    orderCount: z.number().int().nonnegative(),
    lowStockVariantCount: z.number().int().nonnegative(),
    openReturnCount: z.number().int().nonnegative(),
    gmvByCurrency: z.array(dashboardCurrencyAmountSchema),
    finance: dashboardFinanceSummarySchema.nullable(),
    preferences: dashboardPreferencesResponseSchema,
  })
  .strict();

/** One time bucket in the Dashboard Orders/GMV trend. */
export const dashboardOrderTrendPointSchema = z
  .object({
    bucketStart: isoDateTimeSchema,
    currency: dashboardCurrencySchema,
    orderCount: z.number().int().nonnegative(),
    gmv: dashboardMoneySchema,
  })
  .strict();

/** GET /dashboard/orders payload with state counts kept separate from the GMV trend. */
export const dashboardOrdersResponseSchema = z
  .object({
    scope: dashboardResolvedScopeSchema,
    statusCounts: z.array(
      z
        .object({
          status: z.enum(ORDER_STATUS_VALUES),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    trend: z.array(dashboardOrderTrendPointSchema),
  })
  .strict();

/** Finance-sensitive seller figures are nullable so ordinary operational readers are not shown fake zeroes. */
export const dashboardSellerFinanceSchema = z
  .object({
    commissionRevenue: dashboardSignedMoneySchema,
    sellerPayable: dashboardSignedMoneySchema,
    refunds: dashboardMoneySchema,
    payouts: dashboardMoneySchema,
  })
  .strict();

/** One seller-performance row consumed by the Dashboard seller table. */
export const dashboardSellerPerformanceRowSchema = z
  .object({
    sellerId: uuidSchema,
    sellerName: z.string().trim().min(1),
    orderCount: z.number().int().nonnegative(),
    currency: dashboardCurrencySchema,
    gmv: dashboardMoneySchema,
    finance: dashboardSellerFinanceSchema.nullable(),
  })
  .strict();

/** GET /dashboard/sellers data payload; pagination metadata remains in the standard API envelope. */
export const dashboardSellersResponseSchema = z
  .object({
    scope: dashboardResolvedScopeSchema,
    rows: z.array(dashboardSellerPerformanceRowSchema),
  })
  .strict();

/** Operational alert categories shown by the Dashboard without taking ownership of source state. */
export const dashboardAlertTypeSchema = z.enum([
  "low_stock",
  "fulfillment_attention",
  "return_attention",
  "payout_attention",
]);

/** One source-owned operational alert projected for Dashboard display. */
export const dashboardAlertSchema = z
  .object({
    type: dashboardAlertTypeSchema,
    sellerId: uuidSchema.nullable(),
    storeId: uuidSchema.nullable(),
    resourceId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

/** GET /dashboard/alerts data payload; the Dashboard only surfaces source-owned alerts. */
export const dashboardAlertsResponseSchema = z
  .object({
    scope: dashboardResolvedScopeSchema,
    rows: z.array(dashboardAlertSchema),
  })
  .strict();

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
export type DashboardOrdersQuery = z.infer<typeof dashboardOrdersQuerySchema>;
export type DashboardSellersQuery = z.infer<typeof dashboardSellersQuerySchema>;
export type DashboardAlertsQuery = z.infer<typeof dashboardAlertsQuerySchema>;
export type UpdateDashboardPreferencesBody = z.infer<typeof updateDashboardPreferencesBodySchema>;
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
export type DashboardOrdersResponse = z.infer<typeof dashboardOrdersResponseSchema>;
export type DashboardSellersResponse = z.infer<typeof dashboardSellersResponseSchema>;
export type DashboardAlertsResponse = z.infer<typeof dashboardAlertsResponseSchema>;
export type DashboardPreferencesResponse = z.infer<typeof dashboardPreferencesResponseSchema>;

import { z } from "zod";
import { ORDER_STATUS } from "@/features/orders/orders.constants";
import {
  DASHBOARD_DATE_RANGE_VALUES,
  DASHBOARD_SELLER_SORT_VALUES,
  DASHBOARD_WIDGET_VALUES,
} from "../dashboard.constants";

const MAX_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/u);
const moneySchema = z.string().regex(/^\d+(?:\.\d+)?$/u, "Invalid money value.");
const signedMoneySchema = z.string().regex(/^-?\d+(?:\.\d+)?$/u, "Invalid money value.");
const optionalUuidText = z
  .string()
  .trim()
  .refine((value) => value === "" || uuidSchema.safeParse(value).success, "Enter a valid UUID.");

/** Returns true when a browser-entered date range is ordered and within the backend safety limit. */
function validDateRange(value: { from: string; to: string }): boolean {
  if (!value.from || !value.to) return true;
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  return Number.isFinite(from) && Number.isFinite(to) && from <= to && to - from <= MAX_DATE_RANGE_MS;
}

/** Shared TanStack Form contract for Dashboard read filters. */
export const dashboardFilterFormSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    sellerId: optionalUuidText,
    storeId: optionalUuidText,
    categoryId: optionalUuidText,
  })
  .refine(validDateRange, {
    message: "Use an ordered date range no longer than 366 days.",
    path: ["from"],
  });

/** One exact currency amount returned by Dashboard read models. */
export const dashboardCurrencyAmountSchema = z.object({
  currency: currencySchema,
  amount: moneySchema,
}).strict();

/** One exact signed currency amount returned by finance-sensitive Dashboard read models. */
export const dashboardSignedCurrencyAmountSchema = z.object({
  currency: currencySchema,
  amount: signedMoneySchema,
}).strict();

/** One persisted Dashboard widget placement. */
export const dashboardWidgetLayoutSchema = z.object({
  widgetCode: z.enum(DASHBOARD_WIDGET_VALUES),
  order: z.number().int().nonnegative(),
  visible: z.boolean(),
}).strict();

/** Dashboard layout returned by the server and written through preferences. */
export const dashboardLayoutSchema = z.object({
  widgets: z.array(dashboardWidgetLayoutSchema).max(DASHBOARD_WIDGET_VALUES.length),
}).strict();

/** Shared validated API filter shape stored in user-owned saved filters. */
export const dashboardFilterSchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  sellerId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
}).strict();

/** One persisted user-owned saved filter. */
export const dashboardSavedFilterSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(160),
  filters: dashboardFilterSchema,
  createdAt: isoDateTimeSchema,
}).strict();

/** Effective user preferences returned with the Dashboard summary. */
export const dashboardPreferencesSchema = z.object({
  id: uuidSchema.nullable(),
  layout: dashboardLayoutSchema,
  defaultDateRange: z.enum(DASHBOARD_DATE_RANGE_VALUES),
  defaultStoreId: uuidSchema.nullable(),
  savedFilters: z.array(dashboardSavedFilterSchema),
  updatedAt: isoDateTimeSchema.nullable(),
}).strict();

/** Effective server-resolved scope echoed by Dashboard reads. */
export const dashboardScopeSchema = z.object({
  sellerId: uuidSchema.nullable(),
  storeId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  from: isoDateTimeSchema.nullable(),
  to: isoDateTimeSchema.nullable(),
}).strict();

/** Finance-sensitive KPI values remain separate instead of being combined into marketplace revenue. */
export const dashboardFinanceSummarySchema = z.object({
  capturedCashByCurrency: z.array(dashboardCurrencyAmountSchema),
  refundedPaymentsByCurrency: z.array(dashboardCurrencyAmountSchema),
  marketplaceCommissionRevenueByCurrency: z.array(dashboardSignedCurrencyAmountSchema),
  sellerPayableByCurrency: z.array(dashboardSignedCurrencyAmountSchema),
  sellerPayoutsPaidByCurrency: z.array(dashboardCurrencyAmountSchema),
}).strict();

/** GET /dashboard/summary response contract. */
export const dashboardSummarySchema = z.object({
  scope: dashboardScopeSchema,
  orderCount: z.number().int().nonnegative(),
  lowStockVariantCount: z.number().int().nonnegative(),
  openReturnCount: z.number().int().nonnegative(),
  gmvByCurrency: z.array(dashboardCurrencyAmountSchema),
  finance: dashboardFinanceSummarySchema.nullable(),
  preferences: dashboardPreferencesSchema,
}).strict();

/** GET /dashboard/orders response contract. */
export const dashboardOrdersSchema = z.object({
  scope: dashboardScopeSchema,
  statusCounts: z.array(z.object({
    status: z.enum(ORDER_STATUS),
    count: z.number().int().nonnegative(),
  }).strict()),
  trend: z.array(z.object({
    bucketStart: isoDateTimeSchema,
    currency: currencySchema,
    orderCount: z.number().int().nonnegative(),
    gmv: moneySchema,
  }).strict()),
}).strict();

/** GET /dashboard/sellers response contract. */
export const dashboardSellersSchema = z.object({
  scope: dashboardScopeSchema,
  rows: z.array(z.object({
    sellerId: uuidSchema,
    sellerName: z.string().trim().min(1),
    orderCount: z.number().int().nonnegative(),
    currency: currencySchema,
    gmv: moneySchema,
    finance: z.object({
      commissionRevenue: signedMoneySchema,
      sellerPayable: signedMoneySchema,
      refunds: moneySchema,
      payouts: moneySchema,
    }).strict().nullable(),
  }).strict()),
}).strict();

/** GET /dashboard/alerts response contract. */
export const dashboardAlertsSchema = z.object({
  scope: dashboardScopeSchema,
  rows: z.array(z.object({
    type: z.enum(["low_stock", "fulfillment_attention", "return_attention", "payout_attention"]),
    sellerId: uuidSchema.nullable(),
    storeId: uuidSchema.nullable(),
    resourceId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    occurredAt: isoDateTimeSchema,
  }).strict()),
}).strict();

/** Preference form contract for default scope and widget visibility. */
export const dashboardPreferencesFormSchema = z.object({
  defaultDateRange: z.enum(DASHBOARD_DATE_RANGE_VALUES),
  defaultStoreId: optionalUuidText,
  visibleWidgets: z.array(z.enum(DASHBOARD_WIDGET_VALUES)).min(1, "Keep at least one Dashboard widget visible."),
});

/** Saved-filter name form contract. */
export const dashboardSavedFilterFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a filter name.").max(160),
});

/** PATCH /dashboard/preferences body contract used to validate mutation payloads. */
export const updateDashboardPreferencesSchema = z.object({
  layout: dashboardLayoutSchema.optional(),
  defaultDateRange: z.enum(DASHBOARD_DATE_RANGE_VALUES).optional(),
  defaultStoreId: uuidSchema.nullable().optional(),
  savedFilters: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    filters: dashboardFilterSchema,
  }).strict()).max(25).optional(),
}).strict();

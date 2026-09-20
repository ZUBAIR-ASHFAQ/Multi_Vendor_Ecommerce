import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  COMMISSION_ENTRY_SORT_VALUES,
  COMMISSION_ENTRY_TYPE_VALUES,
  COMMISSION_RULE_SCOPE_TYPE,
  COMMISSION_RULE_SCOPE_TYPE_VALUES,
  COMMISSION_RULE_SORT_VALUES,
  COMMISSION_RULE_STATUS_VALUES,
  COMMISSION_SORT_DIRECTION_VALUES,
  COMMISSIONS_LIMITS,
} from "./commissions.constants.js";

/** Creates one trimmed non-empty string bounded by the persisted/API maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Returns true when one canonical decimal fits the requested PostgreSQL NUMERIC precision/scale. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0"] = unsigned.split(".");
  return integerPart.length <= precision - scale;
}

/** Compares two non-negative canonical decimal strings without IEEE-754 conversion. */
function compareNonNegativeDecimals(left: string, right: string): number {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const leftNormalized = `${leftWhole}${leftFraction.padEnd(fractionLength, "0")}`;
  const rightNormalized = `${rightWhole}${rightFraction.padEnd(fractionLength, "0")}`;
  const leftValue = BigInt(leftNormalized);
  const rightValue = BigInt(rightNormalized);
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

/** Exact signed scale-4 Commission money transported as a string to preserve database precision. */
export const commissionMoneySchema = z
  .string()
  .trim()
  .regex(/^-?(?:0|[1-9]\d*)\.\d{4}$/, "Commission money must use canonical scale-4 decimal format.")
  .refine(
    (value) =>
      decimalFitsNumeric(
        value,
        COMMISSIONS_LIMITS.MONEY_PRECISION,
        COMMISSIONS_LIMITS.MONEY_SCALE,
      ),
    `Commission money must fit NUMERIC(${COMMISSIONS_LIMITS.MONEY_PRECISION},${COMMISSIONS_LIMITS.MONEY_SCALE}) without rounding.`,
  );

/** Exact non-negative scale-4 money used by Commission rules and statement totals. */
export const nonNegativeCommissionMoneySchema = commissionMoneySchema.refine(
  (value) => !value.startsWith("-"),
  "Commission money must be non-negative.",
);

/** Exact non-negative percentage matching NUMERIC(9,6), bounded to the natural 0..100 percent range. */
export const commissionRatePercentSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)\.\d{6}$/, "Commission rate must use canonical scale-6 decimal format.")
  .refine(
    (value) =>
      decimalFitsNumeric(
        value,
        COMMISSIONS_LIMITS.RATE_PRECISION,
        COMMISSIONS_LIMITS.RATE_SCALE,
      ),
    `Commission rate must fit NUMERIC(${COMMISSIONS_LIMITS.RATE_PRECISION},${COMMISSIONS_LIMITS.RATE_SCALE}) without rounding.`,
  )
  .refine(
    (value) => compareNonNegativeDecimals(value, "100.000000") <= 0,
    "Commission rate must not exceed 100 percent.",
  );

/** ISO-4217-shaped currency code; supported-currency membership remains an authoritative service rule. */
export const commissionCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code.");

/** Rule scope kinds explicitly frozen by the controlling Module 16 guide. */
export const commissionRuleScopeTypeSchema = z.enum(COMMISSION_RULE_SCOPE_TYPE_VALUES);

/** Append-only Commission entry kinds explicitly frozen by the controlling guide. */
export const commissionEntryTypeSchema = z.enum(COMMISSION_ENTRY_TYPE_VALUES);

/** Commission rule lifecycle states frozen by Requirements Patch 0007. */
export const commissionRuleStatusSchema = z.enum(COMMISSION_RULE_STATUS_VALUES);

/** Shared UUID path parameter for the admin Commission-rule update route. */
export const commissionRuleIdParamsSchema = z.object({ id: uuidSchema }).strict();

/** Shared scope shape used by create/update contracts while preserving default-vs-target identity. */
const commissionRuleScopeShape = {
  scopeType: commissionRuleScopeTypeSchema,
  scopeId: uuidSchema.nullable().optional(),
} as const;

/** Validates the database-backed relationship between a rule scope type and its optional target UUID. */
function validateRuleScope(
  value: {
    scopeType?: string | undefined;
    scopeId?: string | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (!value.scopeType) return;

  if (value.scopeType === COMMISSION_RULE_SCOPE_TYPE.DEFAULT) {
    if (value.scopeId !== null && value.scopeId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["scopeId"],
        message: "Default Commission rules must not specify scopeId.",
      });
    }
    return;
  }

  if (!value.scopeId) {
    context.addIssue({
      code: "custom",
      path: ["scopeId"],
      message: `${value.scopeType} Commission rules require scopeId.`,
    });
  }
}

/** Validates one optional effective-date range without deciding rule precedence or winner semantics. */
function validateDateRange(
  value: {
    startAt?: string | undefined;
    endAt?: string | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (!value.startAt || !value.endAt) return;
  if (new Date(value.endAt).getTime() <= new Date(value.startAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["endAt"],
      message: "endAt must be after startAt.",
    });
  }
}

/**
 * Core create/update APIs may only omit fundingRulesJson or explicitly clear it with null.
 * Non-null historical values remain readable for backward compatibility but have no arithmetic effect.
 */
export const commissionFundingRulesInputSchema = z.null();

/** Historical funding metadata may still be returned by read APIs for backward compatibility. */
export const commissionFundingRulesResponseSchema = z.unknown().nullable();

/** Strict admin create-rule contract using the frozen status and core funding-metadata rules. */
export const createCommissionRuleBodySchema = z
  .object({
    priority: z.number().int().min(-2_147_483_648).max(2_147_483_647),
    ...commissionRuleScopeShape,
    ratePercent: commissionRatePercentSchema,
    fixedFee: nonNegativeCommissionMoneySchema.nullable().optional(),
    fundingRulesJson: commissionFundingRulesInputSchema.optional(),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema.nullable().optional(),
    status: commissionRuleStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateRuleScope(value, context);
    validateDateRange(value, context);
  });

/** Strict future-effective rule update contract; service code still enforces historical mutability rules. */
export const updateCommissionRuleBodySchema = z
  .object({
    priority: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
    scopeType: commissionRuleScopeTypeSchema.optional(),
    scopeId: uuidSchema.nullable().optional(),
    ratePercent: commissionRatePercentSchema.optional(),
    fixedFee: nonNegativeCommissionMoneySchema.nullable().optional(),
    fundingRulesJson: commissionFundingRulesInputSchema.optional(),
    startAt: isoDateTimeSchema.optional(),
    endAt: isoDateTimeSchema.nullable().optional(),
    status: commissionRuleStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "At least one Commission rule field is required." });
    }
    validateRuleScope(value, context);
    validateDateRange(value, context);
  });

/** Allow-listed finance rule-list query using only approved Commission rule statuses. */
export const adminCommissionRuleListQuerySchema = paginationQuerySchema
  .extend({
    scopeType: commissionRuleScopeTypeSchema.optional(),
    scopeId: uuidSchema.optional(),
    status: commissionRuleStatusSchema.optional(),
    effectiveAt: isoDateTimeSchema.optional(),
    sort: z.enum(COMMISSION_RULE_SORT_VALUES).default("createdAt"),
    order: z.enum(COMMISSION_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Safe Commission-rule response shared by admin list/create/update contracts. */
export const commissionRuleResponseSchema = z
  .object({
    id: uuidSchema,
    priority: z.number().int(),
    scopeType: commissionRuleScopeTypeSchema,
    scopeId: uuidSchema.nullable(),
    ratePercent: commissionRatePercentSchema,
    fixedFee: nonNegativeCommissionMoneySchema.nullable(),
    fundingRulesJson: commissionFundingRulesResponseSchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema.nullable(),
    status: commissionRuleStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe immutable Commission ledger entry used by seller/admin reads. */
export const commissionEntryResponseSchema = z
  .object({
    id: uuidSchema,
    sellerId: uuidSchema,
    sellerOrderId: uuidSchema,
    orderItemId: uuidSchema,
    type: commissionEntryTypeSchema,
    grossAmount: commissionMoneySchema,
    commissionAmount: commissionMoneySchema,
    sellerNetAmount: commissionMoneySchema,
    currency: commissionCurrencySchema,
    occurredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Seller-owned statement filters. Seller identity is intentionally absent and must come from auth scope. */
export const sellerCommissionStatementQuerySchema = paginationQuerySchema
  .extend({
    type: commissionEntryTypeSchema.optional(),
    sellerOrderId: uuidSchema.optional(),
    occurredFrom: isoDateTimeSchema.optional(),
    occurredTo: isoDateTimeSchema.optional(),
    sort: z.enum(COMMISSION_ENTRY_SORT_VALUES).default("occurredAt"),
    order: z.enum(COMMISSION_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.occurredFrom &&
      value.occurredTo &&
      new Date(value.occurredFrom).getTime() > new Date(value.occurredTo).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["occurredTo"],
        message: "occurredTo must be on or after occurredFrom.",
      });
    }
  });

/** Finance ledger filters. Admin-only seller filtering is explicit and cannot leak into seller-owned reads. */
export const adminCommissionEntryListQuerySchema = paginationQuerySchema
  .extend({
    sellerId: uuidSchema.optional(),
    sellerOrderId: uuidSchema.optional(),
    orderItemId: uuidSchema.optional(),
    type: commissionEntryTypeSchema.optional(),
    currency: commissionCurrencySchema.optional(),
    occurredFrom: isoDateTimeSchema.optional(),
    occurredTo: isoDateTimeSchema.optional(),
    sort: z.enum(COMMISSION_ENTRY_SORT_VALUES).default("occurredAt"),
    order: z.enum(COMMISSION_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.occurredFrom &&
      value.occurredTo &&
      new Date(value.occurredFrom).getTime() > new Date(value.occurredTo).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["occurredTo"],
        message: "occurredTo must be on or after occurredFrom.",
      });
    }
  });

/** Seller statement totals are grouped by one currency so unrelated currencies are never added together. */
export const sellerCommissionStatementSummarySchema = z
  .object({
    currency: commissionCurrencySchema,
    grossAmount: commissionMoneySchema,
    sellerFundedDiscountAmount: commissionMoneySchema,
    commissionAmount: commissionMoneySchema,
    refundAdjustmentAmount: commissionMoneySchema,
    sellerNetAmount: commissionMoneySchema,
  })
  .strict();

/** Seller-safe statement response with exact totals plus the immutable entries that explain them. */
export const sellerCommissionStatementResponseSchema = z
  .object({
    sellerId: uuidSchema,
    summaries: z.array(sellerCommissionStatementSummarySchema),
    entries: z.array(commissionEntryResponseSchema),
  })
  .strict();

/** Trusted idempotent Order-settlement command. All authoritative financial values are derived server-side. */
export const internalCommissionOrderSettleBodySchema = z
  .object({
    sourceKey: nonBlankString(COMMISSIONS_LIMITS.SOURCE_KEY_MAX_LENGTH),
    orderId: uuidSchema,
  })
  .strict();

/** Trusted refund-adjustment command referencing the original Order and provider-authoritative refund transaction. */
export const internalCommissionRefundAdjustBodySchema = z
  .object({
    sourceKey: nonBlankString(COMMISSIONS_LIMITS.SOURCE_KEY_MAX_LENGTH),
    orderId: uuidSchema,
    refundPaymentTransactionId: uuidSchema,
  })
  .strict();

/** One trusted item allocation supplied by Module 14 after provider refund success. */
export const internalCommissionPartialRefundItemSchema = z
  .object({
    orderItemId: uuidSchema,
    currentRefundQuantity: z.number().int().positive(),
    cumulativeRefundQuantity: z.number().int().positive(),
    currentRefundAmount: nonNegativeCommissionMoneySchema.refine(
      (value) => value !== "0.0000",
      "Current refund amount must be positive.",
    ),
  })
  .strict()
  .refine(
    (value) => value.cumulativeRefundQuantity >= value.currentRefundQuantity,
    { message: "Cumulative refund quantity cannot be below the current refund quantity." },
  );

/** Trusted partial-refund adjustment command with authoritative item allocation from Module 14. */
export const internalCommissionPartialRefundAdjustBodySchema = z
  .object({
    sourceKey: nonBlankString(COMMISSIONS_LIMITS.SOURCE_KEY_MAX_LENGTH),
    orderId: uuidSchema,
    refundPaymentTransactionId: uuidSchema,
    items: z.array(internalCommissionPartialRefundItemSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.orderItemId)).size === value.items.length,
    { message: "Each Order Item may appear only once in one partial Commission adjustment." },
  );

/** Safe result returned by idempotent Order settlement without exposing internal rule-selection machinery. */
export const commissionOrderSettleResultSchema = z
  .object({
    orderId: uuidSchema,
    entryIds: z.array(uuidSchema),
  })
  .strict();

/** Safe result returned by one idempotent refund Commission adjustment. */
export const commissionRefundAdjustResultSchema = z
  .object({
    orderId: uuidSchema,
    refundPaymentTransactionId: uuidSchema,
    entryIds: z.array(uuidSchema),
  })
  .strict();

export type CommissionRuleScopeType = z.infer<typeof commissionRuleScopeTypeSchema>;
export type CommissionRuleStatus = z.infer<typeof commissionRuleStatusSchema>;
export type CommissionEntryType = z.infer<typeof commissionEntryTypeSchema>;
export type CreateCommissionRuleInput = z.infer<typeof createCommissionRuleBodySchema>;
export type UpdateCommissionRuleInput = z.infer<typeof updateCommissionRuleBodySchema>;
export type AdminCommissionRuleListQuery = z.infer<typeof adminCommissionRuleListQuerySchema>;
export type CommissionRuleResponse = z.infer<typeof commissionRuleResponseSchema>;
export type CommissionEntryResponse = z.infer<typeof commissionEntryResponseSchema>;
export type SellerCommissionStatementQuery = z.infer<typeof sellerCommissionStatementQuerySchema>;
export type AdminCommissionEntryListQuery = z.infer<typeof adminCommissionEntryListQuerySchema>;
export type SellerCommissionStatementResponse = z.infer<
  typeof sellerCommissionStatementResponseSchema
>;
export type InternalCommissionOrderSettleInput = z.infer<
  typeof internalCommissionOrderSettleBodySchema
>;
export type InternalCommissionRefundAdjustInput = z.infer<
  typeof internalCommissionRefundAdjustBodySchema
>;
export type InternalCommissionPartialRefundAdjustInput = z.infer<
  typeof internalCommissionPartialRefundAdjustBodySchema
>;
export type CommissionOrderSettleResult = z.infer<typeof commissionOrderSettleResultSchema>;
export type CommissionRefundAdjustResult = z.infer<typeof commissionRefundAdjustResultSchema>;

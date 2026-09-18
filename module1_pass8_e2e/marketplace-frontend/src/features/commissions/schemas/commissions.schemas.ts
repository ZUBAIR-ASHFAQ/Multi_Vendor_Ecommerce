import { z } from "zod";
import {
  COMMISSION_ENTRY_TYPE,
  COMMISSION_RULE_SCOPE,
  COMMISSION_RULE_STATUS_VALUES,
} from "../commissions.constants";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const signedMoney = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{4}$/);
const nonNegativeMoney = z.string().regex(/^(?:0|[1-9]\d*)\.\d{4}$/);
const ratePercent = z.string().regex(/^(?:0|[1-9]\d*)\.\d{6}$/);

/** Rule scope values accepted by the Commission HTTP contract. */
export const commissionRuleScopeSchema = z.enum([
  COMMISSION_RULE_SCOPE.DEFAULT,
  COMMISSION_RULE_SCOPE.SELLER,
  COMMISSION_RULE_SCOPE.CATEGORY,
  COMMISSION_RULE_SCOPE.PRODUCT,
]);

/** Rule lifecycle values accepted by the Commission HTTP contract. */
export const commissionRuleStatusSchema = z.enum(COMMISSION_RULE_STATUS_VALUES);

/** Immutable Commission entry kinds returned by seller/admin ledger APIs. */
export const commissionEntryTypeSchema = z.enum([
  COMMISSION_ENTRY_TYPE.SALE,
  COMMISSION_ENTRY_TYPE.REFUND,
  COMMISSION_ENTRY_TYPE.ADJUSTMENT,
]);

/** Safe Commission rule returned by admin list/create/update endpoints. */
export const commissionRuleSchema = z.object({
  id: uuid,
  priority: z.number().int(),
  scopeType: commissionRuleScopeSchema,
  scopeId: uuid.nullable(),
  ratePercent,
  fixedFee: nonNegativeMoney.nullable(),
  fundingRulesJson: z.unknown().nullable(),
  startAt: isoDateTime,
  endAt: isoDateTime.nullable(),
  status: commissionRuleStatusSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Safe immutable Commission ledger row returned to seller/admin readers. */
export const commissionEntrySchema = z.object({
  id: uuid,
  sellerId: uuid,
  sellerOrderId: uuid,
  orderItemId: uuid,
  type: commissionEntryTypeSchema,
  grossAmount: signedMoney,
  commissionAmount: signedMoney,
  sellerNetAmount: signedMoney,
  currency,
  occurredAt: isoDateTime,
  createdAt: isoDateTime,
});

/** One currency-separated seller statement summary. */
export const sellerCommissionSummarySchema = z.object({
  currency,
  grossAmount: signedMoney,
  sellerFundedDiscountAmount: signedMoney,
  commissionAmount: signedMoney,
  refundAdjustmentAmount: signedMoney,
  sellerNetAmount: signedMoney,
});

/** Seller statement response whose seller identity is supplied by the backend actor scope. */
export const sellerCommissionStatementSchema = z.object({
  sellerId: uuid,
  summaries: z.array(sellerCommissionSummarySchema),
  entries: z.array(commissionEntrySchema),
});

/** TanStack Form values for creating/updating a future-effective Commission rule. */
export const commissionRuleFormSchema = z
  .object({
    priority: z.number().int(),
    scopeType: commissionRuleScopeSchema,
    scopeId: z.string().trim(),
    ratePercent: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d*)\.\d{6}$/, "Rate must use six decimal places, for example 10.000000.")
      .refine(
        (value) => !/^(?:0|[1-9]\d*)\.\d{6}$/.test(value) || BigInt(value.replace(".", "")) <= 100_000_000n,
        "Rate must not exceed 100 percent.",
      ),
    fixedFee: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || /^(?:0|[1-9]\d*)\.\d{4}$/.test(value),
        "Fixed fee must use four decimal places, for example 1.5000.",
      ),
    startAt: z.string().min(1, "Start time is required."),
    endAt: z.string(),
    status: commissionRuleStatusSchema,
  })
  .superRefine((value, context) => {
    if (value.scopeType === COMMISSION_RULE_SCOPE.DEFAULT && value.scopeId !== "") {
      context.addIssue({ code: "custom", path: ["scopeId"], message: "Default rules cannot have a scope ID." });
    }
    if (value.scopeType !== COMMISSION_RULE_SCOPE.DEFAULT && !z.string().uuid().safeParse(value.scopeId).success) {
      context.addIssue({ code: "custom", path: ["scopeId"], message: "This scope requires a valid UUID." });
    }
    if (value.endAt && new Date(value.endAt).getTime() <= new Date(value.startAt).getTime()) {
      context.addIssue({ code: "custom", path: ["endAt"], message: "End time must be after start time." });
    }
  });

/** Validates the real filters available on the Commission rule manager. */
export const commissionRuleFilterSchema = z.object({
  scopeType: commissionRuleScopeSchema.or(z.literal("")),
  status: commissionRuleStatusSchema.or(z.literal("")),
});

/** Validates seller statement filters without ever accepting a seller ID from the browser. */
export const sellerCommissionFilterSchema = z
  .object({
    type: commissionEntryTypeSchema.or(z.literal("")),
    sellerOrderId: z
      .string()
      .trim()
      .refine((value) => value === "" || z.string().uuid().safeParse(value).success, "Seller Order ID must be a UUID."),
  });

/** Validates finance ledger filters exposed by the documented admin API. */
export const adminCommissionEntryFilterSchema = z.object({
  sellerId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || z.string().uuid().safeParse(value).success,
      "Seller ID must be a UUID.",
    ),
  sellerOrderId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || z.string().uuid().safeParse(value).success,
      "Seller Order ID must be a UUID.",
    ),
  type: commissionEntryTypeSchema.or(z.literal("")),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || /^[A-Z]{3}$/.test(value),
      "Currency must use three uppercase letters.",
    ),
});

export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export type CommissionEntry = z.infer<typeof commissionEntrySchema>;
export type SellerCommissionSummary = z.infer<typeof sellerCommissionSummarySchema>;
export type SellerCommissionStatement = z.infer<typeof sellerCommissionStatementSchema>;
export type CommissionRuleFormValues = z.infer<typeof commissionRuleFormSchema>;
export type CommissionRuleScope = z.infer<typeof commissionRuleScopeSchema>;
export type CommissionRuleStatus = z.infer<typeof commissionRuleStatusSchema>;
export type CommissionEntryType = z.infer<typeof commissionEntryTypeSchema>;

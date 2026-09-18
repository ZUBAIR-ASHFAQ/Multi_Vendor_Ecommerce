import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  RETURN_ITEM_CONDITION_VALUES,
  RETURN_ITEM_RESOLUTION_VALUES,
  RETURN_LIST_SORT_VALUES,
  RETURN_REASON_CODE_VALUES,
  RETURN_REQUEST_STATUS_VALUES,
  RETURN_SORT_DIRECTION_VALUES,
  RETURNS_LIMITS,
  RETURNS_PATTERN,
} from "./returns-refunds.constants.js";

/** Creates one trimmed non-empty string with an explicit API safety limit. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Returns true when canonical scale-4 money fits PostgreSQL NUMERIC(18,4). */
function returnMoneyFitsNumeric(value: string): boolean {
  const [integerPart = "0"] = value.split(".");
  return integerPart.length <= RETURNS_LIMITS.MONEY_PRECISION - RETURNS_LIMITS.MONEY_SCALE;
}

/** Validates an optional from/to date range without adding report/business semantics. */
function validateDateRange(
  value: {
    requestedFrom?: string | undefined;
    requestedTo?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (!value.requestedFrom || !value.requestedTo) return;
  if (new Date(value.requestedFrom).getTime() > new Date(value.requestedTo).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["requestedTo"],
      message: "requestedTo must be on or after requestedFrom.",
    });
  }
}

/** Core Return Request lifecycle values. */
export const returnRequestStatusSchema = z.enum(RETURN_REQUEST_STATUS_VALUES);

/** Customer-selectable Return reason code. */
export const returnReasonCodeSchema = z.enum(RETURN_REASON_CODE_VALUES);

/** Seller/support physical inspection condition. */
export const returnItemConditionSchema = z.enum(RETURN_ITEM_CONDITION_VALUES);

/** Approved item-level refund/restock resolution. */
export const returnItemResolutionSchema = z.enum(RETURN_ITEM_RESOLUTION_VALUES);

/** Exact non-negative scale-4 money used by Return response/read contracts. */
export const returnMoneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)\.\d{4}$/, "Return money must use canonical scale-4 decimal format.")
  .refine(
    returnMoneyFitsNumeric,
    `Return money must fit NUMERIC(${RETURNS_LIMITS.MONEY_PRECISION},${RETURNS_LIMITS.MONEY_SCALE}) without rounding.`,
  );

/** Normalized three-letter Return/refund currency code. */
export const returnCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(RETURNS_LIMITS.CURRENCY_LENGTH)
  .regex(RETURNS_PATTERN.CURRENCY, "Currency must be a normalized three-letter code.");

/** Shared parent-Order path parameter for customer Return creation. */
export const returnOrderIdParamsSchema = z
  .object({
    orderId: uuidSchema,
  })
  .strict();

/** Shared Return Request path parameter for seller/refund commands. */
export const returnRequestIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** One requested Order Item quantity. Server code resolves ownership, delivery, pricing, and seller scope. */
export const createReturnItemInputSchema = z
  .object({
    orderItemId: uuidSchema,
    quantity: z.number().int().positive(),
  })
  .strict();

/** Strict customer command for POST /api/v1/orders/:orderId/returns. */
export const createReturnRequestBodySchema = z
  .object({
    sellerOrderId: uuidSchema,
    reasonCode: returnReasonCodeSchema,
    items: z
      .array(createReturnItemInputSchema)
      .min(1)
      .max(RETURNS_LIMITS.ITEMS_PER_REQUEST_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.orderItemId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "orderItemId"],
          message: "Each Order Item may appear only once in one Return Request.",
        });
      }
      seen.add(item.orderItemId);
    });
  });

/** Customer-owned Return list filters; customer identity is always derived from auth context. */
export const customerReturnListQuerySchema = paginationQuerySchema
  .extend({
    status: returnRequestStatusSchema.optional(),
    orderId: uuidSchema.optional(),
    requestedFrom: isoDateTimeSchema.optional(),
    requestedTo: isoDateTimeSchema.optional(),
    sort: z.enum(RETURN_LIST_SORT_VALUES).default("requestedAt"),
    order: z.enum(RETURN_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Seller-scoped Return queue filters; seller identity is intentionally absent from browser input. */
export const sellerReturnListQuerySchema = paginationQuerySchema
  .extend({
    status: returnRequestStatusSchema.optional(),
    orderId: uuidSchema.optional(),
    sellerOrderId: uuidSchema.optional(),
    requestedFrom: isoDateTimeSchema.optional(),
    requestedTo: isoDateTimeSchema.optional(),
    sort: z.enum(RETURN_LIST_SORT_VALUES).default("requestedAt"),
    order: z.enum(RETURN_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Platform support Return-search filters; selected seller scope is still policy-checked server-side. */
export const adminReturnListQuerySchema = paginationQuerySchema
  .extend({
    status: returnRequestStatusSchema.optional(),
    customerUserId: uuidSchema.optional(),
    sellerId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    sellerOrderId: uuidSchema.optional(),
    requestedFrom: isoDateTimeSchema.optional(),
    requestedTo: isoDateTimeSchema.optional(),
    sort: z.enum(RETURN_LIST_SORT_VALUES).default("requestedAt"),
    order: z.enum(RETURN_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine(validateDateRange);

/** Approve is an explicit command and accepts only an optional bounded support note. */
export const approveReturnBodySchema = z
  .object({
    note: nonBlankString(RETURNS_LIMITS.TRANSITION_REASON_MAX_LENGTH).optional(),
  })
  .strict();

/** Rejection always records an explicit human-readable reason for audit/support history. */
export const rejectReturnBodySchema = z
  .object({
    reason: nonBlankString(RETURNS_LIMITS.TRANSITION_REASON_MAX_LENGTH),
  })
  .strict();

/** One seller/support inspection decision for an already-approved Return Item. */
export const receiveReturnItemInputSchema = z
  .object({
    returnItemId: uuidSchema,
    itemCondition: returnItemConditionSchema,
    resolution: returnItemResolutionSchema,
  })
  .strict();

/** Receive/inspection command; restock quantity and refund money remain server-derived. */
export const receiveReturnBodySchema = z
  .object({
    items: z
      .array(receiveReturnItemInputSchema)
      .min(1)
      .max(RETURNS_LIMITS.ITEMS_PER_REQUEST_MAX),
    note: nonBlankString(RETURNS_LIMITS.TRANSITION_REASON_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.returnItemId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "returnItemId"],
          message: "Each Return Item may appear only once in one receive command.",
        });
      }
      seen.add(item.returnItemId);
    });
  });

/** Provider-refund command body intentionally excludes amount, currency, payment ID, and seller ownership. */
export const issueReturnRefundBodySchema = z
  .object({
    note: nonBlankString(RETURNS_LIMITS.TRANSITION_REASON_MAX_LENGTH).optional(),
  })
  .strict();

/** Required Foundation Idempotency-Key header for the provider refund command. */
export const returnRefundIdempotencyHeadersSchema = z.object({
  "idempotency-key": nonBlankString(RETURNS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH),
});

/** Safe persisted Return Item representation used by later list/command responses. */
export const returnItemResponseSchema = z
  .object({
    id: uuidSchema,
    orderItemId: uuidSchema,
    quantity: z.number().int().positive(),
    itemCondition: returnItemConditionSchema.nullable(),
    resolution: returnItemResolutionSchema.nullable(),
    refundAmount: returnMoneySchema,
    restockQty: z.number().int().nonnegative(),
  })
  .strict();

/** Append-only lifecycle history representation for timeline composition on existing Return reads. */
export const returnStatusHistoryResponseSchema = z
  .object({
    id: uuidSchema,
    fromStatus: returnRequestStatusSchema.nullable(),
    toStatus: returnRequestStatusSchema,
    changedBy: uuidSchema.nullable(),
    reason: nonBlankString(RETURNS_LIMITS.TRANSITION_REASON_MAX_LENGTH).nullable(),
    changedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe Return Request representation shared by later customer/seller/admin HTTP responses. */
export const returnRequestResponseSchema = z
  .object({
    id: uuidSchema,
    returnNo: nonBlankString(RETURNS_LIMITS.RETURN_NUMBER_MAX_LENGTH),
    orderId: uuidSchema,
    sellerOrderId: uuidSchema,
    customerUserId: uuidSchema,
    status: returnRequestStatusSchema,
    reasonCode: returnReasonCodeSchema,
    requestedAt: isoDateTimeSchema,
    approvedAt: isoDateTimeSchema.nullable(),
    items: z.array(returnItemResponseSchema),
    history: z.array(returnStatusHistoryResponseSchema).optional(),
  })
  .strict();

/** Minimal refund result returned after provider-authoritative orchestration completes or is safely replayed. */
export const returnRefundResultSchema = z
  .object({
    refundId: uuidSchema,
    returnRequestId: uuidSchema,
    orderId: uuidSchema,
    paymentId: uuidSchema,
    amount: returnMoneySchema,
    currency: returnCurrencySchema,
    providerRef: nonBlankString(RETURNS_LIMITS.PROVIDER_REF_MAX_LENGTH).nullable(),
  })
  .strict();

export type ReturnRequestStatus = z.infer<typeof returnRequestStatusSchema>;
export type ReturnReasonCode = z.infer<typeof returnReasonCodeSchema>;
export type ReturnItemCondition = z.infer<typeof returnItemConditionSchema>;
export type ReturnItemResolution = z.infer<typeof returnItemResolutionSchema>;
export type CreateReturnRequestInput = z.infer<typeof createReturnRequestBodySchema>;
export type CustomerReturnListQuery = z.infer<typeof customerReturnListQuerySchema>;
export type SellerReturnListQuery = z.infer<typeof sellerReturnListQuerySchema>;
export type AdminReturnListQuery = z.infer<typeof adminReturnListQuerySchema>;
export type ApproveReturnInput = z.infer<typeof approveReturnBodySchema>;
export type RejectReturnInput = z.infer<typeof rejectReturnBodySchema>;
export type ReceiveReturnInput = z.infer<typeof receiveReturnBodySchema>;
export type IssueReturnRefundInput = z.infer<typeof issueReturnRefundBodySchema>;
export type ReturnRequestResponse = z.infer<typeof returnRequestResponseSchema>;
export type ReturnStatusHistoryResponse = z.infer<typeof returnStatusHistoryResponseSchema>;
export type ReturnRefundResult = z.infer<typeof returnRefundResultSchema>;

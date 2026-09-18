import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  PAYMENT_LIST_SORT_VALUES,
  PAYMENT_PROVIDER_VALUES,
  PAYMENT_REFUND_REASON_VALUES,
  PAYMENT_SORT_DIRECTION_VALUES,
  PAYMENT_STATUS_VALUES,
  PAYMENT_TRANSACTION_STATUS_VALUES,
  PAYMENT_TRANSACTION_TYPE_VALUES,
  PAYMENTS_LIMITS,
} from "./payments.constants.js";

/** Creates one trimmed non-empty string bounded by the persisted/API maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Returns true when canonical scale-4 money fits PostgreSQL NUMERIC(18,4). */
function paymentMoneyFitsNumeric(value: string): boolean {
  const [integerPart = "0"] = value.split(".");
  return integerPart.length <= PAYMENTS_LIMITS.MONEY_PRECISION - PAYMENTS_LIMITS.MONEY_SCALE;
}

/** Exact non-negative scale-4 Payment money transported as a decimal string. */
export const paymentMoneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)\.\d{4}$/, "Payment money must use canonical scale-4 decimal format.")
  .refine(
    paymentMoneyFitsNumeric,
    `Payment money must fit NUMERIC(${PAYMENTS_LIMITS.MONEY_PRECISION},${PAYMENTS_LIMITS.MONEY_SCALE}) without rounding.`,
  );

/** Exact positive scale-4 money used by the trusted provider refund command. */
export const positivePaymentMoneySchema = paymentMoneySchema.refine(
  (value) => value !== "0.0000",
  "Refund amount must be greater than zero.",
);

/** ISO-4217-shaped Payment currency code; provider/support membership remains a service rule. */
export const paymentCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code.");

/** Provider-neutral Payment aggregate lifecycle state. */
export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);

/** Core provider identifier frozen to Stripe for the first release. */
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDER_VALUES);

/** Append-only Payment transaction category. */
export const paymentTransactionTypeSchema = z.enum(PAYMENT_TRANSACTION_TYPE_VALUES);

/** Append-only Payment transaction result state. */
export const paymentTransactionStatusSchema = z.enum(PAYMENT_TRANSACTION_STATUS_VALUES);

/** Shared Order path parameter for customer Payment operations. */
export const paymentOrderIdParamsSchema = z
  .object({
    orderId: uuidSchema,
  })
  .strict();

/** Shared Payment path parameter for admin detail and trusted internal refund operations. */
export const paymentIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Strict empty intent body: all amount/currency/ownership fields are server-derived. */
export const createPaymentIntentBodySchema = z.object({}).strict();

/** Required customer intent idempotency header parsed from Express's normalized lowercase names. */
export const paymentIntentHeadersSchema = z.object({
  "idempotency-key": nonBlankString(PAYMENTS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH),
});

/** Required raw Stripe signature header; cryptographic verification belongs to the provider adapter. */
export const stripeWebhookHeadersSchema = z.object({
  "stripe-signature": nonBlankString(PAYMENTS_LIMITS.WEBHOOK_SIGNATURE_MAX_LENGTH),
});

/** Exact non-empty raw Stripe webhook bytes captured before normal JSON parsing. */
export const stripeWebhookRawBodySchema = z
  .instanceof(Buffer)
  .refine((value) => value.length > 0, "Stripe webhook body is required.");

/** Safe result returned only by create/get PaymentIntent while customer completion may still be required. */
export const paymentIntentResponseSchema = z
  .object({
    paymentId: uuidSchema,
    orderId: uuidSchema,
    provider: paymentProviderSchema,
    providerPaymentId: nonBlankString(PAYMENTS_LIMITS.PROVIDER_ID_MAX_LENGTH),
    status: paymentStatusSchema,
    currency: paymentCurrencySchema,
    amount: paymentMoneySchema,
    paymentExpiresAt: isoDateTimeSchema,
    clientSecret: z.string().min(1).nullable(),
  })
  .strict();

/** Customer-safe provider-authoritative Payment status response; client secrets are intentionally absent. */
export const customerPaymentStatusSchema = z
  .object({
    paymentId: uuidSchema,
    orderId: uuidSchema,
    provider: paymentProviderSchema,
    status: paymentStatusSchema,
    currency: paymentCurrencySchema,
    amountAuthorized: paymentMoneySchema,
    amountCaptured: paymentMoneySchema,
    amountRefunded: paymentMoneySchema,
    refundableAmount: paymentMoneySchema,
    providerPaymentId: nonBlankString(PAYMENTS_LIMITS.PROVIDER_ID_MAX_LENGTH).nullable(),
    paymentExpiresAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Allow-listed finance Payment search filters from approved Patch 0006. */
export const adminPaymentListQuerySchema = paginationQuerySchema
  .extend({
    status: paymentStatusSchema.optional(),
    provider: paymentProviderSchema.optional(),
    orderId: uuidSchema.optional(),
    providerPaymentId: nonBlankString(PAYMENTS_LIMITS.PROVIDER_ID_MAX_LENGTH).optional(),
    currency: paymentCurrencySchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    sort: z.enum(PAYMENT_LIST_SORT_VALUES).default("createdAt"),
    order: z.enum(PAYMENT_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      new Date(value.createdFrom).getTime() > new Date(value.createdTo).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["createdTo"],
        message: "createdTo must be on or after createdFrom.",
      });
    }
  });

/** Safe finance Payment list item without browser secrets or raw idempotency/provider credentials. */
export const adminPaymentListItemSchema = customerPaymentStatusSchema.omit({
  paymentExpiresAt: true,
});

/** Safe append-only Payment transaction exposed to authorized finance detail/timeline reads. */
export const paymentTransactionResponseSchema = z
  .object({
    id: uuidSchema,
    type: paymentTransactionTypeSchema,
    providerTxnId: nonBlankString(PAYMENTS_LIMITS.PROVIDER_ID_MAX_LENGTH).nullable(),
    amount: paymentMoneySchema,
    status: paymentTransactionStatusSchema,
    occurredAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Safe finance Payment detail with ordered transaction history. */
export const adminPaymentDetailSchema = adminPaymentListItemSchema.extend({
  transactions: z.array(paymentTransactionResponseSchema),
});

/** Strict trusted internal refund command frozen by approved Patch 0006. */
export const internalRefundBodySchema = z
  .object({
    sourceKey: nonBlankString(PAYMENTS_LIMITS.SOURCE_KEY_MAX_LENGTH),
    amount: positivePaymentMoneySchema,
    providerReason: z.enum(PAYMENT_REFUND_REASON_VALUES).optional(),
    note: nonBlankString(PAYMENTS_LIMITS.AUDIT_NOTE_MAX_LENGTH).optional(),
    requestedByUserId: uuidSchema.nullable().optional(),
  })
  .strict();

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;
export type PaymentTransactionType = z.infer<typeof paymentTransactionTypeSchema>;
export type PaymentTransactionStatus = z.infer<typeof paymentTransactionStatusSchema>;
export type PaymentIntentResponse = z.infer<typeof paymentIntentResponseSchema>;
export type CustomerPaymentStatus = z.infer<typeof customerPaymentStatusSchema>;
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;
export type AdminPaymentListItem = z.infer<typeof adminPaymentListItemSchema>;
export type AdminPaymentDetail = z.infer<typeof adminPaymentDetailSchema>;
export type InternalRefundInput = z.infer<typeof internalRefundBodySchema>;
export type PaymentTransactionResponse = z.infer<typeof paymentTransactionResponseSchema>;

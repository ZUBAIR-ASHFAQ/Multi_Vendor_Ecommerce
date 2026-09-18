import { z } from "zod";
import { PAYMENT_STATUS } from "../payments.constants";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.string().regex(/^(?:0|[1-9]\d*)\.\d{4}$/);

/** Provider-authoritative Payment status values accepted by the browser. */
export const paymentStatusSchema = z.enum([
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PROCESSING,
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
]);

/** Safe response returned when the customer creates or reuses a PaymentIntent. */
export const paymentIntentSchema = z.object({
  paymentId: uuid,
  orderId: uuid,
  provider: z.literal("stripe"),
  providerPaymentId: z.string().min(1),
  status: paymentStatusSchema,
  currency,
  amount: money,
  paymentExpiresAt: isoDateTime,
  clientSecret: z.string().min(1).nullable(),
});

/** Customer-safe Payment read without Stripe client secrets or backend credentials. */
export const customerPaymentSchema = z.object({
  paymentId: uuid,
  orderId: uuid,
  provider: z.literal("stripe"),
  status: paymentStatusSchema,
  currency,
  amountAuthorized: money,
  amountCaptured: money,
  amountRefunded: money,
  refundableAmount: money,
  providerPaymentId: z.string().min(1).nullable(),
  paymentExpiresAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Finance list row returned by the privileged admin Payment search. */
export const adminPaymentListItemSchema = customerPaymentSchema.omit({
  paymentExpiresAt: true,
});

/** One append-only Payment transaction shown in the finance timeline. */
export const paymentTransactionSchema = z.object({
  id: uuid,
  type: z.enum(["intent", "authorize", "capture", "refund", "failure"]),
  providerTxnId: z.string().min(1).nullable(),
  amount: money,
  status: z.enum(["pending", "succeeded", "failed"]),
  occurredAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Finance Payment detail plus its ordered transaction history. */
export const adminPaymentDetailSchema = adminPaymentListItemSchema.extend({
  transactions: z.array(paymentTransactionSchema),
});

/** Real admin search input validated by TanStack Form before it becomes API query data. */
export const adminPaymentFilterSchema = z.object({
  status: paymentStatusSchema.or(z.literal("")),
  orderId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || z.string().uuid().safeParse(value).success,
      "Order ID must be a UUID.",
    ),
  providerPaymentId: z.string().trim().max(255, "Provider Payment ID is too long."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || /^[A-Z]{3}$/.test(value),
      "Currency must use a three-letter code.",
    ),
});

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;
export type CustomerPayment = z.infer<typeof customerPaymentSchema>;
export type AdminPaymentListItem = z.infer<typeof adminPaymentListItemSchema>;
export type AdminPaymentDetail = z.infer<typeof adminPaymentDetailSchema>;
export type PaymentTransaction = z.infer<typeof paymentTransactionSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

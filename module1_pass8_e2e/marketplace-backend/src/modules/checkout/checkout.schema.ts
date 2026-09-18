import { z } from "zod";
import {
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import { productCurrencySchema } from "../products/products.schema.js";
import { CHECKOUT_LIMITS } from "./checkout.constants.js";

/** Returns true when a canonical decimal string fits one PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsignedValue.split(".");
  return integerPart.length <= precision - scale && fractionPart.length <= scale;
}

/** Exact non-negative NUMERIC(18,4) Checkout money transported as a decimal string. */
export const checkoutMoneySchema = nonNegativeDecimalStringSchema.refine(
  (value) =>
    decimalFitsNumeric(
      value,
      CHECKOUT_LIMITS.MONEY_PRECISION,
      CHECKOUT_LIMITS.MONEY_SCALE,
    ),
  `Checkout money must fit NUMERIC(${CHECKOUT_LIMITS.MONEY_PRECISION},${CHECKOUT_LIMITS.MONEY_SCALE}) without rounding.`,
);

/** ISO-4217-shaped Checkout currency code; supported-currency membership remains a service rule. */
export const checkoutCurrencySchema = productCurrencySchema;

/** Normalized optional coupon code persisted so confirmation can repeat the same Promotion decision. */
export const checkoutCouponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(CHECKOUT_LIMITS.COUPON_CODE_MAX_LENGTH);

/** Lowercase hexadecimal SHA-256 state hash frozen by approved Requirements Patch 0004. */
export const checkoutStateHashSchema = z
  .string()
  .length(CHECKOUT_LIMITS.STATE_HASH_LENGTH)
  .regex(/^[0-9a-f]{64}$/);

/** Persisted Checkout-attempt status identifier; Patch 0004 limits Module 10 writes while later modules may extend integration states. */
export const checkoutAttemptStatusSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHECKOUT_LIMITS.ATTEMPT_STATUS_MAX_LENGTH);

/** Idempotency-key value used by the Patch 0004 required Idempotency-Key confirmation header. */
export const checkoutIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(CHECKOUT_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH);

/** Path parameter for GET/POST /api/v1/checkout/quote/:id operations. */
export const checkoutQuoteIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Path parameter for GET /api/v1/checkout/:attemptId/status. */
export const checkoutAttemptIdParamsSchema = z
  .object({
    attemptId: uuidSchema,
  })
  .strict();

/** One client shipping choice; seller ownership and amount remain server-derived. */
export const checkoutShippingSelectionInputSchema = z
  .object({
    storeId: uuidSchema,
    shippingMethodId: uuidSchema,
  })
  .strict();

/** Strict body for POST /api/v1/checkout/quote from approved Requirements Patch 0004. */
export const createCheckoutQuoteBodySchema = z
  .object({
    shippingAddressId: uuidSchema,
    billingAddressId: uuidSchema.optional(),
    couponCode: checkoutCouponCodeSchema.optional(),
    shippingSelections: z.array(checkoutShippingSelectionInputSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenStoreIds = new Set<string>();
    value.shippingSelections.forEach((selection, index) => {
      if (seenStoreIds.has(selection.storeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["shippingSelections", index, "storeId"],
          message: "Each store may have only one shipping selection.",
        });
      }
      seenStoreIds.add(selection.storeId);
    });
  });

/** Strict body for POST /api/v1/checkout/quote/:id/confirm. */
export const confirmCheckoutQuoteBodySchema = z
  .object({
    stateHash: checkoutStateHashSchema,
  })
  .strict();

/** Required confirmation header contract parsed from Express's normalized lowercase header names. */
export const checkoutConfirmHeadersSchema = z.object({
  "idempotency-key": checkoutIdempotencyKeySchema,
});

/** Stable shipping-method code copied into the short-lived quote for display. */
export const checkoutShippingMethodCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHECKOUT_LIMITS.SHIPPING_METHOD_CODE_MAX_LENGTH);

/** Stable shipping-method display name copied into the short-lived quote for display. */
export const checkoutShippingMethodNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHECKOUT_LIMITS.SHIPPING_METHOD_NAME_MAX_LENGTH);

/** One customer-safe immutable priced line in the persisted quote response. */
export const checkoutQuoteLineContractSchema = z
  .object({
    variantId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    quantity: z.number().int().positive(),
    unitPrice: checkoutMoneySchema,
    discount: checkoutMoneySchema,
    tax: checkoutMoneySchema,
    lineTotal: checkoutMoneySchema,
  })
  .strict();

/** One selected Shipping Core option persisted for one server-derived store group. */
export const checkoutQuoteShippingSelectionContractSchema = z
  .object({
    sellerId: uuidSchema,
    storeId: uuidSchema,
    shippingMethodId: uuidSchema,
    shippingMethodCode: checkoutShippingMethodCodeSchema,
    shippingMethodName: checkoutShippingMethodNameSchema,
    amount: checkoutMoneySchema,
    currency: checkoutCurrencySchema,
  })
  .strict();

/** Customer-safe authoritative quote summary frozen by approved Requirements Patch 0004. */
export const checkoutQuoteContractSchema = z
  .object({
    id: uuidSchema,
    currency: checkoutCurrencySchema,
    shippingAddressId: uuidSchema,
    billingAddressId: uuidSchema,
    couponCode: checkoutCouponCodeSchema.nullable(),
    subtotal: checkoutMoneySchema,
    discountTotal: checkoutMoneySchema,
    taxTotal: checkoutMoneySchema,
    shippingTotal: checkoutMoneySchema,
    grandTotal: checkoutMoneySchema,
    expiresAt: isoDateTimeSchema,
    stateHash: checkoutStateHashSchema,
  })
  .strict();

/** Customer-safe quote snapshot with immutable priced lines and selected Shipping Core methods. */
export const checkoutQuoteWithLinesContractSchema = checkoutQuoteContractSchema.extend({
  lines: z.array(checkoutQuoteLineContractSchema),
  shippingSelections: z.array(checkoutQuoteShippingSelectionContractSchema),
});

/** Customer-owned Checkout-attempt summary; Order/Payment status stays in later modules. */
export const checkoutAttemptContractSchema = z
  .object({
    id: uuidSchema,
    quoteId: uuidSchema,
    orderId: uuidSchema.nullable(),
    status: checkoutAttemptStatusSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export type CheckoutShippingSelectionInput = z.infer<
  typeof checkoutShippingSelectionInputSchema
>;
export type CreateCheckoutQuoteInput = z.infer<typeof createCheckoutQuoteBodySchema>;
export type ConfirmCheckoutQuoteInput = z.infer<typeof confirmCheckoutQuoteBodySchema>;
export type CheckoutQuoteWithLinesContract = z.infer<
  typeof checkoutQuoteWithLinesContractSchema
>;
export type CheckoutAttemptContract = z.infer<typeof checkoutAttemptContractSchema>;

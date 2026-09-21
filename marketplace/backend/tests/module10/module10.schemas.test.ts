import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ERROR_CODE,
  CHECKOUT_OUTBOX_EVENT,
  CHECKOUT_PATH,
  CHECKOUT_PERMISSION,
} from "../../src/modules/checkout/checkout.constants.js";
import {
  checkoutAttemptContractSchema,
  checkoutAttemptIdParamsSchema,
  checkoutConfirmHeadersSchema,
  checkoutIdempotencyKeySchema,
  checkoutMoneySchema,
  checkoutQuoteIdParamsSchema,
  checkoutQuoteWithLinesContractSchema,
  checkoutStateHashSchema,
  createCheckoutQuoteBodySchema,
} from "../../src/modules/checkout/checkout.schema.js";

describe("Module 10 Checkout source-supported contracts", () => {
  it("keeps the approved permissions, errors, events, and four route paths stable", () => {
    expect(CHECKOUT_PERMISSION).toEqual({
      CREATE_OWN: "checkout.create_own",
      CONFIRM_OWN: "checkout.confirm_own",
    });
    expect(Object.values(CHECKOUT_ERROR_CODE)).toEqual([
      "CHECKOUT_QUOTE_EXPIRED",
      "CHECKOUT_PRICE_CHANGED",
      "CHECKOUT_STOCK_CHANGED",
      "CHECKOUT_PROMOTION_CHANGED",
      "CHECKOUT_ADDRESS_INVALID",
      "CHECKOUT_IDEMPOTENCY_CONFLICT",
    ]);
    expect(Object.values(CHECKOUT_OUTBOX_EVENT)).toEqual([
      "checkout.quoted",
      "checkout.confirmed",
      "checkout.expired",
      "checkout.failed",
    ]);
    expect(CHECKOUT_PATH).toEqual({
      CREATE_QUOTE: "/api/v1/checkout/quote",
      READ_QUOTE: "/api/v1/checkout/quote/:id",
      CONFIRM_QUOTE: "/api/v1/checkout/quote/:id/confirm",
      READ_ATTEMPT_STATUS: "/api/v1/checkout/:attemptId/status",
    });
  });

  it("accepts an optional single-item Buy Now intent without changing the four Checkout routes", () => {
    const input = {
      shippingAddressId: randomUUID(),
      shippingSelections: [{ storeId: randomUUID(), shippingMethodId: randomUUID() }],
      buyNowItem: { variantId: randomUUID(), quantity: 2 },
    };
    expect(createCheckoutQuoteBodySchema.parse(input)).toEqual(input);
    expect(() =>
      createCheckoutQuoteBodySchema.parse({
        ...input,
        buyNowItem: { ...input.buyNowItem, quantity: 100 },
      }),
    ).toThrow();
  });

  it("keeps Checkout money exact for the persisted NUMERIC(18,4) boundary", () => {
    expect(checkoutMoneySchema.parse("0")).toBe("0");
    expect(checkoutMoneySchema.parse("12.3400")).toBe("12.3400");
    expect(checkoutMoneySchema.parse("99999999999999.9999")).toBe(
      "99999999999999.9999",
    );

    expect(() => checkoutMoneySchema.parse("-0.0001")).toThrow();
    expect(() => checkoutMoneySchema.parse("1.00001")).toThrow();
    expect(() => checkoutMoneySchema.parse("100000000000000.0000")).toThrow();
    expect(() => checkoutMoneySchema.parse(12.34)).toThrow();
  });

  it("requires the approved lowercase SHA-256 Checkout state hash", () => {
    expect(checkoutStateHashSchema.parse("a".repeat(64))).toBe("a".repeat(64));
    expect(() => checkoutStateHashSchema.parse("A".repeat(64))).toThrow();
    expect(() => checkoutStateHashSchema.parse("a".repeat(63))).toThrow();
    expect(() => checkoutStateHashSchema.parse("g".repeat(64))).toThrow();
  });

  it("keeps quote and attempt identifiers strict while leaving the attempt status vocabulary open", () => {
    const quoteId = randomUUID();
    const attemptId = randomUUID();

    expect(checkoutQuoteIdParamsSchema.parse({ id: quoteId })).toEqual({ id: quoteId });
    expect(checkoutAttemptIdParamsSchema.parse({ attemptId })).toEqual({ attemptId });
    expect(() => checkoutQuoteIdParamsSchema.parse({ id: quoteId, extra: true })).toThrow();
    expect(() => checkoutAttemptIdParamsSchema.parse({ attemptId: "not-a-uuid" })).toThrow();

    expect(
      checkoutAttemptContractSchema.parse({
        id: attemptId,
        quoteId,
        orderId: null,
        status: "awaiting-orders",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }).status,
    ).toBe("awaiting-orders");
  });

  it("matches the approved Patch 0004 persisted quote response including store and Shipping snapshots", () => {
    const quote = {
      id: randomUUID(),
      currency: "PKR",
      shippingAddressId: randomUUID(),
      billingAddressId: randomUUID(),
      couponCode: "SAVE10",
      subtotal: "100.0000",
      discountTotal: "10.0000",
      taxTotal: "5.0000",
      shippingTotal: "15.0000",
      grandTotal: "110.0000",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      stateHash: "b".repeat(64),
      lines: [
        {
          variantId: randomUUID(),
          sellerId: randomUUID(),
          storeId: randomUUID(),
          quantity: 1,
          unitPrice: "100.0000",
          discount: "10.0000",
          tax: "5.0000",
          lineTotal: "95.0000",
        },
      ],
      shippingSelections: [
        {
          sellerId: randomUUID(),
          storeId: randomUUID(),
          shippingMethodId: randomUUID(),
          shippingMethodCode: "STANDARD",
          shippingMethodName: "Standard shipping",
          amount: "15.0000",
          currency: "PKR",
        },
      ],
    };

    expect(checkoutQuoteWithLinesContractSchema.parse(quote)).toEqual(quote);
    expect(() =>
      checkoutQuoteWithLinesContractSchema.parse({
        ...quote,
        customerUserId: randomUUID(),
      }),
    ).toThrow();
  });

  it("validates the required normalized Idempotency-Key HTTP header", () => {
    expect(
      checkoutConfirmHeadersSchema.parse({
        "idempotency-key": " checkout-confirm-1 ",
        authorization: "Bearer ignored-by-this-schema",
      }),
    ).toEqual({ "idempotency-key": "checkout-confirm-1" });

    expect(() => checkoutConfirmHeadersSchema.parse({})).toThrow();
    expect(() =>
      checkoutConfirmHeadersSchema.parse({ "idempotency-key": "   " }),
    ).toThrow();
    expect(() =>
      checkoutConfirmHeadersSchema.parse({ "idempotency-key": ["one", "two"] }),
    ).toThrow();
  });

  it("normalizes the persisted coupon code and validates the confirmation idempotency key value", () => {
    const parsed = checkoutQuoteWithLinesContractSchema.parse({
      id: randomUUID(),
      currency: "PKR",
      shippingAddressId: randomUUID(),
      billingAddressId: randomUUID(),
      couponCode: " save10 ",
      subtotal: "0.0000",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      shippingTotal: "0.0000",
      grandTotal: "0.0000",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      stateHash: "c".repeat(64),
      lines: [],
      shippingSelections: [],
    });

    expect(parsed.couponCode).toBe("SAVE10");
    expect(checkoutIdempotencyKeySchema.parse(" checkout-confirm-1 ")).toBe(
      "checkout-confirm-1",
    );
    expect(() => checkoutIdempotencyKeySchema.parse("   ")).toThrow();
    expect(() => checkoutIdempotencyKeySchema.parse("x".repeat(201))).toThrow();
  });
});

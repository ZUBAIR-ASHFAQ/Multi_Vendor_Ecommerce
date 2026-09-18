import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adminPaymentListQuerySchema,
  createPaymentIntentBodySchema,
  customerPaymentStatusSchema,
  internalRefundBodySchema,
  paymentIntentHeadersSchema,
  paymentMoneySchema,
  stripeWebhookHeadersSchema,
} from "../../src/modules/payments/payments.schema.js";

/** Builds one valid customer-safe Payment status response for strict contract tests. */
function paymentStatusResponse() {
  return {
    paymentId: randomUUID(),
    orderId: randomUUID(),
    provider: "stripe" as const,
    status: "pending" as const,
    currency: "PKR",
    amountAuthorized: "0.0000",
    amountCaptured: "0.0000",
    amountRefunded: "0.0000",
    refundableAmount: "0.0000",
    providerPaymentId: null,
    paymentExpiresAt: "2026-09-13T14:00:00.000Z",
    createdAt: "2026-09-13T13:00:00.000Z",
    updatedAt: "2026-09-13T13:00:00.000Z",
  };
}

describe("Module 12 Pass 2 Payment contracts", () => {
  it("keeps create-intent input empty and trims the required Idempotency-Key", () => {
    expect(createPaymentIntentBodySchema.parse({})).toEqual({});
    expect(() => createPaymentIntentBodySchema.parse({ amount: "10.0000" })).toThrow();
    expect(paymentIntentHeadersSchema.parse({ "idempotency-key": "  pay-order-1  " })).toEqual({
      "idempotency-key": "pay-order-1",
    });
  });

  it("requires exact scale-4 money and never permits silent provider rounding", () => {
    expect(paymentMoneySchema.parse("10.1200")).toBe("10.1200");
    expect(() => paymentMoneySchema.parse("10.12")).toThrow();
    expect(() => paymentMoneySchema.parse("10.12345")).toThrow();
  });

  it("keeps ordinary customer status free of client secrets", () => {
    expect(customerPaymentStatusSchema.parse(paymentStatusResponse())).toMatchObject({
      provider: "stripe",
      status: "pending",
    });
    expect(() =>
      customerPaymentStatusSchema.parse({
        ...paymentStatusResponse(),
        clientSecret: "pi_secret_should_not_be_here",
      }),
    ).toThrow();
  });

  it("accepts only allow-listed finance search fields and a valid date range", () => {
    expect(
      adminPaymentListQuerySchema.parse({
        provider: "stripe",
        currency: "pkr",
        sort: "updatedAt",
        order: "asc",
      }),
    ).toMatchObject({ provider: "stripe", currency: "PKR", sort: "updatedAt", order: "asc" });

    expect(() =>
      adminPaymentListQuerySchema.parse({
        createdFrom: "2026-09-14T00:00:00.000Z",
        createdTo: "2026-09-13T00:00:00.000Z",
      }),
    ).toThrow("createdTo must be on or after createdFrom.");
  });

  it("validates the trusted refund source, amount, reason, note, and provenance only", () => {
    const requestedByUserId = randomUUID();
    expect(
      internalRefundBodySchema.parse({
        sourceKey: " refunds:return-123 ",
        amount: "25.0000",
        providerReason: "requested_by_customer",
        note: "  Customer return approved  ",
        requestedByUserId,
      }),
    ).toEqual({
      sourceKey: "refunds:return-123",
      amount: "25.0000",
      providerReason: "requested_by_customer",
      note: "Customer return approved",
      requestedByUserId,
    });

    expect(() => internalRefundBodySchema.parse({ sourceKey: "x", amount: "0.0000" })).toThrow();
    expect(() =>
      internalRefundBodySchema.parse({
        sourceKey: "x",
        amount: "1.0000",
        providerReason: "other",
      }),
    ).toThrow();
  });

  it("requires a non-empty Stripe signature header before later adapter verification", () => {
    expect(
      stripeWebhookHeadersSchema.parse({ "stripe-signature": "  t=123,v1=signature  " }),
    ).toEqual({ "stripe-signature": "t=123,v1=signature" });
    expect(() => stripeWebhookHeadersSchema.parse({ "stripe-signature": "   " })).toThrow();
  });
});

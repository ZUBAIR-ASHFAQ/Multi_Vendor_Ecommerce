import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { StripePaymentProviderAdapter } from "../../src/integrations/payments/stripe/stripe-payment-provider.adapter.js";

/** Creates the minimum Stripe-shaped client needed to test the adapter without network calls. */
function stripeClientStub() {
  return {
    paymentIntents: {
      create: vi.fn(),
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
}

/** Creates one Stripe-shaped PaymentIntent object with safe IDs-only metadata. */
function stripeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: `pi_${randomUUID().replaceAll("-", "")}`,
    status: "requires_payment_method",
    amount: 1012,
    amount_received: 0,
    currency: "usd",
    created: 1_757_827_200,
    client_secret: "cs_test_browser_only",
    metadata: { paymentId: randomUUID(), orderId: randomUUID() },
    latest_charge: null,
    ...overrides,
  };
}

/** Creates one Stripe-shaped Refund object for provider-neutral normalization tests. */
function stripeRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: `re_${randomUUID().replaceAll("-", "")}`,
    payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
    amount: 500,
    currency: "usd",
    status: "succeeded",
    created: 1_757_827_200,
    ...overrides,
  };
}

describe("Module 12 Stripe provider adapter", () => {
  it("creates automatic-capture PaymentIntents with integer minor units, IDs-only metadata, and provider idempotency", async () => {
    const client = stripeClientStub();
    const intent = stripeIntent();
    client.paymentIntents.create.mockResolvedValue(intent);
    const adapter = new StripePaymentProviderAdapter({
      client: client as unknown as Stripe,
      webhookSecret: "whsec_test_only",
    });

    const result = await adapter.createPaymentIntent({
      amountMinor: "1012",
      currency: "USD",
      providerIdempotencyKey: `mkt_pi_${"a".repeat(64)}`,
      metadata: intent.metadata,
    });

    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 1012,
        currency: "usd",
        capture_method: "automatic",
        automatic_payment_methods: { enabled: true },
        metadata: intent.metadata,
      },
      { idempotencyKey: `mkt_pi_${"a".repeat(64)}` },
    );
    expect(result).toMatchObject({
      providerPaymentId: intent.id,
      status: "pending",
      amountMinor: "1012",
      currency: "USD",
      metadata: intent.metadata,
      clientSecret: "cs_test_browser_only",
    });
  });

  it("maps successful automatic capture from amount_received and preserves the provider transaction identity", async () => {
    const client = stripeClientStub();
    const intent = stripeIntent({
      status: "succeeded",
      amount: 1012,
      amount_received: 1012,
      client_secret: null,
      latest_charge: "ch_test_capture",
    });
    client.paymentIntents.retrieve.mockResolvedValue(intent);
    const adapter = new StripePaymentProviderAdapter({
      client: client as unknown as Stripe,
      webhookSecret: "whsec_test_only",
    });

    const result = await adapter.retrievePaymentIntent(intent.id);

    expect(result).toMatchObject({
      status: "captured",
      amountMinor: "1012",
      providerTransactionId: "ch_test_capture",
      clientSecret: null,
    });
  });

  it("fails closed when Stripe reports requires_capture under the automatic-capture contract", async () => {
    const client = stripeClientStub();
    const intent = stripeIntent({ status: "requires_capture" });
    client.paymentIntents.retrieve.mockResolvedValue(intent);
    const adapter = new StripePaymentProviderAdapter({
      client: client as unknown as Stripe,
      webhookSecret: "whsec_test_only",
    });

    await expect(adapter.retrievePaymentIntent(intent.id)).rejects.toThrow(
      "automatic capture is required",
    );
  });

  it("passes the exact raw webhook bytes/signature to Stripe and ignores unsupported signed event payloads", async () => {
    const client = stripeClientStub();
    const rawBody = Buffer.from('{"id":"evt_test"}', "utf8");
    client.webhooks.constructEvent.mockReturnValue({
      id: "evt_test",
      type: "customer.created",
      created: 1_757_827_200,
      data: { object: {} },
    });
    const adapter = new StripePaymentProviderAdapter({
      client: client as unknown as Stripe,
      webhookSecret: "whsec_test_exact_raw_body",
    });

    const result = await adapter.verifyAndParseWebhook(rawBody, "signed-header-value");

    expect(client.webhooks.constructEvent).toHaveBeenCalledWith(
      rawBody,
      "signed-header-value",
      "whsec_test_exact_raw_body",
    );
    expect(result).toMatchObject({
      providerEventId: "evt_test",
      eventType: "customer.created",
      paymentIntent: null,
    });
  });

  it("normalizes provider Refund status/identity without exposing Stripe SDK objects", async () => {
    const client = stripeClientStub();
    const refund = stripeRefund();
    client.refunds.create.mockResolvedValue(refund);
    const adapter = new StripePaymentProviderAdapter({
      client: client as unknown as Stripe,
      webhookSecret: "whsec_test_only",
    });

    const result = await adapter.createRefund({
      providerPaymentId: refund.payment_intent,
      amountMinor: "500",
      providerIdempotencyKey: `mkt_re_${"b".repeat(64)}`,
      providerReason: "requested_by_customer",
    });

    expect(client.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: refund.payment_intent,
        amount: 500,
        reason: "requested_by_customer",
      },
      { idempotencyKey: `mkt_re_${"b".repeat(64)}` },
    );
    expect(result).toMatchObject({
      providerRefundId: refund.id,
      providerPaymentId: refund.payment_intent,
      amountMinor: "500",
      currency: "USD",
      status: "succeeded",
    });
  });
});

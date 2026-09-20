import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";
import {
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENTS_ERROR_CODE,
  PAYMENTS_RECONCILIATION_ERROR_CODE,
} from "../../src/modules/payments/payments.constants.js";
import {
  PaymentsService,
  type PaymentsOrdersIntegration,
} from "../../src/modules/payments/payments.service.js";
import {
  prepareOrderFixture,
  readInventoryQuantities,
  readOrderItemReservations,
} from "../module11/module11.test-helpers.js";
import {
  countPaymentTransactions,
  createPaymentsJobSpy,
  customerPaymentContext,
  FakePaymentProvider,
  readOrderPaymentState,
  readPaymentByOrderId,
  readPaymentWebhook,
  resetModule12Tables,
  scale4ToExponent2Minor,
  subtractScale4,
  systemPaymentContext,
  TEST_STRIPE_SIGNATURE,
} from "./module12.test-helpers.js";

/** Builds the real Payments service around PostgreSQL/Foundation while replacing only live Stripe/BullMQ calls. */
function integrationService(
  provider: FakePaymentProvider,
  options: {
    ordersUsingTransaction?: (transaction: DatabaseTransaction) => PaymentsOrdersIntegration;
  } = {},
) {
  const jobSpy = createPaymentsJobSpy();
  const service = new PaymentsService({
    provider,
    jobs: jobSpy.jobs,
    currencyExponents: { PKR: 2, USD: 2 },
    ...(options.ordersUsingTransaction
      ? { ordersUsingTransaction: options.ordersUsingTransaction }
      : {}),
  });
  return { service, jobSpy };
}

/** Creates and then provider-confirms one Payment so refund/reconciliation tests start from captured truth. */
async function captureFixturePayment(
  service: PaymentsService,
  provider: FakePaymentProvider,
  fixture: Awaited<ReturnType<typeof prepareOrderFixture>>,
): Promise<{ paymentId: string; providerPaymentId: string }> {
  const context = customerPaymentContext(fixture.customer.id);
  const intent = await service.createPaymentIntent(
    context,
    fixture.orderId,
    `module12-capture-${randomUUID()}`,
  );
  provider.setIntentStatus(intent.providerPaymentId, "captured", {
    providerTransactionId: `ch_test_${randomUUID().replaceAll("-", "")}`,
  });
  const webhook = provider.webhookBody("payment_intent.succeeded", intent.providerPaymentId);
  const result = await service.processStripeWebhook(webhook.rawBody, TEST_STRIPE_SIGNATURE);
  expect(result.status).toBe("processed");
  return { paymentId: intent.paymentId, providerPaymentId: intent.providerPaymentId };
}

/** Returns the AppError from one rejected integration operation for stable-code assertions. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Module 12 integration operation to reject.");
}

beforeEach(async () => {
  await resetModule12Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 12 Payments PostgreSQL/provider regression", () => {
  it("creates exactly one Payment/intent, replays the same key, and reuses an active provider intent for a new key", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const context = customerPaymentContext(fixture.customer.id);
    const key = `module12-intent-${randomUUID()}`;

    const first = await service.createPaymentIntent(context, fixture.orderId, key);
    const replay = await service.createPaymentIntent(context, fixture.orderId, key);
    const activeReuse = await service.createPaymentIntent(
      context,
      fixture.orderId,
      `module12-intent-second-${randomUUID()}`,
    );

    expect(replay).toEqual(first);
    expect(activeReuse.paymentId).toBe(first.paymentId);
    expect(activeReuse.providerPaymentId).toBe(first.providerPaymentId);
    expect(provider.createPaymentIntentCalls).toHaveLength(1);
    expect(provider.createPaymentIntentCalls[0]?.amountMinor).toBe(
      scale4ToExponent2Minor(fixture.quote.grandTotal),
    );
    expect(await countPaymentTransactions(first.paymentId, "intent")).toBe(1);

    const count = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from payments where order_id = $1",
      [fixture.orderId],
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it("records provider capture exactly once, confirms the Order exactly once, and treats duplicate webhooks as replay", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const context = customerPaymentContext(fixture.customer.id);
    const intent = await service.createPaymentIntent(
      context,
      fixture.orderId,
      `module12-webhook-${randomUUID()}`,
    );
    provider.setIntentStatus(intent.providerPaymentId, "captured", {
      providerTransactionId: `ch_${randomUUID().replaceAll("-", "")}`,
    });
    const webhook = provider.webhookBody("payment_intent.succeeded", intent.providerPaymentId);

    const first = await service.processStripeWebhook(webhook.rawBody, TEST_STRIPE_SIGNATURE);
    const replay = await service.processStripeWebhook(webhook.rawBody, TEST_STRIPE_SIGNATURE);

    expect(first.status).toBe("processed");
    expect(replay.status).toBe("processed");
    expect(await countPaymentTransactions(intent.paymentId, "capture")).toBe(1);
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.CAPTURED,
      amount_authorized: fixture.quote.grandTotal,
      amount_captured: fixture.quote.grandTotal,
      amount_refunded: "0.0000",
    });
    expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
      payment_status: "captured",
      order_status: "confirmed",
    });
    expect(await readPaymentWebhook(webhook.providerEventId)).toMatchObject({
      status: "processed",
      error_code: null,
    });

    const capturedEvents = await databasePool.query<{ count: number }>(
      `select count(*)::int as count
         from outbox_events
        where event_type = 'payment.captured' and aggregate_id = $1`,
      [intent.paymentId],
    );
    expect(capturedEvents.rows[0]?.count).toBe(1);
  });

  it("fails a verified amount-mismatched capture without marking Payment or Order paid", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service, jobSpy } = integrationService(provider);
    const intent = await service.createPaymentIntent(
      customerPaymentContext(fixture.customer.id),
      fixture.orderId,
      `module12-mismatch-${randomUUID()}`,
    );
    provider.setIntentStatus(intent.providerPaymentId, "captured", {
      providerTransactionId: `ch_${randomUUID().replaceAll("-", "")}`,
      amountMinor: "1",
    });
    const webhook = provider.webhookBody("payment_intent.succeeded", intent.providerPaymentId);

    const result = await service.processStripeWebhook(webhook.rawBody, TEST_STRIPE_SIGNATURE);

    expect(result.status).toBe("failed");
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.PENDING,
      amount_captured: "0.0000",
    });
    expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
      payment_status: "pending",
      order_status: "pending_payment",
    });
    expect(await countPaymentTransactions(intent.paymentId, "capture")).toBe(0);
    expect(await readPaymentWebhook(webhook.providerEventId)).toMatchObject({
      status: "failed",
      error_code: PAYMENTS_ERROR_CODE.AMOUNT_MISMATCH,
    });
    expect(jobSpy.captureReconciliations).toHaveLength(0);
  });

  it("preserves provider capture when Order confirmation fails and completes the exact capture reconciliation later", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    let failOrderConfirmation = true;
    const { service, jobSpy } = integrationService(provider, {
      ordersUsingTransaction: (transaction) => {
        const real = OrdersService.using(transaction);
        return {
          /** Keeps trusted snapshot reads on the real transaction-bound Orders service. */
          getPaymentSnapshot: (context, orderId) => real.getPaymentSnapshot(context, orderId),
          /** Injects one transient failure only at the Orders confirmation savepoint. */
          confirmPayment: async (context, orderId, input) => {
            if (failOrderConfirmation) throw new Error("Injected Order confirmation failure");
            return real.confirmPayment(context, orderId, input);
          },
          /** Keeps overdue unpaid Order discovery on the real transaction-bound Orders service. */
          listOverduePaymentOrderCandidates: (context, limit) =>
            real.listOverduePaymentOrderCandidates(context, limit),
          /** Keeps expiry behavior on the real transaction-bound Orders service. */
          expireUnpaidOrder: (context, orderId, sourceKey) =>
            real.expireUnpaidOrder(context, orderId, sourceKey),
        };
      },
    });
    const context = customerPaymentContext(fixture.customer.id);
    const intent = await service.createPaymentIntent(
      context,
      fixture.orderId,
      `module12-reconcile-${randomUUID()}`,
    );
    provider.setIntentStatus(intent.providerPaymentId, "captured", {
      providerTransactionId: `ch_${randomUUID().replaceAll("-", "")}`,
    });
    const webhook = provider.webhookBody("payment_intent.succeeded", intent.providerPaymentId);

    const first = await service.processStripeWebhook(webhook.rawBody, TEST_STRIPE_SIGNATURE);

    expect(first.status).toBe("failed");
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.CAPTURED,
      amount_captured: fixture.quote.grandTotal,
    });
    expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
      payment_status: "pending",
      order_status: "pending_payment",
    });
    expect(await readPaymentWebhook(webhook.providerEventId)).toMatchObject({
      status: "failed",
      error_code: PAYMENTS_RECONCILIATION_ERROR_CODE.ORDER_CONFIRMATION_FAILED,
    });
    expect(jobSpy.captureReconciliations).toHaveLength(1);

    failOrderConfirmation = false;
    await service.reconcileCapture(jobSpy.captureReconciliations[0]!);

    expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
      payment_status: "captured",
      order_status: "confirmed",
    });
    expect(await readPaymentWebhook(webhook.providerEventId)).toMatchObject({
      status: "processed",
      error_code: null,
    });
    expect(await countPaymentTransactions(intent.paymentId, "capture")).toBe(1);
  });

  it("applies replay-safe partial/full refunds and never calls the provider twice for the same successful source", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const captured = await captureFixturePayment(service, provider, fixture);
    const system = systemPaymentContext();
    const sourceKey = `refunds:module12:${randomUUID()}`;

    const first = await service.refundPayment(system, captured.paymentId, {
      sourceKey,
      amount: "50.0000",
      providerReason: "requested_by_customer",
      note: "Pass 6 partial refund",
      requestedByUserId: fixture.customer.id,
    });
    const replay = await service.refundPayment(system, captured.paymentId, {
      sourceKey,
      amount: "50.0000",
      providerReason: "requested_by_customer",
      note: "Pass 6 partial refund",
      requestedByUserId: fixture.customer.id,
    });

    expect(first.status).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);
    expect(replay.id).toBe(first.id);
    expect(provider.createRefundCalls).toHaveLength(1);
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      amount_refunded: "50.0000",
    });

    const remaining = subtractScale4(fixture.quote.grandTotal, "50.0000");
    await service.refundPayment(system, captured.paymentId, {
      sourceKey: `refunds:module12:rest:${randomUUID()}`,
      amount: remaining,
      providerReason: "requested_by_customer",
    });
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.REFUNDED,
      amount_refunded: fixture.quote.grandTotal,
    });
    expect(await countPaymentTransactions(captured.paymentId, "refund")).toBe(2);
  });

  it("uses the pending refund reservation to prevent two concurrent refunds from oversubscribing captured funds", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const captured = await captureFixturePayment(service, provider, fixture);
    const system = systemPaymentContext();

    const results = await Promise.allSettled([
      service.refundPayment(system, captured.paymentId, {
        sourceKey: `refunds:race:a:${randomUUID()}`,
        amount: "150.0000",
      }),
      service.refundPayment(system, captured.paymentId, {
        sourceKey: `refunds:race:b:${randomUUID()}`,
        amount: "150.0000",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(AppError);
      expect((rejected.reason as AppError).code).toBe(PAYMENTS_ERROR_CODE.REFUND_AMOUNT_EXCEEDED);
    }
    expect(provider.createRefundCalls).toHaveLength(1);
    expect(await countPaymentTransactions(captured.paymentId, "refund")).toBe(1);
  });

  it("keeps a pending provider refund reserved and applies its later authoritative reconciliation result once", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service, jobSpy } = integrationService(provider);
    const captured = await captureFixturePayment(service, provider, fixture);
    provider.setNextRefundStatus("pending");

    const pending = await service.refundPayment(systemPaymentContext(), captured.paymentId, {
      sourceKey: `refunds:pending:${randomUUID()}`,
      amount: "25.0000",
    });

    expect(pending.status).toBe(PAYMENT_TRANSACTION_STATUS.PENDING);
    expect(jobSpy.refundReconciliations).toEqual([pending.id]);
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.CAPTURED,
      amount_refunded: "0.0000",
    });
    expect(pending.providerTxnId).toBeTruthy();

    provider.setRefundStatus(pending.providerTxnId!, "succeeded");
    await service.reconcileRefund(pending.id);

    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      amount_refunded: "25.0000",
    });
    expect(await countPaymentTransactions(captured.paymentId, "refund")).toBe(1);
  });

  it("expires an overdue unpaid Payment, cancels its provider intent, and delegates Order/inventory release to Module 11", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const intent = await service.createPaymentIntent(
      customerPaymentContext(fixture.customer.id),
      fixture.orderId,
      `module12-expiry-${randomUUID()}`,
    );

    await databasePool.query(
      "update checkout_attempts set expires_at = now() - interval '1 minute' where id = $1",
      [fixture.attempt.id],
    );

    await service.expireUnpaidPayment(intent.paymentId);

    expect(provider.cancelPaymentIntentCalls).toEqual([intent.providerPaymentId]);
    expect(await readPaymentByOrderId(fixture.orderId)).toMatchObject({
      status: PAYMENT_STATUS.CANCELLED,
      amount_captured: "0.0000",
    });
    expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
      payment_status: "pending",
      order_status: "cancelled",
    });
  });

  it(
    "expires an overdue unpaid Order with no Payment row exactly once and releases its Inventory reservation",
    async () => {
      const fixture = await prepareOrderFixture({ sellerCount: 1, quantities: [2] });
      const provider = new FakePaymentProvider();
      const { service } = integrationService(provider);

      expect(await readPaymentByOrderId(fixture.orderId)).toBeNull();
      await databasePool.query(
        "update checkout_attempts set expires_at = now() - interval '1 minute' where id = $1",
        [fixture.attempt.id],
      );

      const first = await service.expireOverdueOrders(10);
      const replay = await service.expireOverdueOrders(10);

      expect(first).toBe(1);
      expect(replay).toBe(0);
      expect(provider.cancelPaymentIntentCalls).toHaveLength(0);
      expect(await readPaymentByOrderId(fixture.orderId)).toBeNull();
      expect(await readOrderPaymentState(fixture.orderId)).toMatchObject({
        payment_status: "pending",
        order_status: "cancelled",
      });
      expect(await readOrderItemReservations(fixture.orderId)).toEqual([
        expect.objectContaining({ status: "released" }),
      ]);
      expect(
        await readInventoryQuantities(fixture.sellers[0]!.product.variant.id),
      ).toMatchObject({
        onHandQty: 20,
        reservedQty: 0,
        availableQty: 20,
      });
    },
  );

  it("rejects refund source-key reuse with a different amount before any second provider call", async () => {
    const fixture = await prepareOrderFixture();
    const provider = new FakePaymentProvider();
    const { service } = integrationService(provider);
    const captured = await captureFixturePayment(service, provider, fixture);
    const system = systemPaymentContext();
    const sourceKey = `refunds:conflict:${randomUUID()}`;

    await service.refundPayment(system, captured.paymentId, {
      sourceKey,
      amount: "10.0000",
    });
    const error = await rejectedAppError(
      service.refundPayment(system, captured.paymentId, {
        sourceKey,
        amount: "11.0000",
      }),
    );

    expect(error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(provider.createRefundCalls).toHaveLength(1);
  });
});

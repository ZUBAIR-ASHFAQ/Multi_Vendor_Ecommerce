import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import {
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENT_TRANSACTION_TYPE,
} from "../../src/modules/payments/payments.constants.js";
import { PaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import {
  prepareOrderFixture,
  resetModule11Tables,
} from "../module11/module11.test-helpers.js";

/** Produces the persisted SHA-256 idempotency hash required by the Payment table contract. */
function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Clears Module 12 rows before resetting all released prerequisite data. */
async function resetModule12Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      payment_transactions,
      payment_webhook_events,
      payments
    RESTART IDENTITY CASCADE
  `);
  await resetModule11Tables();
}

/** Creates one Payment fixture and fails the test immediately if the insert lost a conflict race. */
async function createPaymentOrThrow(
  repository: PaymentsRepository,
  orderId: string,
  currency: string,
) {
  const payment = await repository.createPayment({
    orderId,
    provider: PAYMENT_PROVIDER.STRIPE,
    currency,
    idempotencyKey: hashKey(`intent:${randomUUID()}`),
  });

  if (!payment) {
    throw new Error("Expected the test Payment to be created.");
  }

  return payment;
}

beforeEach(async () => {
  await resetModule12Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 12 Payments repository boundaries", () => {
  it("keeps customer Payment reads scoped to the parent Order owner", async () => {
    const fixture = await prepareOrderFixture();
    const other = await prepareOrderFixture();
    const repository = new PaymentsRepository();
    const payment = await createPaymentOrThrow(
      repository,
      fixture.orderId,
      fixture.quote.currency,
    );

    await expect(
      repository.findPaymentForCustomer(fixture.orderId, fixture.customer.id),
    ).resolves.toMatchObject({ id: payment.id, orderId: fixture.orderId });
    await expect(
      repository.findPaymentForCustomer(fixture.orderId, other.customer.id),
    ).resolves.toBeNull();
  });

  it("handles duplicate Payment creation without leaking a database uniqueness error", async () => {
    const fixture = await prepareOrderFixture();
    const repository = new PaymentsRepository();

    const [first, second] = await Promise.all([
      repository.createPayment({
        orderId: fixture.orderId,
        provider: PAYMENT_PROVIDER.STRIPE,
        currency: fixture.quote.currency,
        idempotencyKey: hashKey(`intent:${randomUUID()}`),
      }),
      repository.createPayment({
        orderId: fixture.orderId,
        provider: PAYMENT_PROVIDER.STRIPE,
        currency: fixture.quote.currency,
        idempotencyKey: hashKey(`intent:${randomUUID()}`),
      }),
    ]);

    const created = [first, second].filter((payment) => payment !== null);
    const conflicted = [first, second].filter((payment) => payment === null);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    await expect(repository.findPaymentByOrderId(fixture.orderId)).resolves.toMatchObject({
      id: created[0]?.id,
      orderId: fixture.orderId,
    });
  });

  it("supports finance list/detail persistence without embedding business arithmetic", async () => {
    const fixture = await prepareOrderFixture();
    const repository = new PaymentsRepository();
    const payment = await createPaymentOrThrow(
      repository,
      fixture.orderId,
      fixture.quote.currency,
    );
    const providerPaymentId = `pi_${randomUUID().replaceAll("-", "")}`;
    const currentIdempotencyKeyHash = hashKey(`retry:${randomUUID()}`);

    await repository.attachProviderPayment({
      paymentId: payment.id,
      providerPaymentId,
      idempotencyKeyHash: currentIdempotencyKeyHash,
      status: PAYMENT_STATUS.PROCESSING,
    });
    await repository.updatePaymentTotals({
      paymentId: payment.id,
      status: PAYMENT_STATUS.CAPTURED,
      amountAuthorized: fixture.quote.grandTotal,
      amountCaptured: fixture.quote.grandTotal,
    });
    const providerTxnId = `ch_${randomUUID().replaceAll("-", "")}`;
    await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.CAPTURE,
      providerTxnId,
      amount: fixture.quote.grandTotal,
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      occurredAt: new Date(),
      sourceKey: `capture:${randomUUID()}`,
    });

    const list = await repository.listAdminPayments({
      page: 1,
      pageSize: 20,
      provider: PAYMENT_PROVIDER.STRIPE,
      orderId: fixture.orderId,
      sort: "createdAt",
      order: "desc",
    });

    expect(list.totalItems).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: payment.id,
      providerPaymentId,
      idempotencyKey: currentIdempotencyKeyHash,
      status: PAYMENT_STATUS.CAPTURED,
      amountCaptured: fixture.quote.grandTotal,
    });
    await expect(repository.listTransactionsByPaymentId(payment.id)).resolves.toHaveLength(1);
    await expect(repository.findTransactionByProviderTxnId(providerTxnId)).resolves.toMatchObject({
      paymentId: payment.id,
      providerTxnId,
    });
  });

  it("persists webhook replay identity and exactly-once transaction source lookups", async () => {
    const fixture = await prepareOrderFixture();
    const repository = new PaymentsRepository();
    const payment = await createPaymentOrThrow(
      repository,
      fixture.orderId,
      fixture.quote.currency,
    );
    const providerEventId = `evt_${randomUUID().replaceAll("-", "")}`;
    const webhookInput = {
      provider: PAYMENT_PROVIDER.STRIPE,
      providerEventId,
      eventType: "payment_intent.succeeded",
      payloadHash: hashKey(JSON.stringify({ id: providerEventId })),
    } as const;
    const webhook = await repository.createWebhookEvent(webhookInput);

    if (!webhook) {
      throw new Error("Expected the first webhook delivery to be persisted.");
    }

    await expect(repository.createWebhookEvent(webhookInput)).resolves.toBeNull();

    const failedAt = new Date(Date.now() + 1000);
    await repository.markWebhookFailed(webhook.id, "PAYMENT_RECONCILIATION_REQUIRED", failedAt);
    const retrying = await repository.markWebhookProcessing(webhook.id);
    expect(retrying).toMatchObject({
      id: webhook.id,
      status: "processing",
      processedAt: null,
      errorCode: null,
    });

    const sourceKey = `webhook:${providerEventId}:capture`;
    const providerTxnId = `ch_${randomUUID().replaceAll("-", "")}`;
    const transaction = await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.CAPTURE,
      providerTxnId,
      amount: fixture.quote.grandTotal,
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      occurredAt: new Date(),
      rawEventId: webhook.id,
      sourceKey,
    });
    await repository.markWebhookFinished(webhook.id, "processed");

    await expect(
      repository.findWebhookEvent(PAYMENT_PROVIDER.STRIPE, providerEventId),
    ).resolves.toMatchObject({
      id: webhook.id,
      status: "processed",
    });
    await expect(repository.findTransactionBySourceKey(sourceKey)).resolves.toMatchObject({
      id: transaction.id,
    });
    await expect(repository.findTransactionByProviderTxnId(providerTxnId)).resolves.toMatchObject({
      id: transaction.id,
    });
  });

  it("sums only pending refund reservations with exact database numeric arithmetic", async () => {
    const fixture = await prepareOrderFixture();
    const repository = new PaymentsRepository();
    const payment = await createPaymentOrThrow(
      repository,
      fixture.orderId,
      fixture.quote.currency,
    );
    const occurredAt = new Date();

    await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.REFUND,
      amount: "10.0000",
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      occurredAt,
      sourceKey: `refund:${randomUUID()}`,
    });
    await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.REFUND,
      amount: "2.5000",
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      occurredAt,
      sourceKey: `refund:${randomUUID()}`,
    });
    await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.REFUND,
      amount: "7.0000",
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      occurredAt,
      sourceKey: `refund:${randomUUID()}`,
    });
    await repository.createTransaction({
      paymentId: payment.id,
      type: PAYMENT_TRANSACTION_TYPE.FAILURE,
      amount: "50.0000",
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      occurredAt,
      sourceKey: `failure:${randomUUID()}`,
    });

    await expect(repository.getPendingRefundTotal(payment.id)).resolves.toBe("12.5000");
  });

  it("can bind Payment locks and updates to an existing transaction", async () => {
    const fixture = await prepareOrderFixture();
    const repository = new PaymentsRepository();
    const payment = await createPaymentOrThrow(
      repository,
      fixture.orderId,
      fixture.quote.currency,
    );

    await db.transaction(async (transaction) => {
      const scoped = repository.using(transaction);
      await expect(scoped.lockPaymentById(payment.id)).resolves.toMatchObject({ id: payment.id });
      await expect(
        scoped.updatePaymentTotals({
          paymentId: payment.id,
          status: PAYMENT_STATUS.PROCESSING,
        }),
      ).resolves.toMatchObject({ id: payment.id, status: PAYMENT_STATUS.PROCESSING });
    });
  });
});

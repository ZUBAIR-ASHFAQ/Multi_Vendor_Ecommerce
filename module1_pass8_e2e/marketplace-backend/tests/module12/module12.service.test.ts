import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import type { PaymentRow, PaymentTransactionRow } from "../../src/database/schema/payments.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import type { ProviderPaymentIntent } from "../../src/integrations/payments/payment-provider.contract.js";
import {
  ORDER_PAYMENT_STATUS,
  ORDER_STATUS,
} from "../../src/modules/orders/orders.constants.js";
import type { OrderPaymentSnapshot } from "../../src/modules/orders/orders.service.js";
import {
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENT_TRANSACTION_TYPE,
  PAYMENTS_ERROR_CODE,
} from "../../src/modules/payments/payments.constants.js";
import { PaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import {
  PaymentsService,
  type PaymentsAuditIntegration,
  type PaymentsIdempotencyIntegration,
  type PaymentsOrdersIntegration,
  type PaymentsOutboxIntegration,
} from "../../src/modules/payments/payments.service.js";
import {
  createPaymentsJobSpy,
  customerPaymentContext,
  FakePaymentProvider,
} from "./module12.test-helpers.js";

/** Creates one canonical immutable Order Payment snapshot for focused service tests. */
function paymentSnapshot(overrides: Partial<OrderPaymentSnapshot> = {}): OrderPaymentSnapshot {
  const now = Date.now();
  return {
    orderId: randomUUID(),
    customerUserId: randomUUID(),
    currency: "USD",
    grandTotal: "10.1200",
    paymentStatus: ORDER_PAYMENT_STATUS.PENDING,
    orderStatus: ORDER_STATUS.PENDING_PAYMENT,
    checkoutAttemptId: randomUUID(),
    paymentExpiresAt: new Date(now + 15 * 60_000).toISOString(),
    remainingItemQuantity: 1,
    ...overrides,
  };
}

/** Creates one Payment database-shaped row without requiring PostgreSQL in service unit tests. */
function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  const now = new Date("2026-09-14T06:00:00.000Z");
  return {
    id: randomUUID(),
    orderId: randomUUID(),
    provider: PAYMENT_PROVIDER.STRIPE,
    providerPaymentId: null,
    currency: "USD",
    amountAuthorized: "0.0000",
    amountCaptured: "0.0000",
    amountRefunded: "0.0000",
    status: PAYMENT_STATUS.PENDING,
    idempotencyKey: "a".repeat(64),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Creates one Payment transaction row for simple repository doubles. */
function paymentTransaction(overrides: Partial<PaymentTransactionRow> = {}): PaymentTransactionRow {
  const now = new Date("2026-09-14T06:00:00.000Z");
  return {
    id: randomUUID(),
    paymentId: randomUUID(),
    type: PAYMENT_TRANSACTION_TYPE.INTENT,
    providerTxnId: null,
    amount: "10.1200",
    status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    occurredAt: now,
    rawEventId: null,
    sourceKey: `payments:test:${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Builds a narrow repository double and lets each test override only the methods it needs. */
function repositoryStub(overrides: Partial<Record<keyof PaymentsRepository, unknown>> = {}): PaymentsRepository {
  return {
    findPaymentForCustomer: vi.fn().mockResolvedValue(null),
    findPaymentByOrderId: vi.fn().mockResolvedValue(null),
    createPayment: vi.fn(),
    lockPaymentById: vi.fn(),
    attachProviderPayment: vi.fn(),
    updatePaymentTotals: vi.fn(),
    createTransaction: vi.fn(),
    getPendingRefundTotal: vi.fn().mockResolvedValue("0.0000"),
    ...overrides,
  } as unknown as PaymentsRepository;
}

/** Creates no-database service dependencies while retaining real Payment business logic. */
function serviceHarness(options: {
  snapshot?: OrderPaymentSnapshot;
  repository?: PaymentsRepository;
  provider?: FakePaymentProvider;
  idempotency?: PaymentsIdempotencyIntegration;
}) {
  const snapshot = options.snapshot ?? paymentSnapshot();
  const provider = options.provider ?? new FakePaymentProvider();
  const repository = options.repository ?? repositoryStub();
  const orders: PaymentsOrdersIntegration = {
    getPaymentSnapshot: vi.fn().mockResolvedValue(snapshot),
    confirmPayment: vi.fn(),
    listOverduePaymentOrderCandidates: vi.fn().mockResolvedValue([]),
    expireUnpaidOrder: vi.fn(),
  };
  const idempotency: PaymentsIdempotencyIntegration = options.idempotency ?? {
    begin: vi.fn().mockResolvedValue({ mode: "acquired", recordId: randomUUID() }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const audit: PaymentsAuditIntegration = {
    record: vi.fn().mockResolvedValue(randomUUID()),
  };
  const outbox: PaymentsOutboxIntegration = {
    enqueue: vi.fn().mockResolvedValue(randomUUID()),
  };
  const transaction = {} as DatabaseTransaction;
  const jobSpy = createPaymentsJobSpy();
  const service = new PaymentsService({
    repository,
    repositoryUsingTransaction: () => repository,
    transactionRunner: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
    provider,
    administration: { isSupportedCurrency: vi.fn().mockResolvedValue(true) },
    orders,
    ordersUsingTransaction: () => orders,
    idempotency,
    audit,
    auditUsingTransaction: () => audit,
    outboxUsingTransaction: () => outbox,
    jobs: jobSpy.jobs,
    currencyExponents: { USD: 2, PKR: 2 },
    now: () => new Date("2026-09-14T06:00:00.000Z"),
  });

  return { service, snapshot, provider, repository, orders, idempotency, audit, outbox, jobSpy };
}

/** Returns the AppError produced by one rejected service call for readable code assertions. */
async function expectAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected the Payment service operation to reject.");
}

describe("Module 12 Payments service", () => {
  it("creates an intent from the immutable Order total using exact provider minor units and a derived provider key", async () => {
    const snapshot = paymentSnapshot();
    const initial = paymentRow({ orderId: snapshot.orderId, currency: snapshot.currency });
    const providerPaymentId = `pi_${randomUUID().replaceAll("-", "")}`;
    const attached = paymentRow({
      ...initial,
      providerPaymentId,
      idempotencyKey: "b".repeat(64),
    });
    const provider = new FakePaymentProvider();
    const createProvider = vi
      .spyOn(provider, "createPaymentIntent")
      .mockImplementation(async (input) => {
        const intent: ProviderPaymentIntent = {
          providerPaymentId,
          status: "pending",
          amountMinor: input.amountMinor,
          currency: input.currency,
          createdAt: new Date("2026-09-14T06:00:00.000Z"),
          clientSecret: "cs_test_safe_for_browser_only",
          metadata: input.metadata,
          providerTransactionId: null,
        };
        return intent;
      });
    const repository = repositoryStub({
      createPayment: vi.fn().mockResolvedValue(initial),
      lockPaymentById: vi.fn().mockResolvedValue(initial),
      attachProviderPayment: vi.fn().mockResolvedValue(attached),
      createTransaction: vi.fn().mockResolvedValue(
        paymentTransaction({ paymentId: initial.id, providerTxnId: providerPaymentId }),
      ),
    });
    const harness = serviceHarness({ snapshot, repository, provider });
    const context = customerPaymentContext(snapshot.customerUserId);
    const rawKey = " browser-payment-key ";

    const response = await harness.service.createPaymentIntent(context, snapshot.orderId, rawKey);

    expect(response).toMatchObject({
      paymentId: initial.id,
      orderId: snapshot.orderId,
      providerPaymentId,
      amount: "10.1200",
      currency: "USD",
      clientSecret: "cs_test_safe_for_browser_only",
    });
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider.mock.calls[0]?.[0]).toMatchObject({
      amountMinor: "1012",
      currency: "USD",
      metadata: { paymentId: initial.id, orderId: snapshot.orderId },
    });
    expect(createProvider.mock.calls[0]?.[0].providerIdempotencyKey).toMatch(/^mkt_pi_[0-9a-f]{64}$/);
    expect(createProvider.mock.calls[0]?.[0].providerIdempotencyKey).not.toContain("browser-payment-key");
    expect(harness.idempotency.complete).toHaveBeenCalledTimes(1);
    expect(harness.jobSpy.expiries).toHaveLength(1);
  });

  it("propagates a Foundation idempotency conflict before any provider or repository write", async () => {
    const snapshot = paymentSnapshot();
    const idempotency: PaymentsIdempotencyIntegration = {
      begin: vi.fn().mockRejectedValue(
        new AppError({
          code: ERROR_CODE.IDEMPOTENCY_CONFLICT,
          message: "Idempotency key conflicts with another request.",
          statusCode: 409,
        }),
      ),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const provider = new FakePaymentProvider();
    const repository = repositoryStub();
    const harness = serviceHarness({ snapshot, provider, repository, idempotency });

    const error = await expectAppError(
      harness.service.createPaymentIntent(
        customerPaymentContext(snapshot.customerUserId),
        snapshot.orderId,
        "conflicting-key",
      ),
    );

    expect(error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);
    expect(provider.createPaymentIntentCalls).toHaveLength(0);
    expect(repository.createPayment).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(idempotency.fail).not.toHaveBeenCalled();
  });

  it("returns the Foundation idempotency replay without calling the provider again", async () => {
    const snapshot = paymentSnapshot();
    const replayResponse = {
      paymentId: randomUUID(),
      orderId: snapshot.orderId,
      provider: "stripe" as const,
      providerPaymentId: "pi_replayed",
      status: "pending" as const,
      currency: "USD",
      amount: "10.1200",
      paymentExpiresAt: snapshot.paymentExpiresAt,
      clientSecret: "cs_replayed",
    };
    const idempotency: PaymentsIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({
        mode: "replay",
        replay: { statusCode: 200, responseBody: replayResponse },
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const provider = new FakePaymentProvider();
    const harness = serviceHarness({ snapshot, provider, idempotency });

    const result = await harness.service.createPaymentIntent(
      customerPaymentContext(snapshot.customerUserId),
      snapshot.orderId,
      "same-key",
    );

    expect(result).toEqual(replayResponse);
    expect(provider.createPaymentIntentCalls).toHaveLength(0);
    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(idempotency.fail).not.toHaveBeenCalled();
  });

  it("rejects a scale-4 Order amount that cannot be represented exactly at the configured provider exponent", async () => {
    const snapshot = paymentSnapshot({ grandTotal: "10.1234" });
    const provider = new FakePaymentProvider();
    const harness = serviceHarness({ snapshot, provider });

    const error = await expectAppError(
      harness.service.createPaymentIntent(
        customerPaymentContext(snapshot.customerUserId),
        snapshot.orderId,
        "exact-money-check",
      ),
    );

    expect(error.code).toBe(PAYMENTS_ERROR_CODE.PROVIDER_ERROR);
    expect(provider.createPaymentIntentCalls).toHaveLength(0);
    expect(harness.idempotency.fail).toHaveBeenCalledTimes(1);
  });

  it("never creates a replacement intent for an already-captured Payment and never returns a client secret", async () => {
    const snapshot = paymentSnapshot();
    const captured = paymentRow({
      orderId: snapshot.orderId,
      providerPaymentId: "pi_already_captured",
      currency: snapshot.currency,
      status: PAYMENT_STATUS.CAPTURED,
      amountAuthorized: snapshot.grandTotal,
      amountCaptured: snapshot.grandTotal,
    });
    const repository = repositoryStub({
      findPaymentForCustomer: vi.fn().mockResolvedValue(captured),
    });
    const provider = new FakePaymentProvider();
    const harness = serviceHarness({ snapshot, repository, provider });

    const result = await harness.service.createPaymentIntent(
      customerPaymentContext(snapshot.customerUserId),
      snapshot.orderId,
      "captured-payment-retry",
    );

    expect(result.status).toBe(PAYMENT_STATUS.CAPTURED);
    expect(result.clientSecret).toBeNull();
    expect(provider.createPaymentIntentCalls).toHaveLength(0);
    expect(provider.retrievePaymentIntentCalls).toHaveLength(0);
  });

  it("reads marketplace status without querying the provider and subtracts pending refunds from refundable funds", async () => {
    const snapshot = paymentSnapshot();
    const captured = paymentRow({
      orderId: snapshot.orderId,
      providerPaymentId: "pi_status_only",
      currency: snapshot.currency,
      status: PAYMENT_STATUS.CAPTURED,
      amountAuthorized: "10.1200",
      amountCaptured: "10.1200",
      amountRefunded: "2.0000",
    });
    const repository = repositoryStub({
      findPaymentForCustomer: vi.fn().mockResolvedValue(captured),
      getPendingRefundTotal: vi.fn().mockResolvedValue("1.1200"),
    });
    const provider = new FakePaymentProvider();
    const harness = serviceHarness({ snapshot, repository, provider });

    const result = await harness.service.getCustomerPaymentStatus(
      customerPaymentContext(snapshot.customerUserId),
      snapshot.orderId,
    );

    expect(result.refundableAmount).toBe("7.0000");
    expect(result).not.toHaveProperty("clientSecret");
    expect(provider.retrievePaymentIntentCalls).toHaveLength(0);
  });

  it("expires an overdue Order even when the customer never created a Payment row", async () => {
    const orderId = randomUUID();
    const harness = serviceHarness({});
    vi.mocked(harness.orders.listOverduePaymentOrderCandidates).mockResolvedValue([
      { orderId, paymentExpiresAt: "2026-09-14T05:45:00.000Z" },
    ]);

    const processed = await harness.service.expireOverdueOrders(25);

    expect(processed).toBe(1);
    expect(harness.repository.findPaymentByOrderId).toHaveBeenCalledWith(orderId);
    expect(harness.orders.expireUnpaidOrder).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "system" }),
      orderId,
      `payments:order-expiry:${orderId}`,
    );
  });

  it("uses the provider-aware Payment expiry path when an overdue Order already has a Payment", async () => {
    const orderId = randomUUID();
    const payment = paymentRow({ orderId });
    const repository = repositoryStub({
      findPaymentByOrderId: vi.fn().mockResolvedValue(payment),
    });
    const harness = serviceHarness({ repository });
    vi.mocked(harness.orders.listOverduePaymentOrderCandidates).mockResolvedValue([
      { orderId, paymentExpiresAt: "2026-09-14T05:45:00.000Z" },
    ]);
    const expireSpy = vi.spyOn(harness.service, "expireUnpaidPayment").mockResolvedValue();

    const processed = await harness.service.expireOverdueOrders(25);

    expect(processed).toBe(1);
    expect(expireSpy).toHaveBeenCalledWith(payment.id);
    expect(harness.orders.expireUnpaidOrder).not.toHaveBeenCalled();
  });

  it("fails closed when the authenticated customer lacks payments.read_own", async () => {
    const snapshot = paymentSnapshot();
    const harness = serviceHarness({ snapshot });

    const error = await expectAppError(
      harness.service.getCustomerPaymentStatus(
        customerPaymentContext(snapshot.customerUserId, []),
        snapshot.orderId,
      ),
    );

    expect(error.code).toBe(ERROR_CODE.FORBIDDEN);
  });
});

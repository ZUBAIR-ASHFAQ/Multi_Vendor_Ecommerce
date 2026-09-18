import { randomUUID } from "node:crypto";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { databasePool } from "../../src/database/db.js";
import type {
  CreateProviderPaymentIntentInput,
  CreateProviderRefundInput,
  PaymentProviderAdapter,
  ProviderPaymentIntent,
  ProviderPaymentIntentStatus,
  ProviderRefund,
  VerifiedProviderWebhookEvent,
} from "../../src/integrations/payments/payment-provider.contract.js";
import {
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENTS_PERMISSION,
} from "../../src/modules/payments/payments.constants.js";
import type { PaymentsJobEnqueuer } from "../../src/modules/payments/payments.service.js";
import { PaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import {
  resetModule11Tables,
  type PreparedOrderFixture,
} from "../module11/module11.test-helpers.js";

/** Signature accepted only by the in-memory provider used by focused Module 12 tests. */
export const TEST_STRIPE_SIGNATURE = "module12-test-valid-signature";

/** Creates one authenticated customer Payment context without going through HTTP/JWT parsing. */
export function customerPaymentContext(
  customerUserId: string,
  permissions: PermissionCode[] = [PAYMENTS_PERMISSION.READ_OWN],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: customerUserId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates one platform-admin Payment context for finance-read service tests. */
export function adminPaymentContext(
  adminUserId = randomUUID(),
  permissions: PermissionCode[] = [PAYMENTS_PERMISSION.ADMIN_READ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: adminUserId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates the trusted system context used by the internal refund service boundary. */
export function systemPaymentContext(): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Clears Module 12 rows before resetting every released prerequisite test fixture. */
export async function resetModule12Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      payment_transactions,
      payment_webhook_events,
      payments
    RESTART IDENTITY CASCADE
  `);
  await resetModule11Tables();
}

/** Creates one persisted Payment row for HTTP/read tests that do not need a provider call. */
export async function createPersistedPaymentForFixture(
  fixture: PreparedOrderFixture,
  overrides: {
    providerPaymentId?: string;
    status?: "pending" | "processing" | "captured" | "failed" | "cancelled" | "partially_refunded" | "refunded";
    amountAuthorized?: string;
    amountCaptured?: string;
    amountRefunded?: string;
  } = {},
) {
  const repository = new PaymentsRepository();
  const payment = await repository.createPayment({
    orderId: fixture.orderId,
    provider: PAYMENT_PROVIDER.STRIPE,
    currency: fixture.quote.currency,
    idempotencyKey: "a".repeat(64),
  });
  if (!payment) throw new Error("Expected Module 12 Payment fixture to be created.");

  let current = payment;
  if (overrides.providerPaymentId) {
    const attached = await repository.attachProviderPayment({
      paymentId: current.id,
      providerPaymentId: overrides.providerPaymentId,
      idempotencyKeyHash: "b".repeat(64),
      status: overrides.status ?? PAYMENT_STATUS.PENDING,
    });
    if (!attached) throw new Error("Expected provider Payment identity to be attached.");
    current = attached;
  }

  if (
    overrides.status !== undefined ||
    overrides.amountAuthorized !== undefined ||
    overrides.amountCaptured !== undefined ||
    overrides.amountRefunded !== undefined
  ) {
    const updated = await repository.updatePaymentTotals({
      paymentId: current.id,
      status: overrides.status ?? (current.status as typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS]),
      ...(overrides.amountAuthorized !== undefined
        ? { amountAuthorized: overrides.amountAuthorized }
        : {}),
      ...(overrides.amountCaptured !== undefined
        ? { amountCaptured: overrides.amountCaptured }
        : {}),
      ...(overrides.amountRefunded !== undefined
        ? { amountRefunded: overrides.amountRefunded }
        : {}),
    });
    if (!updated) throw new Error("Expected Payment fixture totals to be updated.");
    current = updated;
  }

  return current;
}

/** Reads one Payment row directly for post-service reconciliation assertions. */
export async function readPaymentByOrderId(orderId: string) {
  const result = await databasePool.query<{
    id: string;
    order_id: string;
    provider_payment_id: string | null;
    status: string;
    amount_authorized: string;
    amount_captured: string;
    amount_refunded: string;
  }>(
    `select id, order_id, provider_payment_id, status,
            amount_authorized::text, amount_captured::text, amount_refunded::text
       from payments
      where order_id = $1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

/** Reads the parent Order's independent Payment/Order status for cross-ledger assertions. */
export async function readOrderPaymentState(orderId: string) {
  const result = await databasePool.query<{
    order_status: string;
    payment_status: string;
  }>(
    `select order_status, payment_status
       from orders
      where id = $1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

/** Counts one Payment transaction category for exactly-once webhook/refund assertions. */
export async function countPaymentTransactions(
  paymentId: string,
  type: "intent" | "authorize" | "capture" | "refund" | "failure",
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from payment_transactions
      where payment_id = $1 and type = $2`,
    [paymentId, type],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads one webhook receipt by provider event identity without exposing raw payload bytes. */
export async function readPaymentWebhook(providerEventId: string) {
  const result = await databasePool.query<{
    id: string;
    status: string;
    error_code: string | null;
    processed_at: Date | null;
  }>(
    `select id, status, error_code, processed_at
       from payment_webhook_events
      where provider = 'stripe' and provider_event_id = $1`,
    [providerEventId],
  );
  return result.rows[0] ?? null;
}

/** Converts canonical scale-4 money to exact exponent-2 provider minor units for test assertions. */
export function scale4ToExponent2Minor(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedFraction = `${fraction}0000`.slice(0, 4);
  if (!normalizedFraction.endsWith("00")) {
    throw new Error("Scale-4 value is not exactly representable with exponent 2.");
  }
  return (BigInt(whole) * 100n + BigInt(normalizedFraction.slice(0, 2))).toString();
}

/** Returns one exact canonical scale-4 subtraction without JavaScript floating-point money. */
export function subtractScale4(left: string, right: string): string {
  const toUnits = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 10_000n + BigInt(`${fraction}0000`.slice(0, 4));
  };
  const value = toUnits(left) - toUnits(right);
  if (value < 0n) throw new Error("Scale-4 subtraction produced a negative result.");
  return `${value / 10_000n}.${(value % 10_000n).toString().padStart(4, "0")}`;
}

/** In-memory provider proving Module 12 behavior without making live Stripe network calls. */
export class FakePaymentProvider implements PaymentProviderAdapter {
  readonly createPaymentIntentCalls: CreateProviderPaymentIntentInput[] = [];
  readonly retrievePaymentIntentCalls: string[] = [];
  readonly cancelPaymentIntentCalls: string[] = [];
  readonly createRefundCalls: CreateProviderRefundInput[] = [];
  readonly retrieveRefundCalls: string[] = [];
  readonly webhookVerificationCalls: Array<{ rawBody: Buffer; signature: string }> = [];

  private readonly intents = new Map<string, ProviderPaymentIntent>();
  private readonly refunds = new Map<string, ProviderRefund>();
  private refundStatus: ProviderRefund["status"] = "succeeded";

  /** Creates one deterministic provider-neutral PaymentIntent and records the exact adapter input. */
  async createPaymentIntent(input: CreateProviderPaymentIntentInput): Promise<ProviderPaymentIntent> {
    this.createPaymentIntentCalls.push(input);
    const providerPaymentId = `pi_test_${randomUUID().replaceAll("-", "")}`;
    const intent: ProviderPaymentIntent = {
      providerPaymentId,
      status: "pending",
      amountMinor: input.amountMinor,
      currency: input.currency,
      createdAt: new Date(),
      clientSecret: `secret_${providerPaymentId}`,
      metadata: { ...input.metadata },
      providerTransactionId: null,
    };
    this.intents.set(providerPaymentId, intent);
    return { ...intent, metadata: { ...intent.metadata } };
  }

  /** Returns the latest in-memory provider state for reconciliation or active-intent reuse. */
  async retrievePaymentIntent(providerPaymentId: string): Promise<ProviderPaymentIntent> {
    this.retrievePaymentIntentCalls.push(providerPaymentId);
    const intent = this.intents.get(providerPaymentId);
    if (!intent) throw new Error("Fake provider PaymentIntent was not found.");
    return { ...intent, metadata: { ...intent.metadata } };
  }

  /** Cancels one in-memory provider intent while preserving its immutable identity/amount metadata. */
  async cancelPaymentIntent(input: { providerPaymentId: string }): Promise<ProviderPaymentIntent> {
    this.cancelPaymentIntentCalls.push(input.providerPaymentId);
    const current = await this.retrievePaymentIntent(input.providerPaymentId);
    const cancelled: ProviderPaymentIntent = {
      ...current,
      status: "cancelled",
      clientSecret: null,
    };
    this.intents.set(input.providerPaymentId, cancelled);
    return { ...cancelled, metadata: { ...cancelled.metadata } };
  }

  /** Verifies a deterministic test signature and converts a small JSON envelope into a signed provider event. */
  async verifyAndParseWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<VerifiedProviderWebhookEvent> {
    this.webhookVerificationCalls.push({ rawBody: Buffer.from(rawBody), signature });
    if (signature !== TEST_STRIPE_SIGNATURE) {
      throw new Error("Fake Stripe signature is invalid.");
    }

    const parsed = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      type: string;
      providerPaymentId?: string;
      occurredAt?: string;
    };
    const providerPaymentId = parsed.providerPaymentId;
    const paymentIntent = providerPaymentId
      ? await this.retrievePaymentIntent(providerPaymentId)
      : null;

    return {
      providerEventId: parsed.id,
      eventType: parsed.type,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(),
      paymentIntent,
    };
  }

  /** Creates one deterministic provider Refund using the currently selected fake terminal/pending status. */
  async createRefund(input: CreateProviderRefundInput): Promise<ProviderRefund> {
    this.createRefundCalls.push(input);
    const intent = this.intents.get(input.providerPaymentId);
    if (!intent) throw new Error("Fake provider refund PaymentIntent was not found.");
    const providerRefundId = `re_test_${randomUUID().replaceAll("-", "")}`;
    const refund: ProviderRefund = {
      providerRefundId,
      providerPaymentId: input.providerPaymentId,
      amountMinor: input.amountMinor,
      currency: intent.currency,
      status: this.refundStatus,
      createdAt: new Date(),
    };
    this.refunds.set(providerRefundId, refund);
    return { ...refund };
  }

  /** Returns the current in-memory provider Refund state for background reconciliation. */
  async retrieveRefund(providerRefundId: string): Promise<ProviderRefund> {
    this.retrieveRefundCalls.push(providerRefundId);
    const refund = this.refunds.get(providerRefundId);
    if (!refund) throw new Error("Fake provider Refund was not found.");
    return { ...refund };
  }

  /** Changes one existing PaymentIntent to the provider-authoritative state used by the next webhook/reconciliation. */
  setIntentStatus(
    providerPaymentId: string,
    status: ProviderPaymentIntentStatus,
    options: { providerTransactionId?: string | null; amountMinor?: string; currency?: string } = {},
  ): void {
    const current = this.intents.get(providerPaymentId);
    if (!current) throw new Error("Fake provider PaymentIntent was not found.");
    this.intents.set(providerPaymentId, {
      ...current,
      status,
      ...(options.amountMinor !== undefined ? { amountMinor: options.amountMinor } : {}),
      ...(options.currency !== undefined ? { currency: options.currency } : {}),
      providerTransactionId:
        options.providerTransactionId !== undefined
          ? options.providerTransactionId
          : current.providerTransactionId,
      clientSecret: status === "captured" || status === "cancelled" ? null : current.clientSecret,
    });
  }

  /** Chooses the provider result returned by subsequently created test refunds. */
  setNextRefundStatus(status: ProviderRefund["status"]): void {
    this.refundStatus = status;
  }

  /** Changes an already-created fake Refund so a reconciliation retry can observe a new provider result. */
  setRefundStatus(providerRefundId: string, status: ProviderRefund["status"]): void {
    const current = this.refunds.get(providerRefundId);
    if (!current) throw new Error("Fake provider Refund was not found.");
    this.refunds.set(providerRefundId, { ...current, status });
  }

  /** Builds the exact raw JSON bytes consumed by the fake provider webhook verifier. */
  webhookBody(
    eventType: string,
    providerPaymentId?: string,
    providerEventId = `evt_test_${randomUUID().replaceAll("-", "")}`,
  ): { providerEventId: string; rawBody: Buffer } {
    return {
      providerEventId,
      rawBody: Buffer.from(
        JSON.stringify({
          id: providerEventId,
          type: eventType,
          ...(providerPaymentId ? { providerPaymentId } : {}),
          occurredAt: new Date().toISOString(),
        }),
        "utf8",
      ),
    };
  }
}

/** Creates a no-Redis Payments job spy so integration tests can assert reconciliation scheduling. */
export function createPaymentsJobSpy(): {
  jobs: PaymentsJobEnqueuer;
  captureReconciliations: string[];
  refundReconciliations: string[];
  expiries: Array<{ paymentId: string; runAt: Date }>;
} {
  const captureReconciliations: string[] = [];
  const refundReconciliations: string[] = [];
  const expiries: Array<{ paymentId: string; runAt: Date }> = [];
  const jobs: PaymentsJobEnqueuer = {
    /** Records one capture reconciliation request without creating a BullMQ connection. */
    async enqueueCaptureReconciliation(paymentTransactionId: string): Promise<void> {
      captureReconciliations.push(paymentTransactionId);
    },

    /** Records one refund reconciliation request without creating a BullMQ connection. */
    async enqueueRefundReconciliation(paymentTransactionId: string): Promise<void> {
      refundReconciliations.push(paymentTransactionId);
    },

    /** Records one future Payment expiry without creating a BullMQ connection. */
    async enqueueExpiry(paymentId: string, runAt: Date): Promise<void> {
      expiries.push({ paymentId, runAt });
    },
  };

  return { jobs, captureReconciliations, refundReconciliations, expiries };
}

import { createHash, randomUUID } from "node:crypto";
import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError, isAppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  IdempotencyService,
  type BeginIdempotentOperationResult,
} from "../../common/idempotency/idempotency.service.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { env } from "../../config/env.js";
import { db } from "../../database/db.js";
import type {
  PaymentRow,
  PaymentTransactionRow,
  PaymentWebhookEventRow,
} from "../../database/schema/payments.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import type {
  PaymentProviderAdapter,
  ProviderPaymentIntent,
  ProviderRefund,
  VerifiedProviderWebhookEvent,
} from "../../integrations/payments/payment-provider.contract.js";
import { StripePaymentProviderAdapter } from "../../integrations/payments/stripe/stripe-payment-provider.adapter.js";
import { AdministrationService } from "../administration/administration.service.js";
import {
  ORDER_PAYMENT_STATUS,
  ORDER_STATUS,
} from "../orders/orders.constants.js";
import {
  OrdersService,
  type ExpireUnpaidOrderResult,
  type OrderPaymentSnapshot,
  type OverduePaymentOrderCandidate,
} from "../orders/orders.service.js";
import {
  PAYMENT_IDEMPOTENCY_SCOPE_PREFIX,
  PAYMENT_PROVIDER,
  PAYMENT_REQUEST_VERSION,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENT_TRANSACTION_TYPE,
  PAYMENT_WEBHOOK_STATUS,
  PAYMENTS_AUDIT_ACTION,
  PAYMENTS_ERROR_CODE,
  PAYMENTS_LIMITS,
  PAYMENTS_OUTBOX_EVENT,
  PAYMENTS_PERMISSION,
  PAYMENTS_RECONCILIATION_ERROR_CODE,
  PAYMENTS_RESOURCE_TYPE,
  STRIPE_PAYMENT_WEBHOOK_EVENT_VALUES,
} from "./payments.constants.js";
import {
  enqueuePaymentCaptureReconciliationJob,
  enqueuePaymentExpiryJob,
  enqueuePaymentRefundReconciliationJob,
} from "./payments.jobs.js";
import { PaymentsRepository } from "./payments.repository.js";
import {
  internalRefundBodySchema,
  paymentIntentResponseSchema,
  type AdminPaymentDetail,
  type AdminPaymentListItem,
  type AdminPaymentListQuery,
  type CustomerPaymentStatus,
  type InternalRefundInput,
  type PaymentIntentResponse,
  type PaymentStatus,
  type PaymentTransactionResponse,
} from "./payments.schema.js";

/** Runs one Payments database transaction and allows service tests to replace the real boundary. */
export type PaymentsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Narrow Administration dependency used only to enforce configured supported currencies. */
export interface PaymentsAdministrationIntegration {
  /** Returns true only when Administration currently allows the normalized currency. */
  isSupportedCurrency(currency: string): Promise<boolean>;
}

/** Narrow Orders service contract used by Payments without importing Orders persistence. */
export interface PaymentsOrdersIntegration {
  /** Returns the trusted immutable Order amount/state and Checkout-derived Payment deadline. */
  getPaymentSnapshot(context: RequestContext, orderId: string): Promise<OrderPaymentSnapshot>;

  /** Confirms one provider-authoritative capture using Module 11's replay-safe source boundary. */
  confirmPayment(
    context: RequestContext,
    orderId: string,
    input: {
      paymentId: string;
      paymentTransactionId: string;
      sourceKey: string;
      currency: string;
      capturedAmount: string;
      capturedAt: string;
    },
  ): Promise<unknown>;

  /** Lists overdue unpaid Orders, including Orders that do not yet have a Payment row. */
  listOverduePaymentOrderCandidates(
    context: RequestContext,
    limit: number,
  ): Promise<OverduePaymentOrderCandidate[]>;

  /** Expires one overdue unpaid Order and releases all remaining Inventory reservations. */
  expireUnpaidOrder(
    context: RequestContext,
    orderId: string,
    sourceKey: string,
  ): Promise<ExpireUnpaidOrderResult>;
}

/** Foundation idempotency dependency used by customer PaymentIntent creation. */
export interface PaymentsIdempotencyIntegration {
  /** Acquires, replays, or rejects one customer-scoped PaymentIntent retry key. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores one stable successful PaymentIntent response for exact replay. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Marks one failed in-progress PaymentIntent key so a safe retry may reacquire it. */
  fail(recordId: string): Promise<void>;
}

/** Small audit dependency used for sensitive Payment commands and reconciliation evidence. */
export interface PaymentsAuditIntegration {
  /** Appends one secret-redacted audit event. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Small outbox dependency used for durable Module 12 domain events. */
export interface PaymentsOutboxIntegration {
  /** Appends one event inside the current business transaction. */
  enqueue<TPayload>(event: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Queue boundary keeps BullMQ mechanics outside Payment business decisions. */
export interface PaymentsJobEnqueuer {
  /** Schedules Order-confirmation reconciliation for one already-captured Payment transaction. */
  enqueueCaptureReconciliation(paymentTransactionId: string): Promise<void>;

  /** Schedules provider reconciliation for one pending refund transaction. */
  enqueueRefundReconciliation(paymentTransactionId: string): Promise<void>;

  /** Schedules one unpaid Payment to be rechecked at the immutable Checkout deadline. */
  enqueueExpiry(paymentId: string, paymentExpiresAt: Date): Promise<void>;
}

/** Explicit dependencies keep the Payments service simple, testable, and framework-neutral. */
export interface PaymentsServiceDependencies {
  repository?: PaymentsRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => PaymentsRepository;
  transactionRunner?: PaymentsTransactionRunner;
  provider?: PaymentProviderAdapter;
  administration?: PaymentsAdministrationIntegration;
  orders?: PaymentsOrdersIntegration;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => PaymentsOrdersIntegration;
  idempotency?: PaymentsIdempotencyIntegration;
  audit?: PaymentsAuditIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => PaymentsAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => PaymentsOutboxIntegration;
  jobs?: PaymentsJobEnqueuer;
  currencyExponents?: Readonly<Record<string, number>>;
  now?: () => Date;
}

/** Paginated finance Payment list before the HTTP response envelope is added in Pass 5. */
export interface PaginatedAdminPaymentsResult {
  items: AdminPaymentListItem[];
  meta: PaginationMeta;
}

/** Small webhook result used by the future HTTP adapter without exposing raw provider payloads. */
export interface PaymentWebhookProcessResult {
  providerEventId: string;
  status: "processed" | "ignored" | "failed" | "processing";
}

/** Provider-authoritative capture facts consumed by Module 16 Commission settlement. */
export interface CommissionPaymentCaptureSnapshot {
  paymentId: string;
  paymentTransactionId: string;
  orderId: string;
  currency: string;
  capturedAmount: string;
  capturedAt: string;
}

/** Provider-authoritative refund facts consumed by Module 16 Commission reversal logic. */
export interface CommissionPaymentRefundSnapshot {
  paymentId: string;
  paymentTransactionId: string;
  orderId: string;
  currency: string;
  refundAmount: string;
  capturedAmount: string;
  refundedAt: string;
}

/** Provider-authoritative refundable balance exposed only to trusted Module 14 Return orchestration. */
export interface ReturnRefundPaymentSnapshot {
  paymentId: string;
  orderId: string;
  currency: string;
  amountCaptured: string;
  amountRefunded: string;
  refundableAmount: string;
}

/** Internal result returned while one verified webhook is processed transactionally. */
interface WebhookTransactionResult extends PaymentWebhookProcessResult {
  captureTransactionIdToReconcile?: string;
}

/** Exact fixed four-decimal scale used throughout the marketplace Payment ledger. */
const MONEY_SCALE_FACTOR = 10_000n;

/** Converts one canonical scale-4 money string into an exact integer without floating point. */
function moneyToScale4(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MONEY_SCALE_FACTOR + BigInt(`${fraction}0000`.slice(0, 4));
}

/** Converts one non-negative scale-4 integer back into the canonical four-decimal money format. */
function scale4ToMoney(value: bigint): string {
  const whole = value / MONEY_SCALE_FACTOR;
  const fraction = (value % MONEY_SCALE_FACTOR).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** Creates one lowercase SHA-256 hexadecimal digest for replay-safe internal identity. */
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Parses the already-validated JSON currency exponent map from runtime configuration. */
function parseCurrencyExponents(value: string): Readonly<Record<string, number>> {
  return JSON.parse(value) as Record<string, number>;
}

/** Creates one trusted system context for provider webhooks and background reconciliation jobs. */
function systemContext(requestId: string = randomUUID()): RequestContext {
  return {
    requestId,
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set([PAYMENTS_PERMISSION.SYSTEM_WEBHOOK]),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates one safe Module 12 error without exposing provider or database internals. */
function paymentsError(code: string, message: string, statusCode: number, cause?: unknown): AppError {
  return new AppError({ code, message, statusCode, ...(cause !== undefined ? { cause } : {}) });
}

/** Default BullMQ adapter keeps queue creation outside the business service implementation. */
const defaultJobs: PaymentsJobEnqueuer = {
  /** Enqueues capture reconciliation using the local capture transaction as the stable job identity. */
  async enqueueCaptureReconciliation(paymentTransactionId: string): Promise<void> {
    await enqueuePaymentCaptureReconciliationJob(paymentTransactionId);
  },

  /** Enqueues refund reconciliation using the local refund transaction as the stable job identity. */
  async enqueueRefundReconciliation(paymentTransactionId: string): Promise<void> {
    await enqueuePaymentRefundReconciliationJob(paymentTransactionId);
  },

  /** Enqueues delayed unpaid-Payment expiry at the immutable Checkout deadline. */
  async enqueueExpiry(paymentId: string, paymentExpiresAt: Date): Promise<void> {
    await enqueuePaymentExpiryJob(paymentId, paymentExpiresAt);
  },
};

/** Module 12 business service for provider-authoritative Payment, refund, webhook, and reconciliation state. */
export class PaymentsService {
  private readonly repository: PaymentsRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => PaymentsRepository;
  private readonly transactionRunner: PaymentsTransactionRunner;
  private readonly provider: PaymentProviderAdapter;
  private readonly administration: PaymentsAdministrationIntegration;
  private readonly orders: PaymentsOrdersIntegration;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => PaymentsOrdersIntegration;
  private readonly idempotency: PaymentsIdempotencyIntegration;
  private readonly audit: PaymentsAuditIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => PaymentsAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => PaymentsOutboxIntegration;
  private readonly jobs: PaymentsJobEnqueuer;
  private readonly currencyExponents: Readonly<Record<string, number>>;
  private readonly now: () => Date;

  /** Stores explicit dependencies while keeping default production composition straightforward. */
  constructor(dependencies: PaymentsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new PaymentsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ??
      ((transaction) => new PaymentsRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.provider = dependencies.provider ?? new StripePaymentProviderAdapter();
    this.administration = dependencies.administration ?? new AdministrationService();
    this.orders = dependencies.orders ?? new OrdersService();
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.audit = dependencies.audit ?? AuditService.using(db);
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.jobs = dependencies.jobs ?? defaultJobs;
    this.currencyExponents =
      dependencies.currencyExponents ?? parseCurrencyExponents(env.STRIPE_CURRENCY_EXPONENTS_JSON);
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Creates or reuses the owning customer's provider PaymentIntent with two-layer idempotency. */
  async createPaymentIntent(
    context: RequestContext,
    orderId: string,
    rawIdempotencyKey: string,
  ): Promise<PaymentIntentResponse> {
    this.requireCustomerContext(context);
    assertPermission(context, PAYMENTS_PERMISSION.READ_OWN);

    const normalizedKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    const snapshot = await this.orders.getPaymentSnapshot(context, orderId);
    const existingPayment = await this.repository.findPaymentForCustomer(orderId, context.actorId as string);
    const idempotency = await this.idempotency.begin(
      {
        scope: `${PAYMENT_IDEMPOTENCY_SCOPE_PREFIX}:${context.actorId}`,
        key: normalizedKey,
        requestHash: sha256(
          JSON.stringify({ version: PAYMENT_REQUEST_VERSION.INTENT, orderId }),
        ),
      },
      this.now(),
    );

    if (idempotency.mode === "replay") {
      return paymentIntentResponseSchema.parse(idempotency.replay.responseBody);
    }

    try {
      if (existingPayment && this.isCapturedOrRefunded(existingPayment.status)) {
        const response = this.toIntentResponse(existingPayment, snapshot, null);
        await this.idempotency.complete(idempotency.recordId, 200, response);
        return response;
      }

      await this.assertOrderCanAcceptIntent(snapshot);
      const amountMinor = this.toProviderMinorAmount(snapshot.grandTotal, snapshot.currency);
      const response = await this.createOrReuseProviderIntent(
        context,
        snapshot,
        normalizedKey,
        sha256(normalizedKey),
        amountMinor,
      );

      if (!this.isCapturedOrRefunded(response.status)) {
        await this.jobs.enqueueExpiry(response.paymentId, new Date(snapshot.paymentExpiresAt));
      }

      await this.idempotency.complete(idempotency.recordId, 200, response);
      return response;
    } catch (error) {
      await this.idempotency.fail(idempotency.recordId).catch(() => undefined);
      throw error;
    }
  }

  /** Returns provider-authoritative marketplace Payment state only for the owning customer. */
  async getCustomerPaymentStatus(
    context: RequestContext,
    orderId: string,
  ): Promise<CustomerPaymentStatus> {
    this.requireCustomerContext(context);
    assertPermission(context, PAYMENTS_PERMISSION.READ_OWN);

    const snapshot = await this.orders.getPaymentSnapshot(context, orderId);
    const payment = await this.repository.findPaymentForCustomer(orderId, context.actorId as string);
    if (!payment) throw this.paymentNotFound();

    const pendingRefundTotal = await this.repository.getPendingRefundTotal(payment.id);
    return this.toCustomerPaymentStatus(payment, snapshot.paymentExpiresAt, pendingRefundTotal);
  }

  /** Lists safe finance Payment summaries after platform permission enforcement. */
  async listAdminPayments(
    context: RequestContext,
    query: AdminPaymentListQuery,
  ): Promise<PaginatedAdminPaymentsResult> {
    this.requireAuthenticatedActor(context);
    assertPermission(context, PAYMENTS_PERMISSION.ADMIN_READ);

    const result = await this.repository.listAdminPayments(query);
    const items = await Promise.all(
      result.items.map(async (payment) => {
        const pendingRefundTotal = await this.repository.getPendingRefundTotal(payment.id);
        return this.toAdminPaymentListItem(payment, pendingRefundTotal);
      }),
    );

    return { items, meta: paginationMeta(query, result.totalItems) };
  }

  /** Returns one safe finance Payment detail and audits the sensitive read. */
  async getAdminPaymentDetail(
    context: RequestContext,
    paymentId: string,
  ): Promise<AdminPaymentDetail> {
    this.requireAuthenticatedActor(context);
    assertPermission(context, PAYMENTS_PERMISSION.ADMIN_READ);

    const payment = await this.repository.findPaymentById(paymentId);
    if (!payment) throw this.paymentNotFound();
    const [transactions, pendingRefundTotal] = await Promise.all([
      this.repository.listTransactionsByPaymentId(payment.id),
      this.repository.getPendingRefundTotal(payment.id),
    ]);

    await this.audit.record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: PAYMENTS_AUDIT_ACTION.ADMIN_DETAIL_READ,
      entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
      entityId: payment.id,
      requestId: context.requestId,
      metadata: { orderId: payment.orderId, provider: payment.provider },
    });

    return {
      ...this.toAdminPaymentListItem(payment, pendingRefundTotal),
      transactions: transactions.map((transaction) => this.toTransactionResponse(transaction)),
    };
  }

  /** Verifies, persists, and idempotently processes one Stripe webhook without trusting browser identity. */
  async processStripeWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<PaymentWebhookProcessResult> {
    const event = await this.verifyWebhook(rawBody, signature);
    const payloadHash = sha256(rawBody);
    const created = await this.repository.createWebhookEvent({
      provider: PAYMENT_PROVIDER.STRIPE,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payloadHash,
      receivedAt: this.now(),
    });
    const persisted =
      created ??
      (await this.repository.findWebhookEvent(PAYMENT_PROVIDER.STRIPE, event.providerEventId));

    if (!persisted) {
      throw paymentsError(ERROR_CODE.INTERNAL_ERROR, "Unable to persist Payment webhook state.", 500);
    }
    if (persisted.payloadHash !== payloadHash) {
      throw this.webhookInvalid("Webhook replay payload does not match the stored provider event.");
    }
    if (persisted.status === PAYMENT_WEBHOOK_STATUS.PROCESSED) {
      return { providerEventId: event.providerEventId, status: "processed" };
    }
    if (persisted.status === PAYMENT_WEBHOOK_STATUS.IGNORED) {
      return { providerEventId: event.providerEventId, status: "ignored" };
    }
    if (persisted.status === PAYMENT_WEBHOOK_STATUS.PROCESSING) {
      return { providerEventId: event.providerEventId, status: "processing" };
    }

    const result = await this.transactionRunner((transaction) =>
      this.processWebhookTransaction(transaction, persisted.id, event),
    );

    if (result.captureTransactionIdToReconcile) {
      try {
        await this.jobs.enqueueCaptureReconciliation(result.captureTransactionIdToReconcile);
      } catch (error) {
        throw paymentsError(
          ERROR_CODE.SERVICE_UNAVAILABLE,
          "Payment capture was recorded but reconciliation could not be queued.",
          503,
          error,
        );
      }
    }

    return {
      providerEventId: result.providerEventId,
      status: result.status,
    };
  }

  /** Returns the succeeded provider capture that authorizes Commission posting for one Order. */
  async getCommissionCapture(
    context: RequestContext,
    orderId: string,
  ): Promise<CommissionPaymentCaptureSnapshot> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw paymentsError(ERROR_CODE.FORBIDDEN, "Internal Commission Payment access is required.", 403);
    }

    const payment = await this.repository.findPaymentByOrderId(orderId);
    if (!payment) throw this.paymentNotFound();
    const transactions = await this.repository.listTransactionsByPaymentId(payment.id);
    const captures = transactions.filter(
      (transaction) =>
        transaction.type === PAYMENT_TRANSACTION_TYPE.CAPTURE &&
        transaction.status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    );
    if (captures.length !== 1) {
      throw this.providerError("Provider-authoritative capture history is not uniquely settled.");
    }
    const capture = captures[0];
    if (!capture || capture.amount !== payment.amountCaptured) {
      throw this.providerError("Captured Payment totals do not reconcile for Commission settlement.");
    }

    return {
      paymentId: payment.id,
      paymentTransactionId: capture.id,
      orderId: payment.orderId,
      currency: payment.currency,
      capturedAmount: capture.amount,
      capturedAt: capture.occurredAt.toISOString(),
    };
  }

  /** Returns the current provider-backed captured/refunded balance for trusted Module 14 refund preparation. */
  async getReturnRefundSnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<ReturnRefundPaymentSnapshot> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw paymentsError(ERROR_CODE.FORBIDDEN, "Internal Return Payment access is required.", 403);
    }

    const payment = await this.repository.findPaymentByOrderId(orderId);
    if (!payment) throw this.paymentNotFound();
    const pendingRefundTotal = await this.repository.getPendingRefundTotal(payment.id);
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      currency: payment.currency,
      amountCaptured: payment.amountCaptured,
      amountRefunded: payment.amountRefunded,
      refundableAmount: this.refundableAmount(payment, pendingRefundTotal),
    };
  }

  /** Returns one succeeded provider refund and its original captured amount for Commission adjustment. */
  async getCommissionRefund(
    context: RequestContext,
    orderId: string,
    paymentTransactionId: string,
  ): Promise<CommissionPaymentRefundSnapshot> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw paymentsError(ERROR_CODE.FORBIDDEN, "Internal Commission Payment access is required.", 403);
    }

    const transaction = await this.repository.findTransactionById(paymentTransactionId);
    if (
      !transaction ||
      transaction.type !== PAYMENT_TRANSACTION_TYPE.REFUND ||
      transaction.status !== PAYMENT_TRANSACTION_STATUS.SUCCEEDED
    ) {
      throw this.providerError("Commission refund source is not a succeeded provider refund.");
    }
    const payment = await this.repository.findPaymentById(transaction.paymentId);
    if (!payment || payment.orderId !== orderId) {
      throw this.providerError("Commission refund source does not belong to the requested Order.");
    }

    return {
      paymentId: payment.id,
      paymentTransactionId: transaction.id,
      orderId: payment.orderId,
      currency: payment.currency,
      refundAmount: transaction.amount,
      capturedAmount: payment.amountCaptured,
      refundedAt: transaction.occurredAt.toISOString(),
    };
  }

  /** Executes one trusted provider refund with exact pending-refund reservation and source-key replay safety. */
  async refundPayment(
    context: RequestContext,
    paymentId: string,
    input: InternalRefundInput,
  ): Promise<PaymentTransactionResponse> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw paymentsError(ERROR_CODE.FORBIDDEN, "Internal Payment refund access is required.", 403);
    }

    const validated = internalRefundBodySchema.safeParse(input);
    if (!validated.success) {
      throw paymentsError(ERROR_CODE.VALIDATION_FAILED, "Refund command is invalid.", 422);
    }

    const reserved = await this.reserveRefund(context, paymentId, validated.data);
    if (reserved.status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED) {
      return this.toTransactionResponse(reserved);
    }
    if (reserved.status === PAYMENT_TRANSACTION_STATUS.FAILED) {
      throw this.providerError("This refund source already has a failed provider result.");
    }

    const payment = await this.repository.findPaymentById(paymentId);
    if (!payment?.providerPaymentId) throw this.paymentNotFound();

    let providerRefund: ProviderRefund;
    try {
      providerRefund = reserved.providerTxnId
        ? await this.provider.retrieveRefund(reserved.providerTxnId)
        : await this.provider.createRefund({
            providerPaymentId: payment.providerPaymentId,
            amountMinor: this.toProviderMinorAmount(validated.data.amount, payment.currency),
            providerIdempotencyKey: this.refundProviderKey(payment.id, validated.data.sourceKey),
            ...(validated.data.providerReason
              ? { providerReason: validated.data.providerReason }
              : {}),
          });
    } catch (error) {
      await this.audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PAYMENTS_AUDIT_ACTION.RECONCILIATION_FAILED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
        entityId: reserved.id,
        requestId: context.requestId,
        metadata: {
          paymentId: payment.id,
          orderId: payment.orderId,
          kind: "refund-provider-call",
          errorCode: this.safeErrorCode(error),
        },
      });
      // Keep the reservation pending. A retry uses the same deterministic provider idempotency key.
      throw this.providerError("Payment provider refund could not be confirmed.", error);
    }

    const completed = await this.applyRefundProviderResult(
      context,
      payment.id,
      reserved.id,
      validated.data,
      providerRefund,
    );

    if (completed.status === PAYMENT_TRANSACTION_STATUS.PENDING) {
      try {
        await this.jobs.enqueueRefundReconciliation(completed.id);
      } catch (error) {
        throw paymentsError(
          ERROR_CODE.SERVICE_UNAVAILABLE,
          "Refund is pending but provider reconciliation could not be queued.",
          503,
          error,
        );
      }
    }

    if (completed.status === PAYMENT_TRANSACTION_STATUS.FAILED) {
      throw this.providerError("Payment provider rejected the refund.");
    }

    return this.toTransactionResponse(completed);
  }

  /** Rechecks one durable provider capture and retries the exact idempotent Orders confirmation source. */
  async reconcileCapture(paymentTransactionId: string): Promise<void> {
    const transaction = await this.repository.findTransactionById(paymentTransactionId);
    if (
      !transaction ||
      transaction.type !== PAYMENT_TRANSACTION_TYPE.CAPTURE ||
      transaction.status !== PAYMENT_TRANSACTION_STATUS.SUCCEEDED
    ) {
      throw this.providerError("Capture reconciliation source is invalid.");
    }

    const payment = await this.repository.findPaymentById(transaction.paymentId);
    if (!payment?.providerPaymentId) throw this.paymentNotFound();
    const providerIntent = await this.retrieveProviderPaymentIntent(payment.providerPaymentId);
    if (providerIntent.status !== "captured") {
      throw this.providerError("Provider no longer reports this Payment as captured.");
    }

    const context = systemContext();
    const snapshot = await this.orders.getPaymentSnapshot(context, payment.orderId);
    this.assertProviderIntentMatches(payment, snapshot, providerIntent);
    await this.orders.confirmPayment(context, payment.orderId, {
      paymentId: payment.id,
      paymentTransactionId: transaction.id,
      sourceKey: `payments:capture:${transaction.id}`,
      currency: payment.currency,
      capturedAmount: transaction.amount,
      capturedAt: transaction.occurredAt.toISOString(),
    });

    await this.transactionRunner(async (databaseTransaction) => {
      const repository = this.repositoryUsingTransaction(databaseTransaction);
      const audit = this.auditUsingTransaction(databaseTransaction);
      if (transaction.rawEventId) {
        await repository.markWebhookFinished(
          transaction.rawEventId,
          PAYMENT_WEBHOOK_STATUS.PROCESSED,
          this.now(),
        );
      }
      await audit.record({
        actorType: ACTOR_TYPE.SYSTEM,
        action: PAYMENTS_AUDIT_ACTION.RECONCILIATION_SUCCEEDED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
        entityId: transaction.id,
        requestId: context.requestId,
        metadata: { paymentId: payment.id, orderId: payment.orderId, kind: "capture" },
      });
    });
  }

  /** Rechecks one pending provider refund and applies only the provider-authoritative terminal result. */
  async reconcileRefund(paymentTransactionId: string): Promise<void> {
    const transaction = await this.repository.findTransactionById(paymentTransactionId);
    if (!transaction || transaction.type !== PAYMENT_TRANSACTION_TYPE.REFUND) {
      throw this.providerError("Refund reconciliation source is invalid.");
    }
    if (transaction.status !== PAYMENT_TRANSACTION_STATUS.PENDING) return;
    if (!transaction.providerTxnId) {
      throw this.providerError("Pending refund is missing its provider refund identity.");
    }

    const payment = await this.repository.findPaymentById(transaction.paymentId);
    if (!payment) throw this.paymentNotFound();
    const providerRefund = await this.retrieveProviderRefund(transaction.providerTxnId);
    const context = systemContext();
    const input: InternalRefundInput = {
      sourceKey: transaction.sourceKey ?? `payments:refund:${transaction.id}`,
      amount: transaction.amount,
      requestedByUserId: null,
    };
    const updated = await this.applyRefundProviderResult(
      context,
      payment.id,
      transaction.id,
      input,
      providerRefund,
    );

    if (updated.status === PAYMENT_TRANSACTION_STATUS.PENDING) {
      throw this.providerError("Provider refund is still pending.");
    }
    if (updated.status === PAYMENT_TRANSACTION_STATUS.FAILED) {
      throw this.providerError("Provider refund reconciliation finished as failed.");
    }
  }

  /** Scans overdue unpaid Orders and routes each candidate through the provider-aware Payment expiry path when needed. */
  async expireOverdueOrders(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw paymentsError(
        ERROR_CODE.VALIDATION_FAILED,
        "Payment maintenance batch size must be between 1 and 100.",
        422,
      );
    }

    const context = systemContext();
    const candidates = await this.orders.listOverduePaymentOrderCandidates(context, limit);

    for (const candidate of candidates) {
      const payment = await this.repository.findPaymentByOrderId(candidate.orderId);
      if (payment) {
        await this.expireUnpaidPayment(payment.id);
        continue;
      }

      await this.orders.expireUnpaidOrder(
        context,
        candidate.orderId,
        `payments:order-expiry:${candidate.orderId}`,
      );
    }

    return candidates.length;
  }

  /** Cancels one overdue active provider intent, marks local Payment cancelled, and expires its unpaid Order. */
  async expireUnpaidPayment(paymentId: string): Promise<void> {
    const payment = await this.repository.findPaymentById(paymentId);
    if (!payment) return;

    const context = systemContext();
    if (this.isCapturedOrRefunded(payment.status)) {
      if (payment.providerPaymentId) {
        const capture = await this.repository.findTransactionBySourceKey(
          `payments:provider-capture:${payment.providerPaymentId}`,
        );
        if (capture?.type === PAYMENT_TRANSACTION_TYPE.CAPTURE) {
          await this.reconcileCapture(capture.id);
        }
      }
      return;
    }

    const snapshot = await this.orders.getPaymentSnapshot(context, payment.orderId);
    if (this.now().getTime() < new Date(snapshot.paymentExpiresAt).getTime()) return;

    if (payment.providerPaymentId) {
      const providerIntent = await this.retrieveProviderPaymentIntent(payment.providerPaymentId);
      this.assertProviderIntentMatches(payment, snapshot, providerIntent);

      if (providerIntent.status === "captured") {
        await this.reconcileProviderCapture(payment.id, providerIntent, context);
        return;
      }

      if (providerIntent.status !== "cancelled") {
        try {
          const cancelled = await this.provider.cancelPaymentIntent({
            providerPaymentId: payment.providerPaymentId,
          });
          if (cancelled.status === "captured") {
            await this.reconcileProviderCapture(payment.id, cancelled, context);
            return;
          }
        } catch (error) {
          throw this.providerError("Unable to cancel the expired provider PaymentIntent.", error);
        }
      }
    }

    await this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const locked = await repository.lockPaymentById(payment.id);
      if (!locked || this.isCapturedOrRefunded(locked.status)) return;
      await repository.updatePaymentTotals({
        paymentId: locked.id,
        status: PAYMENT_STATUS.CANCELLED,
        updatedAt: this.now(),
      });
      await this.auditUsingTransaction(transaction).record({
        actorType: ACTOR_TYPE.SYSTEM,
        action: PAYMENTS_AUDIT_ACTION.PAYMENT_EXPIRED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        entityId: locked.id,
        requestId: context.requestId,
        before: { status: locked.status },
        after: { status: PAYMENT_STATUS.CANCELLED },
        metadata: { orderId: locked.orderId },
      });
    });

    await this.orders.expireUnpaidOrder(
      context,
      payment.orderId,
      `payments:expiry:${payment.id}`,
    );
  }

  /** Creates or reuses one active provider intent while serializing competing requests on the Payment row. */
  private async createOrReuseProviderIntent(
    context: RequestContext,
    snapshot: OrderPaymentSnapshot,
    normalizedKey: string,
    idempotencyKeyHash: string,
    amountMinor: string,
  ): Promise<PaymentIntentResponse> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      let payment = await repository.findPaymentByOrderId(snapshot.orderId);
      if (!payment) {
        payment = await repository.createPayment({
          orderId: snapshot.orderId,
          provider: PAYMENT_PROVIDER.STRIPE,
          currency: snapshot.currency,
          idempotencyKey: idempotencyKeyHash,
        });
        payment ??= await repository.findPaymentByOrderId(snapshot.orderId);
      }
      if (!payment) {
        throw paymentsError(ERROR_CODE.INTERNAL_ERROR, "Unable to create Payment state.", 500);
      }

      const locked = await repository.lockPaymentById(payment.id);
      if (!locked) throw this.paymentNotFound();
      if (this.isCapturedOrRefunded(locked.status)) {
        return this.toIntentResponse(locked, snapshot, null);
      }

      if (
        locked.providerPaymentId &&
        (locked.status === PAYMENT_STATUS.PENDING || locked.status === PAYMENT_STATUS.PROCESSING)
      ) {
        const current = await this.retrieveProviderPaymentIntent(locked.providerPaymentId);
        this.assertProviderIntentMatches(locked, snapshot, current);

        if (current.status === "captured") {
          throw paymentsError(
            PAYMENTS_ERROR_CODE.ALREADY_CAPTURED,
            "The provider already reports this Payment as captured; reconciliation is required.",
            409,
          );
        }

        if (current.status !== "cancelled") {
          const localStatus = current.status === "processing" ? PAYMENT_STATUS.PROCESSING : PAYMENT_STATUS.PENDING;
          const refreshed =
            localStatus === locked.status
              ? locked
              : (await repository.updatePaymentTotals({
                  paymentId: locked.id,
                  status: localStatus,
                  updatedAt: this.now(),
                })) ?? locked;
          return this.toIntentResponse(refreshed, snapshot, current.clientSecret);
        }

        if (locked.idempotencyKey === idempotencyKeyHash) {
          const cancelled =
            (await repository.updatePaymentTotals({
              paymentId: locked.id,
              status: PAYMENT_STATUS.CANCELLED,
              updatedAt: this.now(),
            })) ?? locked;
          return this.toIntentResponse(cancelled, snapshot, null);
        }
      }

      const providerIntent = await this.createProviderPaymentIntent({
        paymentId: locked.id,
        orderId: locked.orderId,
        currency: locked.currency,
        amountMinor,
        normalizedKey,
      });
      this.assertProviderIntentMatches(locked, snapshot, providerIntent, false);
      if (providerIntent.status === "captured") {
        throw this.providerError("A newly created automatic-capture intent unexpectedly returned captured.");
      }

      const nextStatus =
        providerIntent.status === "processing"
          ? PAYMENT_STATUS.PROCESSING
          : providerIntent.status === "cancelled"
            ? PAYMENT_STATUS.CANCELLED
            : PAYMENT_STATUS.PENDING;
      const attached = await repository.attachProviderPayment({
        paymentId: locked.id,
        providerPaymentId: providerIntent.providerPaymentId,
        idempotencyKeyHash,
        status: nextStatus,
        updatedAt: this.now(),
      });
      if (!attached) throw this.paymentNotFound();

      await repository.createTransaction({
        paymentId: attached.id,
        type: PAYMENT_TRANSACTION_TYPE.INTENT,
        providerTxnId: providerIntent.providerPaymentId,
        amount: snapshot.grandTotal,
        status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
        occurredAt: providerIntent.createdAt,
        sourceKey: `payments:intent:${providerIntent.providerPaymentId}`,
      });

      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PAYMENTS_AUDIT_ACTION.INTENT_CREATED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        entityId: attached.id,
        requestId: context.requestId,
        metadata: {
          orderId: attached.orderId,
          provider: attached.provider,
          providerPaymentId: attached.providerPaymentId,
        },
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: PAYMENTS_OUTBOX_EVENT.INTENT_CREATED,
        aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        aggregateId: attached.id,
        payload: {
          paymentId: attached.id,
          orderId: attached.orderId,
          provider: attached.provider,
          status: attached.status,
          currency: attached.currency,
          amount: snapshot.grandTotal,
        },
      });

      return this.toIntentResponse(attached, snapshot, providerIntent.clientSecret);
    });
  }

  /** Persists one trusted refund reservation so concurrent requests cannot oversubscribe captured funds. */
  private async reserveRefund(
    context: RequestContext,
    paymentId: string,
    input: InternalRefundInput,
  ): Promise<PaymentTransactionRow> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const payment = await repository.lockPaymentById(paymentId);
      if (!payment) throw this.paymentNotFound();
      if (!payment.providerPaymentId || !this.isCapturedOrRefunded(payment.status)) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.REFUND_AMOUNT_EXCEEDED,
          "Only captured funds can be refunded.",
          409,
        );
      }

      const existing = await repository.findTransactionBySourceKey(input.sourceKey);
      if (existing) {
        if (
          existing.paymentId !== payment.id ||
          existing.type !== PAYMENT_TRANSACTION_TYPE.REFUND ||
          existing.amount !== input.amount
        ) {
          throw paymentsError(
            ERROR_CODE.IDEMPOTENCY_CONFLICT,
            "Refund sourceKey was already used for another refund request.",
            409,
          );
        }
        return existing;
      }

      const pendingRefundTotal = await repository.getPendingRefundTotal(payment.id);
      const refundable = this.refundableAmount(payment, pendingRefundTotal);
      if (moneyToScale4(input.amount) > moneyToScale4(refundable)) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.REFUND_AMOUNT_EXCEEDED,
          "Refund exceeds the server-calculated refundable amount.",
          409,
        );
      }

      const refund = await repository.createTransaction({
        paymentId: payment.id,
        type: PAYMENT_TRANSACTION_TYPE.REFUND,
        amount: input.amount,
        status: PAYMENT_TRANSACTION_STATUS.PENDING,
        occurredAt: this.now(),
        sourceKey: input.sourceKey,
      });
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PAYMENTS_AUDIT_ACTION.REFUND_REQUESTED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
        entityId: refund.id,
        requestId: context.requestId,
        metadata: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: refund.amount,
          requestedByUserId: input.requestedByUserId ?? null,
          note: input.note ?? null,
        },
      });
      return refund;
    });
  }

  /** Applies one provider refund result while holding both the Payment and refund transaction locks. */
  private async applyRefundProviderResult(
    context: RequestContext,
    paymentId: string,
    transactionId: string,
    input: InternalRefundInput,
    providerRefund: ProviderRefund,
  ): Promise<PaymentTransactionRow> {
    return this.transactionRunner(async (databaseTransaction) => {
      const repository = this.repositoryUsingTransaction(databaseTransaction);
      const payment = await repository.lockPaymentById(paymentId);
      const refundTransaction = await repository.lockTransactionById(transactionId);
      if (!payment || !refundTransaction) throw this.paymentNotFound();
      if (refundTransaction.status !== PAYMENT_TRANSACTION_STATUS.PENDING) {
        return refundTransaction;
      }
      if (!payment.providerPaymentId || providerRefund.providerPaymentId !== payment.providerPaymentId) {
        throw this.providerError("Provider refund belongs to a different PaymentIntent.");
      }
      if (providerRefund.currency !== payment.currency) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.AMOUNT_MISMATCH,
          "Provider refund currency does not match the Payment currency.",
          409,
        );
      }
      const expectedMinor = this.toProviderMinorAmount(refundTransaction.amount, payment.currency);
      if (providerRefund.amountMinor !== expectedMinor) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.AMOUNT_MISMATCH,
          "Provider refund amount does not match the requested refund amount.",
          409,
        );
      }

      const updatedTransaction = await repository.updateTransactionResult({
        transactionId: refundTransaction.id,
        providerTxnId: providerRefund.providerRefundId,
        status:
          providerRefund.status === "succeeded"
            ? PAYMENT_TRANSACTION_STATUS.SUCCEEDED
            : providerRefund.status === "failed"
              ? PAYMENT_TRANSACTION_STATUS.FAILED
              : PAYMENT_TRANSACTION_STATUS.PENDING,
        occurredAt: providerRefund.createdAt,
        updatedAt: this.now(),
      });
      if (!updatedTransaction) throw this.paymentNotFound();

      if (providerRefund.status === "pending") return updatedTransaction;

      const audit = this.auditUsingTransaction(databaseTransaction);
      if (providerRefund.status === "failed") {
        await audit.record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PAYMENTS_AUDIT_ACTION.REFUND_FAILED,
          entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
          entityId: updatedTransaction.id,
          requestId: context.requestId,
          metadata: {
            paymentId: payment.id,
            orderId: payment.orderId,
            amount: updatedTransaction.amount,
            requestedByUserId: input.requestedByUserId ?? null,
          },
        });
        return updatedTransaction;
      }

      const nextRefunded = moneyToScale4(payment.amountRefunded) + moneyToScale4(updatedTransaction.amount);
      const captured = moneyToScale4(payment.amountCaptured);
      if (nextRefunded > captured) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.REFUND_AMOUNT_EXCEEDED,
          "Provider refund would exceed the captured Payment amount.",
          409,
        );
      }
      const amountRefunded = scale4ToMoney(nextRefunded);
      const paymentStatus = nextRefunded === captured ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
      const updatedPayment = await repository.updatePaymentTotals({
        paymentId: payment.id,
        status: paymentStatus,
        amountRefunded,
        updatedAt: this.now(),
      });
      if (!updatedPayment) throw this.paymentNotFound();

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PAYMENTS_AUDIT_ACTION.REFUND_COMPLETED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
        entityId: updatedTransaction.id,
        requestId: context.requestId,
        before: { amountRefunded: payment.amountRefunded, status: payment.status },
        after: { amountRefunded: updatedPayment.amountRefunded, status: updatedPayment.status },
        metadata: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: updatedTransaction.amount,
          requestedByUserId: input.requestedByUserId ?? null,
        },
      });
      await this.outboxUsingTransaction(databaseTransaction).enqueue({
        eventType: PAYMENTS_OUTBOX_EVENT.REFUNDED,
        aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          paymentTransactionId: updatedTransaction.id,
          status: updatedPayment.status,
          currency: payment.currency,
          refundedAmount: updatedTransaction.amount,
          amountRefunded: updatedPayment.amountRefunded,
        },
      });
      return updatedTransaction;
    });
  }

  /** Processes one previously verified webhook inside explicit Payment/Order transaction boundaries. */
  private async processWebhookTransaction(
    transaction: DatabaseTransaction,
    webhookId: string,
    event: VerifiedProviderWebhookEvent,
  ): Promise<WebhookTransactionResult> {
    const repository = this.repositoryUsingTransaction(transaction);
    const webhook = await repository.lockWebhookEvent(webhookId);
    if (!webhook) {
      throw paymentsError(ERROR_CODE.INTERNAL_ERROR, "Payment webhook state was not found.", 500);
    }
    if (webhook.status === PAYMENT_WEBHOOK_STATUS.PROCESSED) {
      return { providerEventId: event.providerEventId, status: "processed" };
    }
    if (webhook.status === PAYMENT_WEBHOOK_STATUS.IGNORED) {
      return { providerEventId: event.providerEventId, status: "ignored" };
    }

    await repository.markWebhookProcessing(webhook.id);
    if (!(STRIPE_PAYMENT_WEBHOOK_EVENT_VALUES as readonly string[]).includes(event.eventType)) {
      await repository.markWebhookFinished(webhook.id, PAYMENT_WEBHOOK_STATUS.IGNORED, this.now());
      return { providerEventId: event.providerEventId, status: "ignored" };
    }

    if (!event.paymentIntent) {
      return this.failWebhookProcessing(
        transaction,
        webhook,
        event,
        PAYMENTS_ERROR_CODE.PROVIDER_ERROR,
      );
    }

    try {
      if (event.eventType === "payment_intent.succeeded") {
        return this.applySucceededWebhook(transaction, webhook, event, event.paymentIntent);
      }

      return this.applyNonCaptureWebhook(transaction, webhook, event, event.paymentIntent);
    } catch (error) {
      if (!isAppError(error)) throw error;
      return this.failWebhookProcessing(transaction, webhook, event, error.code);
    }
  }

  /** Applies processing/failed/cancelled webhook state without ever inventing captured money. */
  private async applyNonCaptureWebhook(
    transaction: DatabaseTransaction,
    webhook: PaymentWebhookEventRow,
    event: VerifiedProviderWebhookEvent,
    providerIntent: ProviderPaymentIntent,
  ): Promise<WebhookTransactionResult> {
    const repository = this.repositoryUsingTransaction(transaction);
    const payment = await repository.lockPaymentByProviderPaymentId(providerIntent.providerPaymentId);
    if (!payment) throw this.paymentNotFound();
    const context = systemContext(webhook.id);
    const snapshot = await this.ordersUsingTransaction(transaction).getPaymentSnapshot(
      context,
      payment.orderId,
    );
    this.assertProviderIntentMatches(payment, snapshot, providerIntent);

    if (this.isCapturedOrRefunded(payment.status)) {
      await repository.markWebhookFinished(webhook.id, PAYMENT_WEBHOOK_STATUS.PROCESSED, this.now());
      return { providerEventId: event.providerEventId, status: "processed" };
    }

    const nextStatus =
      event.eventType === "payment_intent.processing"
        ? PAYMENT_STATUS.PROCESSING
        : event.eventType === "payment_intent.canceled"
          ? PAYMENT_STATUS.CANCELLED
          : PAYMENT_STATUS.FAILED;
    await repository.updatePaymentTotals({
      paymentId: payment.id,
      status: nextStatus,
      updatedAt: this.now(),
    });

    if (event.eventType !== "payment_intent.processing") {
      const sourceKey = `payments:webhook:${event.providerEventId}:failure`;
      const existingFailure = await repository.findTransactionBySourceKey(sourceKey);
      if (!existingFailure) {
        await repository.createTransaction({
          paymentId: payment.id,
          type: PAYMENT_TRANSACTION_TYPE.FAILURE,
          amount: "0.0000",
          status: PAYMENT_TRANSACTION_STATUS.FAILED,
          occurredAt: event.occurredAt,
          rawEventId: webhook.id,
          sourceKey,
        });
      }
    }

    if (event.eventType === "payment_intent.payment_failed") {
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: PAYMENTS_OUTBOX_EVENT.FAILED,
        aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          status: PAYMENT_STATUS.FAILED,
          currency: payment.currency,
        },
      });
    }

    await repository.markWebhookFinished(webhook.id, PAYMENT_WEBHOOK_STATUS.PROCESSED, this.now());
    return { providerEventId: event.providerEventId, status: "processed" };
  }

  /** Applies one exact provider capture and uses a nested savepoint so Order failure cannot roll back provider truth. */
  private async applySucceededWebhook(
    transaction: DatabaseTransaction,
    webhook: PaymentWebhookEventRow,
    event: VerifiedProviderWebhookEvent,
    providerIntent: ProviderPaymentIntent,
  ): Promise<WebhookTransactionResult> {
    const repository = this.repositoryUsingTransaction(transaction);
    const payment = await repository.lockPaymentByProviderPaymentId(providerIntent.providerPaymentId);
    if (!payment) throw this.paymentNotFound();
    const context = systemContext(webhook.id);
    const snapshot = await this.ordersUsingTransaction(transaction).getPaymentSnapshot(
      context,
      payment.orderId,
    );
    this.assertProviderIntentMatches(payment, snapshot, providerIntent);

    const captureSourceKey = `payments:provider-capture:${providerIntent.providerPaymentId}`;
    let captureTransaction = await repository.findTransactionBySourceKey(captureSourceKey);
    let createdCapture = false;

    if (!captureTransaction) {
      if (moneyToScale4(payment.amountCaptured) > 0n && payment.status !== PAYMENT_STATUS.CAPTURED) {
        throw paymentsError(
          PAYMENTS_ERROR_CODE.ALREADY_CAPTURED,
          "Payment already contains captured money from another source.",
          409,
        );
      }
      if (this.isCapturedOrRefunded(payment.status)) {
        const providerMatch = providerIntent.providerTransactionId
          ? await repository.findTransactionByProviderTxnId(providerIntent.providerTransactionId)
          : null;
        if (!providerMatch || providerMatch.paymentId !== payment.id) {
          throw paymentsError(
            PAYMENTS_ERROR_CODE.ALREADY_CAPTURED,
            "Payment was already captured by another provider source.",
            409,
          );
        }
        captureTransaction = providerMatch;
      } else {
        captureTransaction = await repository.createTransaction({
          paymentId: payment.id,
          type: PAYMENT_TRANSACTION_TYPE.CAPTURE,
          providerTxnId: providerIntent.providerTransactionId,
          amount: snapshot.grandTotal,
          status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
          occurredAt: event.occurredAt,
          rawEventId: webhook.id,
          sourceKey: captureSourceKey,
        });
        createdCapture = true;
      }
    }

    if (!captureTransaction) {
      throw paymentsError(ERROR_CODE.INTERNAL_ERROR, "Capture transaction could not be resolved.", 500);
    }

    if (
      captureTransaction.paymentId !== payment.id ||
      captureTransaction.type !== PAYMENT_TRANSACTION_TYPE.CAPTURE ||
      captureTransaction.amount !== snapshot.grandTotal ||
      captureTransaction.status !== PAYMENT_TRANSACTION_STATUS.SUCCEEDED
    ) {
      throw paymentsError(
        PAYMENTS_ERROR_CODE.ALREADY_CAPTURED,
        "Existing capture identity does not match this provider capture.",
        409,
      );
    }

    const capturedPayment =
      this.isCapturedOrRefunded(payment.status) && payment.amountCaptured === snapshot.grandTotal
        ? payment
        : await repository.updatePaymentTotals({
            paymentId: payment.id,
            status: PAYMENT_STATUS.CAPTURED,
            amountAuthorized: snapshot.grandTotal,
            amountCaptured: snapshot.grandTotal,
            updatedAt: this.now(),
          });
    if (!capturedPayment) throw this.paymentNotFound();

    if (createdCapture) {
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: PAYMENTS_OUTBOX_EVENT.CAPTURED,
        aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          paymentTransactionId: captureTransaction.id,
          status: PAYMENT_STATUS.CAPTURED,
          currency: payment.currency,
          capturedAmount: snapshot.grandTotal,
          capturedAt: captureTransaction.occurredAt.toISOString(),
        },
      });
    }

    try {
      await transaction.transaction(async (savepoint) => {
        await this.ordersUsingTransaction(savepoint).confirmPayment(context, payment.orderId, {
          paymentId: payment.id,
          paymentTransactionId: captureTransaction.id,
          sourceKey: `payments:capture:${captureTransaction.id}`,
          currency: payment.currency,
          capturedAmount: captureTransaction.amount,
          capturedAt: captureTransaction.occurredAt.toISOString(),
        });
      });
    } catch {
      await repository.markWebhookFailed(
        webhook.id,
        PAYMENTS_RECONCILIATION_ERROR_CODE.ORDER_CONFIRMATION_FAILED,
        this.now(),
      );
      await this.recordWebhookFailure(
        transaction,
        webhook.id,
        payment,
        PAYMENTS_RECONCILIATION_ERROR_CODE.ORDER_CONFIRMATION_FAILED,
        captureTransaction.id,
      );
      return {
        providerEventId: event.providerEventId,
        status: "failed",
        captureTransactionIdToReconcile: captureTransaction.id,
      };
    }

    await repository.markWebhookFinished(webhook.id, PAYMENT_WEBHOOK_STATUS.PROCESSED, this.now());
    return { providerEventId: event.providerEventId, status: "processed" };
  }

  /** Marks one verified webhook failed and writes durable audit/outbox evidence without leaking payload bytes. */
  private async failWebhookProcessing(
    transaction: DatabaseTransaction,
    webhook: PaymentWebhookEventRow,
    event: VerifiedProviderWebhookEvent,
    errorCode: string,
  ): Promise<WebhookTransactionResult> {
    const repository = this.repositoryUsingTransaction(transaction);
    await repository.markWebhookFailed(webhook.id, errorCode, this.now());
    const payment = event.paymentIntent
      ? await repository.findPaymentByProviderPaymentId(event.paymentIntent.providerPaymentId)
      : null;
    await this.recordWebhookFailure(transaction, webhook.id, payment, errorCode, null);
    return { providerEventId: event.providerEventId, status: "failed" };
  }

  /** Writes one shared webhook-failure audit/outbox record inside the current transaction. */
  private async recordWebhookFailure(
    transaction: DatabaseTransaction,
    webhookId: string,
    payment: PaymentRow | null,
    errorCode: string,
    captureTransactionId: string | null,
  ): Promise<void> {
    await this.auditUsingTransaction(transaction).record({
      actorType: ACTOR_TYPE.SYSTEM,
      action: PAYMENTS_AUDIT_ACTION.WEBHOOK_FAILED,
      entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_WEBHOOK,
      entityId: webhookId,
      requestId: webhookId,
      metadata: {
        paymentId: payment?.id ?? null,
        orderId: payment?.orderId ?? null,
        captureTransactionId,
        errorCode,
      },
    });
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: PAYMENTS_OUTBOX_EVENT.WEBHOOK_FAILED,
      aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT_WEBHOOK,
      aggregateId: webhookId,
      payload: {
        webhookEventId: webhookId,
        paymentId: payment?.id ?? null,
        orderId: payment?.orderId ?? null,
        captureTransactionId,
        errorCode,
      },
    });
  }

  /** Reconciles a captured provider intent discovered by expiry/background retrieval without browser authority. */
  private async reconcileProviderCapture(
    paymentId: string,
    providerIntent: ProviderPaymentIntent,
    context: RequestContext,
  ): Promise<void> {
    const captureTransaction = await this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const payment = await repository.lockPaymentById(paymentId);
      if (!payment) throw this.paymentNotFound();
      const snapshot = await this.ordersUsingTransaction(transaction).getPaymentSnapshot(
        context,
        payment.orderId,
      );
      this.assertProviderIntentMatches(payment, snapshot, providerIntent);
      if (providerIntent.status !== "captured") {
        throw this.providerError("Reconciliation source is not provider-captured.");
      }

      const sourceKey = `payments:provider-capture:${providerIntent.providerPaymentId}`;
      let capture = await repository.findTransactionBySourceKey(sourceKey);
      if (!capture) {
        capture = await repository.createTransaction({
          paymentId: payment.id,
          type: PAYMENT_TRANSACTION_TYPE.CAPTURE,
          providerTxnId: providerIntent.providerTransactionId,
          amount: snapshot.grandTotal,
          status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
          occurredAt: providerIntent.createdAt,
          sourceKey,
        });
        await this.outboxUsingTransaction(transaction).enqueue({
          eventType: PAYMENTS_OUTBOX_EVENT.CAPTURED,
          aggregateType: PAYMENTS_RESOURCE_TYPE.PAYMENT,
          aggregateId: payment.id,
          payload: {
            paymentId: payment.id,
            orderId: payment.orderId,
            paymentTransactionId: capture.id,
            status: PAYMENT_STATUS.CAPTURED,
            currency: payment.currency,
            capturedAmount: snapshot.grandTotal,
            capturedAt: capture.occurredAt.toISOString(),
          },
        });
      }
      await repository.updatePaymentTotals({
        paymentId: payment.id,
        status: PAYMENT_STATUS.CAPTURED,
        amountAuthorized: snapshot.grandTotal,
        amountCaptured: snapshot.grandTotal,
        updatedAt: this.now(),
      });
      return capture;
    });

    try {
      await this.orders.confirmPayment(context, providerIntent.metadata.orderId, {
        paymentId,
        paymentTransactionId: captureTransaction.id,
        sourceKey: `payments:capture:${captureTransaction.id}`,
        currency: providerIntent.currency,
        capturedAmount: captureTransaction.amount,
        capturedAt: captureTransaction.occurredAt.toISOString(),
      });
    } catch (error) {
      await this.audit.record({
        actorType: ACTOR_TYPE.SYSTEM,
        action: PAYMENTS_AUDIT_ACTION.RECONCILIATION_FAILED,
        entityType: PAYMENTS_RESOURCE_TYPE.PAYMENT_TRANSACTION,
        entityId: captureTransaction.id,
        requestId: context.requestId,
        metadata: { paymentId, kind: "capture", errorCode: this.safeErrorCode(error) },
      });
      await this.jobs.enqueueCaptureReconciliation(captureTransaction.id);
    }
  }

  /** Creates one provider PaymentIntent and maps all provider exceptions to the stable Payment error code. */
  private async createProviderPaymentIntent(input: {
    paymentId: string;
    orderId: string;
    currency: string;
    amountMinor: string;
    normalizedKey: string;
  }): Promise<ProviderPaymentIntent> {
    try {
      return await this.provider.createPaymentIntent({
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerIdempotencyKey: `mkt_pi_${sha256(
          `${PAYMENT_REQUEST_VERSION.INTENT}|${input.paymentId}|${input.normalizedKey}`,
        )}`,
        metadata: { paymentId: input.paymentId, orderId: input.orderId },
      });
    } catch (error) {
      throw this.providerError("Unable to create the provider PaymentIntent.", error);
    }
  }

  /** Retrieves one provider PaymentIntent while hiding provider-specific exceptions from business callers. */
  private async retrieveProviderPaymentIntent(providerPaymentId: string): Promise<ProviderPaymentIntent> {
    try {
      return await this.provider.retrievePaymentIntent(providerPaymentId);
    } catch (error) {
      throw this.providerError("Unable to retrieve the provider PaymentIntent.", error);
    }
  }

  /** Retrieves one provider Refund while hiding provider-specific exceptions from business callers. */
  private async retrieveProviderRefund(providerRefundId: string): Promise<ProviderRefund> {
    try {
      return await this.provider.retrieveRefund(providerRefundId);
    } catch (error) {
      throw this.providerError("Unable to retrieve the provider refund.", error);
    }
  }

  /** Verifies Stripe's signature before any untrusted payload is persisted or interpreted. */
  private async verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<VerifiedProviderWebhookEvent> {
    if (!signature.trim()) throw this.webhookInvalid("Stripe signature is required.");
    try {
      return await this.provider.verifyAndParseWebhook(rawBody, signature.trim());
    } catch (error) {
      throw this.webhookInvalid("Stripe webhook signature or payload is invalid.", error);
    }
  }

  /** Ensures one customer actor exists before any customer-owned Payment operation is attempted. */
  private requireCustomerContext(context: RequestContext): void {
    if (context.actorType !== ACTOR_TYPE.CUSTOMER || !context.actorId) {
      throw paymentsError(ERROR_CODE.FORBIDDEN, "Customer Payment access is required.", 403);
    }
  }

  /** Ensures one non-system actor is authenticated before privileged finance reads. */
  private requireAuthenticatedActor(context: RequestContext): void {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw paymentsError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
  }

  /** Trims and validates one customer idempotency key without ever persisting the raw value. */
  private normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > PAYMENTS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw paymentsError(ERROR_CODE.VALIDATION_FAILED, "Idempotency-Key is invalid.", 422);
    }
    return normalized;
  }

  /** Enforces immutable Order state, item quantity, deadline, Administration currency, and provider representation. */
  private async assertOrderCanAcceptIntent(snapshot: OrderPaymentSnapshot): Promise<void> {
    if (
      snapshot.orderStatus !== ORDER_STATUS.PENDING_PAYMENT ||
      snapshot.paymentStatus !== ORDER_PAYMENT_STATUS.PENDING ||
      snapshot.remainingItemQuantity <= 0
    ) {
      throw paymentsError(ERROR_CODE.CONFLICT, "This Order is not payable.", 409);
    }
    if (this.now().getTime() >= new Date(snapshot.paymentExpiresAt).getTime()) {
      throw paymentsError(
        PAYMENTS_ERROR_CODE.WINDOW_EXPIRED,
        "The Payment window has expired.",
        409,
      );
    }
    if (!(await this.administration.isSupportedCurrency(snapshot.currency))) {
      throw this.providerError("Order currency is not enabled for marketplace Payments.");
    }
    this.toProviderMinorAmount(snapshot.grandTotal, snapshot.currency);
  }

  /** Converts exact scale-4 marketplace money into exact provider minor units using configured currency exponent. */
  private toProviderMinorAmount(amount: string, currency: string): string {
    const exponent = this.currencyExponents[currency];
    if (typeof exponent !== "number" || !Number.isInteger(exponent) || exponent < 0) {
      throw this.providerError("Payment currency is not configured for the Stripe provider.");
    }

    const scale4 = moneyToScale4(amount);
    if (exponent <= 4) {
      const divisor = 10n ** BigInt(4 - exponent);
      if (scale4 % divisor !== 0n) {
        throw this.providerError("Payment amount cannot be represented exactly in provider minor units.");
      }
      return (scale4 / divisor).toString();
    }

    return (scale4 * 10n ** BigInt(exponent - 4)).toString();
  }

  /** Verifies provider identity, metadata, currency, and exact amount against immutable marketplace state. */
  private assertProviderIntentMatches(
    payment: PaymentRow,
    snapshot: OrderPaymentSnapshot,
    providerIntent: ProviderPaymentIntent,
    requireCurrentProviderId = true,
  ): void {
    if (
      (requireCurrentProviderId && payment.providerPaymentId !== providerIntent.providerPaymentId) ||
      providerIntent.metadata.paymentId !== payment.id ||
      providerIntent.metadata.orderId !== payment.orderId ||
      providerIntent.metadata.orderId !== snapshot.orderId
    ) {
      throw this.providerError("Provider PaymentIntent identity does not match marketplace Payment state.");
    }
    if (providerIntent.currency !== payment.currency || payment.currency !== snapshot.currency) {
      throw paymentsError(
        PAYMENTS_ERROR_CODE.AMOUNT_MISMATCH,
        "Provider currency does not match the immutable Order currency.",
        409,
      );
    }
    const expectedMinor = this.toProviderMinorAmount(snapshot.grandTotal, snapshot.currency);
    if (providerIntent.amountMinor !== expectedMinor) {
      throw paymentsError(
        PAYMENTS_ERROR_CODE.AMOUNT_MISMATCH,
        "Provider amount does not match the immutable Order total.",
        409,
      );
    }
  }

  /** Builds the deterministic provider idempotency key for one trusted refund source. */
  private refundProviderKey(paymentId: string, sourceKey: string): string {
    return `mkt_re_${sha256(`${PAYMENT_REQUEST_VERSION.REFUND}|${paymentId}|${sourceKey}`)}`;
  }

  /** Calculates available refundable funds after successful and still-pending provider refunds. */
  private refundableAmount(payment: PaymentRow, pendingRefundTotal: string): string {
    const captured = moneyToScale4(payment.amountCaptured);
    const refunded = moneyToScale4(payment.amountRefunded);
    const pending = moneyToScale4(pendingRefundTotal);
    const available = captured - refunded - pending;
    return scale4ToMoney(available > 0n ? available : 0n);
  }

  /** Returns true for statuses where provider-captured money must never receive a replacement intent. */
  private isCapturedOrRefunded(status: string): boolean {
    return (
      status === PAYMENT_STATUS.CAPTURED ||
      status === PAYMENT_STATUS.PARTIALLY_REFUNDED ||
      status === PAYMENT_STATUS.REFUNDED
    );
  }

  /** Converts one Payment row and trusted Order deadline into the safe intent response. */
  private toIntentResponse(
    payment: PaymentRow,
    snapshot: OrderPaymentSnapshot,
    clientSecret: string | null,
  ): PaymentIntentResponse {
    if (!payment.providerPaymentId) {
      throw this.providerError("Payment is missing its provider PaymentIntent identity.");
    }
    return paymentIntentResponseSchema.parse({
      paymentId: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      status: payment.status,
      currency: payment.currency,
      amount: snapshot.grandTotal,
      paymentExpiresAt: snapshot.paymentExpiresAt,
      clientSecret: this.isCapturedOrRefunded(payment.status) ? null : clientSecret,
    });
  }

  /** Converts one Payment row into the customer-safe status contract with server-calculated refundable funds. */
  private toCustomerPaymentStatus(
    payment: PaymentRow,
    paymentExpiresAt: string,
    pendingRefundTotal: string,
  ): CustomerPaymentStatus {
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      provider: payment.provider as "stripe",
      status: payment.status as PaymentStatus,
      currency: payment.currency,
      amountAuthorized: payment.amountAuthorized,
      amountCaptured: payment.amountCaptured,
      amountRefunded: payment.amountRefunded,
      refundableAmount: this.refundableAmount(payment, pendingRefundTotal),
      providerPaymentId: payment.providerPaymentId,
      paymentExpiresAt,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }

  /** Converts one Payment row into the finance list/detail contract without secret fields. */
  private toAdminPaymentListItem(
    payment: PaymentRow,
    pendingRefundTotal: string,
  ): AdminPaymentListItem {
    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      provider: payment.provider as "stripe",
      status: payment.status as PaymentStatus,
      currency: payment.currency,
      amountAuthorized: payment.amountAuthorized,
      amountCaptured: payment.amountCaptured,
      amountRefunded: payment.amountRefunded,
      refundableAmount: this.refundableAmount(payment, pendingRefundTotal),
      providerPaymentId: payment.providerPaymentId,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }

  /** Converts one persisted Payment transaction into the safe API-neutral timeline shape. */
  private toTransactionResponse(transaction: PaymentTransactionRow): PaymentTransactionResponse {
    return {
      id: transaction.id,
      type: transaction.type as PaymentTransactionResponse["type"],
      providerTxnId: transaction.providerTxnId,
      amount: transaction.amount,
      status: transaction.status as PaymentTransactionResponse["status"],
      occurredAt: transaction.occurredAt.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    };
  }

  /** Maps unknown provider failures into the stable safe PAYMENT_PROVIDER_ERROR envelope. */
  private providerError(message: string, cause?: unknown): AppError {
    return paymentsError(PAYMENTS_ERROR_CODE.PROVIDER_ERROR, message, 502, cause);
  }

  /** Creates the stable missing-Payment error without exposing unauthorized resource existence details. */
  private paymentNotFound(): AppError {
    return paymentsError(PAYMENTS_ERROR_CODE.NOT_FOUND, "Payment was not found.", 404);
  }

  /** Creates the stable invalid-webhook error used only before a webhook payload is trusted. */
  private webhookInvalid(message: string, cause?: unknown): AppError {
    return paymentsError(PAYMENTS_ERROR_CODE.WEBHOOK_INVALID, message, 400, cause);
  }

  /** Reduces unknown reconciliation failures to a safe stable code for audit metadata. */
  private safeErrorCode(error: unknown): string {
    return isAppError(error) ? error.code : PAYMENTS_RECONCILIATION_ERROR_CODE.WEBHOOK_PROCESSING_FAILED;
  }
}

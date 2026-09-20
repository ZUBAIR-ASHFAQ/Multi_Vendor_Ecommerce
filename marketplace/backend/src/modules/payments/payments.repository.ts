import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import { orders } from "../../database/schema/orders.js";
import {
  payments,
  paymentTransactions,
  paymentWebhookEvents,
  type PaymentRow,
  type PaymentTransactionRow,
  type PaymentWebhookEventRow,
} from "../../database/schema/payments.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  PAYMENT_TRANSACTION_TYPE,
  PAYMENT_WEBHOOK_STATUS,
} from "./payments.constants.js";
import type {
  AdminPaymentListQuery,
  PaymentProvider,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from "./payments.schema.js";

/** Fields the Payment service has already validated before creating one aggregate. */
export interface CreatePaymentRecordInput {
  orderId: string;
  provider: PaymentProvider;
  currency: string;
  idempotencyKey: string;
  status?: PaymentStatus;
}

/** Provider identity assigned after the external intent is created successfully. */
export interface AttachProviderPaymentInput {
  paymentId: string;
  providerPaymentId: string;
  idempotencyKeyHash: string;
  status: PaymentStatus;
  updatedAt?: Date;
}

/** One append-only provider/payment lifecycle transaction approved by the service. */
export interface CreatePaymentTransactionInput {
  paymentId: string;
  type: PaymentTransactionType;
  providerTxnId?: string | null;
  amount: string;
  status: PaymentTransactionStatus;
  occurredAt: Date;
  rawEventId?: string | null;
  sourceKey?: string | null;
}

/** Provider result fields that may change on a previously reserved transaction row. */
export interface UpdatePaymentTransactionResultInput {
  transactionId: string;
  providerTxnId?: string | null;
  status: PaymentTransactionStatus;
  occurredAt?: Date;
  updatedAt?: Date;
}

/** One verified provider event envelope after signature parsing but before business processing. */
export interface CreateWebhookEventInput {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  receivedAt?: Date;
}

/** Service-approved Payment monetary/status totals written while the aggregate is locked. */
export interface UpdatePaymentTotalsInput {
  paymentId: string;
  status: PaymentStatus;
  amountAuthorized?: string;
  amountCaptured?: string;
  amountRefunded?: string;
  updatedAt?: Date;
}

/** Paginated Payment rows returned only to the finance service layer. */
export interface PaginatedPaymentRows {
  items: PaymentRow[];
  totalItems: number;
}

/** Combines optional repository filters without leaking undefined clauses into Drizzle. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length > 0 ? and(...active) : undefined;
}

/** Builds the allow-listed finance sort expression from validated query input. */
function adminPaymentSort(query: AdminPaymentListQuery) {
  const column = query.sort === "updatedAt" ? payments.updatedAt : payments.createdAt;
  return query.order === "asc" ? asc(column) : desc(column);
}

/** Drizzle-only persistence boundary for Module 12 Payments. */
export class PaymentsRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): PaymentsRepository {
    return new PaymentsRepository(executor);
  }

  /** Creates one Payment aggregate, or returns null when another request already created it. */
  async createPayment(input: CreatePaymentRecordInput): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .insert(payments)
      .values({
        orderId: input.orderId,
        provider: input.provider,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        status: input.status ?? PAYMENT_STATUS.PENDING,
      })
      .onConflictDoNothing({ target: payments.orderId })
      .returning();

    return row ?? null;
  }

  /** Finds the single Payment aggregate attached to one immutable Order. */
  async findPaymentByOrderId(orderId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1);
    return row ?? null;
  }

  /** Finds one Payment by provider intent/payment ID for verified webhook processing. */
  async findPaymentByProviderPaymentId(providerPaymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select()
      .from(payments)
      .where(eq(payments.providerPaymentId, providerPaymentId))
      .limit(1);
    return row ?? null;
  }

  /** Reads a Payment only when its parent Order belongs to the requesting customer. */
  async findPaymentForCustomer(orderId: string, customerUserId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select({ payment: payments })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(eq(payments.orderId, orderId), eq(orders.customerUserId, customerUserId)))
      .limit(1);
    return row?.payment ?? null;
  }

  /** Finds one Payment by internal ID for authorized finance/internal operations. */
  async findPaymentById(paymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    return row ?? null;
  }

  /** Locks one Payment aggregate before capture/refund/status reconciliation. */
  async lockPaymentById(paymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Locks a Payment by provider identity for race-safe webhook processing. */
  async lockPaymentByProviderPaymentId(providerPaymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .select()
      .from(payments)
      .where(eq(payments.providerPaymentId, providerPaymentId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Attaches the current provider intent and the hash of the idempotency key that created it. */
  async attachProviderPayment(input: AttachProviderPaymentInput): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .update(payments)
      .set({
        providerPaymentId: input.providerPaymentId,
        idempotencyKey: input.idempotencyKeyHash,
        status: input.status,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(payments.id, input.paymentId))
      .returning();
    return row ?? null;
  }

  /** Persists service-calculated Payment totals/status without doing financial arithmetic here. */
  async updatePaymentTotals(input: UpdatePaymentTotalsInput): Promise<PaymentRow | null> {
    const [row] = await this.executor
      .update(payments)
      .set({
        status: input.status,
        ...(input.amountAuthorized !== undefined
          ? { amountAuthorized: input.amountAuthorized }
          : {}),
        ...(input.amountCaptured !== undefined ? { amountCaptured: input.amountCaptured } : {}),
        ...(input.amountRefunded !== undefined ? { amountRefunded: input.amountRefunded } : {}),
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(payments.id, input.paymentId))
      .returning();
    return row ?? null;
  }

  /** Lists Payments for authorized finance users using only validated allow-listed filters. */
  async listAdminPayments(query: AdminPaymentListQuery): Promise<PaginatedPaymentRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.status ? eq(payments.status, query.status) : undefined,
      query.provider ? eq(payments.provider, query.provider) : undefined,
      query.orderId ? eq(payments.orderId, query.orderId) : undefined,
      query.providerPaymentId
        ? eq(payments.providerPaymentId, query.providerPaymentId)
        : undefined,
      query.currency ? eq(payments.currency, query.currency) : undefined,
      query.createdFrom ? gte(payments.createdAt, new Date(query.createdFrom)) : undefined,
      query.createdTo ? lte(payments.createdAt, new Date(query.createdTo)) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(payments)
      .where(where)
      .orderBy(adminPaymentSort(query), asc(payments.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(payments)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Appends one immutable Payment lifecycle transaction. */
  async createTransaction(input: CreatePaymentTransactionInput): Promise<PaymentTransactionRow> {
    const [row] = await this.executor
      .insert(paymentTransactions)
      .values({
        paymentId: input.paymentId,
        type: input.type,
        providerTxnId: input.providerTxnId ?? null,
        amount: input.amount,
        status: input.status,
        occurredAt: input.occurredAt,
        rawEventId: input.rawEventId ?? null,
        sourceKey: input.sourceKey ?? null,
      })
      .returning();

    if (!row) {
      throw new Error("Payment transaction insert did not return a row.");
    }

    return row;
  }

  /** Lists a Payment's append-only transaction timeline in deterministic occurrence order. */
  async listTransactionsByPaymentId(paymentId: string): Promise<PaymentTransactionRow[]> {
    return this.executor
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.paymentId, paymentId))
      .orderBy(asc(paymentTransactions.occurredAt), asc(paymentTransactions.id));
  }

  /** Finds one Payment transaction by its marketplace identifier. */
  async findTransactionById(transactionId: string): Promise<PaymentTransactionRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, transactionId))
      .limit(1);
    return row ?? null;
  }

  /** Locks one Payment transaction before applying a provider reconciliation result. */
  async lockTransactionById(transactionId: string): Promise<PaymentTransactionRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, transactionId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Applies a provider result to one already-created transaction without changing its business identity. */
  async updateTransactionResult(
    input: UpdatePaymentTransactionResultInput,
  ): Promise<PaymentTransactionRow | null> {
    const [row] = await this.executor
      .update(paymentTransactions)
      .set({
        ...(input.providerTxnId !== undefined ? { providerTxnId: input.providerTxnId } : {}),
        status: input.status,
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(paymentTransactions.id, input.transactionId))
      .returning();
    return row ?? null;
  }

  /** Finds an exactly-once transaction by trusted internal/provider source key. */
  async findTransactionBySourceKey(sourceKey: string): Promise<PaymentTransactionRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.sourceKey, sourceKey))
      .limit(1);
    return row ?? null;
  }

  /** Finds a transaction already recorded for one provider transaction identity. */
  async findTransactionByProviderTxnId(providerTxnId: string): Promise<PaymentTransactionRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerTxnId, providerTxnId))
      .limit(1);
    return row ?? null;
  }

  /** Returns the exact total reserved by pending refund transactions for one Payment. */
  async getPendingRefundTotal(paymentId: string): Promise<string> {
    const [row] = await this.executor
      .select({
        total: sql<string>`coalesce(sum(${paymentTransactions.amount}), 0)::numeric(18,4)::text`,
      })
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.paymentId, paymentId),
          eq(paymentTransactions.type, PAYMENT_TRANSACTION_TYPE.REFUND),
          eq(paymentTransactions.status, PAYMENT_TRANSACTION_STATUS.PENDING),
        ),
      );

    return row?.total ?? "0.0000";
  }

  /** Persists one verified provider webhook envelope, or returns null for a duplicate delivery. */
  async createWebhookEvent(input: CreateWebhookEventInput): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .insert(paymentWebhookEvents)
      .values({
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payloadHash: input.payloadHash,
        receivedAt: input.receivedAt ?? new Date(),
        status: PAYMENT_WEBHOOK_STATUS.RECEIVED,
      })
      .onConflictDoNothing({
        target: [paymentWebhookEvents.provider, paymentWebhookEvents.providerEventId],
      })
      .returning();

    return row ?? null;
  }

  /** Finds a provider webhook event so duplicate deliveries can replay safely. */
  async findWebhookEvent(
    provider: PaymentProvider,
    providerEventId: string,
  ): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentWebhookEvents)
      .where(
        and(
          eq(paymentWebhookEvents.provider, provider),
          eq(paymentWebhookEvents.providerEventId, providerEventId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Locks one persisted webhook event before exactly-once processing/retry. */
  async lockWebhookEvent(eventId: string): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.id, eventId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  /** Marks a webhook event as processing and clears completion data from an earlier failed attempt. */
  async markWebhookProcessing(eventId: string): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .update(paymentWebhookEvents)
      .set({
        status: PAYMENT_WEBHOOK_STATUS.PROCESSING,
        processedAt: null,
        errorCode: null,
      })
      .where(eq(paymentWebhookEvents.id, eventId))
      .returning();
    return row ?? null;
  }

  /** Marks a webhook event processed/ignored after its business effects are durably applied. */
  async markWebhookFinished(
    eventId: string,
    status: "processed" | "ignored",
    processedAt: Date = new Date(),
  ): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .update(paymentWebhookEvents)
      .set({ status, processedAt, errorCode: null })
      .where(eq(paymentWebhookEvents.id, eventId))
      .returning();
    return row ?? null;
  }

  /** Marks a webhook event failed with a stable safe code while retaining its replay identity. */
  async markWebhookFailed(
    eventId: string,
    errorCode: string,
    processedAt: Date = new Date(),
  ): Promise<PaymentWebhookEventRow | null> {
    const [row] = await this.executor
      .update(paymentWebhookEvents)
      .set({ status: PAYMENT_WEBHOOK_STATUS.FAILED, processedAt, errorCode })
      .where(eq(paymentWebhookEvents.id, eventId))
      .returning();
    return row ?? null;
  }
}

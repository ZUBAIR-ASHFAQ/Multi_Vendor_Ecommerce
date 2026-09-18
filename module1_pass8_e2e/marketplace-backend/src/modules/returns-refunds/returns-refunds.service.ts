import { createHash, randomUUID } from "node:crypto";
import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  IdempotencyService,
  type BeginIdempotentOperationResult,
} from "../../common/idempotency/idempotency.service.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type {
  RefundRow,
  ReturnItemRow,
  ReturnRequestRow,
  ReturnStatusHistoryRow,
} from "../../database/schema/returns-refunds.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AdministrationService } from "../administration/administration.service.js";
import type { CommissionRefundAdjustResult } from "../commissions/commissions.schema.js";
import { CommissionsService } from "../commissions/commissions.service.js";
import type { RestockStockInput } from "../inventory/inventory.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import type { OrderReturnSnapshot } from "../orders/orders.service.js";
import { OrdersService } from "../orders/orders.service.js";
import type { PaymentTransactionResponse } from "../payments/payments.schema.js";
import type { ReturnRefundPaymentSnapshot } from "../payments/payments.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import type { ReturnDeliveryItemSnapshot } from "../shipping/shipping.service.js";
import { ShippingService } from "../shipping/shipping.service.js";
import {
  RETURN_ITEM_RESOLUTION,
  RETURN_REFUND_STATUS,
  RETURN_REQUEST_STATUS,
  RETURN_WINDOW_POLICY,
  RETURNS_AUDIT_ACTION,
  RETURNS_ERROR_CODE,
  RETURNS_IDEMPOTENCY_SCOPE,
  RETURNS_LIMITS,
  RETURNS_OUTBOX_EVENT,
  RETURNS_PERMISSION,
  RETURNS_RESOURCE_TYPE,
} from "./returns-refunds.constants.js";
import {
  ReturnsRefundsRepository,
  type ReturnItemFinancialHistoryRow,
  type ReturnSellerScope,
} from "./returns-refunds.repository.js";
import {
  returnRefundResultSchema,
  type AdminReturnListQuery,
  type ApproveReturnInput,
  type CreateReturnRequestInput,
  type CustomerReturnListQuery,
  type IssueReturnRefundInput,
  type ReceiveReturnInput,
  type RejectReturnInput,
  type ReturnRefundResult,
  type ReturnRequestResponse,
  type ReturnStatusHistoryResponse,
  type SellerReturnListQuery,
} from "./returns-refunds.schema.js";

/** Runs one Module 14 transaction and allows later focused tests to replace the real database boundary. */
export type ReturnsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Narrow Orders boundary that exposes only immutable Return ownership and item economics. */
export interface ReturnsOrdersIntegration {
  /** Returns one trusted Order snapshot without exposing Orders persistence to Module 14. */
  getReturnSnapshot(context: RequestContext, orderId: string): Promise<OrderReturnSnapshot>;
}

/** Narrow Shipping boundary that exposes only delivered quantity and latest delivery time per Order Item. */
export interface ReturnsShippingIntegration {
  /** Returns delivered item facts used to enforce Return eligibility and window rules. */
  getReturnDeliverySnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<ReturnDeliveryItemSnapshot[]>;
}

/** Narrow Payments boundary that owns provider-authoritative refundable balance and refund execution. */
export interface ReturnsPaymentsIntegration {
  /** Returns current captured/refunded/refundable Payment totals for one Order. */
  getReturnRefundSnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<ReturnRefundPaymentSnapshot>;

  /** Executes or safely replays one trusted provider refund. */
  refundPayment(
    context: RequestContext,
    paymentId: string,
    input: {
      sourceKey: string;
      amount: string;
      providerReason?: "requested_by_customer" | "duplicate" | "fraudulent";
      note?: string;
      requestedByUserId?: string | null;
    },
  ): Promise<PaymentTransactionResponse>;
}

/** Narrow Inventory boundary that restores physical stock exactly once after a successful provider refund. */
export interface ReturnsInventoryIntegration {
  /** Restocks one server-derived Return Item quantity with deterministic source replay. */
  restockStock(context: RequestContext, input: RestockStockInput): Promise<unknown>;
}

/** Narrow Commission boundary that appends cumulative item-level refund reversals without rewriting sale entries. */
export interface ReturnsCommissionsIntegration {
  /** Appends one provider-backed partial Commission adjustment using Module 14 quantity allocation. */
  adjustPartialRefund(
    context: RequestContext,
    input: {
      sourceKey: string;
      orderId: string;
      refundPaymentTransactionId: string;
      items: Array<{
        orderItemId: string;
        currentRefundQuantity: number;
        cumulativeRefundQuantity: number;
        currentRefundAmount: string;
      }>;
    },
  ): Promise<CommissionRefundAdjustResult>;
}

/** Administration boundary that owns the allow-listed Return-window setting. */
export interface ReturnsAdministrationIntegration {
  /** Returns the approved Return window in whole days. */
  getReturnWindowDays(): Promise<number>;
}

/** Foundation idempotency boundary used only by the provider-refund command. */
export interface ReturnsIdempotencyIntegration {
  /** Acquires, replays, or rejects one normalized Return refund key. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores one stable refund result for exact replay. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Releases one failed Return refund key for a safe retry. */
  fail(recordId: string): Promise<void>;
}

/** Small audit boundary used for immutable Return/refund evidence. */
export interface ReturnsAuditIntegration {
  /** Appends one redacted business audit record. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Small outbox boundary used for durable Return/refund events. */
export interface ReturnsOutboxIntegration {
  /** Appends one event inside the caller's business transaction. */
  enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit dependencies keep Module 14 orchestration readable and independently testable. */
export interface ReturnsRefundsServiceDependencies {
  repository?: ReturnsRefundsRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsRefundsRepository;
  transactionRunner?: ReturnsTransactionRunner;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsOrdersIntegration;
  shippingUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsShippingIntegration;
  payments?: ReturnsPaymentsIntegration;
  inventory?: ReturnsInventoryIntegration;
  commissions?: ReturnsCommissionsIntegration;
  administration?: ReturnsAdministrationIntegration;
  idempotency?: ReturnsIdempotencyIntegration;
  idempotencyUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsIdempotencyIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => ReturnsOutboxIntegration;
  now?: () => Date;
  createId?: () => string;
}

/** One bounded page of safe Return Requests before the future HTTP envelope is applied. */
export interface PaginatedReturnsResult {
  items: ReturnRequestResponse[];
  meta: PaginationMeta;
}

/** One prepared item allocation reused across Payment, Commission, Inventory, and final persistence. */
interface PreparedRefundItem {
  returnItemId: string;
  orderItemId: string;
  sellerId: string;
  storeId: string;
  variantId: string;
  quantity: number;
  cumulativeRefundQuantity: number;
  refundAmount: string;
  restockQty: number;
}

/** Durable preparation result that lets an external provider call be retried without recalculating different economics. */
interface PreparedRefund {
  refund: RefundRow;
  returnRequest: ReturnRequestRow;
  items: PreparedRefundItem[];
}

/** Exact fixed scale used by Module 14 money allocation. */
const MONEY_FACTOR = 10_000n;

/** Converts canonical non-negative scale-4 money into an exact integer. */
function moneyToScale4(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MONEY_FACTOR + BigInt(`${fraction}0000`.slice(0, 4));
}

/** Converts one non-negative scale-4 integer into canonical Return money. */
function scale4ToMoney(value: bigint): string {
  const whole = value / MONEY_FACTOR;
  const fraction = (value % MONEY_FACTOR).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** Divides positive exact integers using deterministic half-up rounding. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Creates one lowercase SHA-256 digest for stable refund idempotency request hashes. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Formats the immutable human-readable Return number from its UUID. */
function returnNumber(id: string): string {
  return `RET-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Creates the trusted system identity used only for internal cross-module Return reads/writes. */
function systemContext(requestId: string): RequestContext {
  return {
    requestId,
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates one stable Module 14 business error. */
function returnsError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Returns true when a persisted scale-4 amount is greater than zero. */
function hasRefundAmount(value: string): boolean {
  return moneyToScale4(value) > 0n;
}

/** Module 14 service for Return eligibility, lifecycle, provider refund orchestration, restock, and financial adjustments. */
export class ReturnsRefundsService {
  private readonly repository: ReturnsRefundsRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsRefundsRepository;
  private readonly transactionRunner: ReturnsTransactionRunner;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsOrdersIntegration;
  private readonly shippingUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsShippingIntegration;
  private readonly payments: ReturnsPaymentsIntegration;
  private readonly inventory: ReturnsInventoryIntegration;
  private readonly commissions: ReturnsCommissionsIntegration;
  private readonly administration: ReturnsAdministrationIntegration;
  private readonly idempotency: ReturnsIdempotencyIntegration;
  private readonly idempotencyUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsIdempotencyIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReturnsOutboxIntegration;
  private readonly now: () => Date;
  private readonly createId: () => string;

  /** Stores explicit dependencies while keeping the default production composition straightforward. */
  constructor(dependencies: ReturnsRefundsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new ReturnsRefundsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ??
      ((transaction) => new ReturnsRefundsRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.shippingUsingTransaction =
      dependencies.shippingUsingTransaction ?? ((transaction) => ShippingService.using(transaction));
    this.payments = dependencies.payments ?? new PaymentsService();
    this.inventory = dependencies.inventory ?? new InventoryService();
    this.commissions = dependencies.commissions ?? new CommissionsService();
    this.administration = dependencies.administration ?? new AdministrationService();
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.idempotencyUsingTransaction =
      dependencies.idempotencyUsingTransaction ?? ((transaction) => IdempotencyService.using(transaction));
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  /** Creates one customer-owned Return Request after delivery, window, scope, and quantity validation. */
  async createReturnRequest(
    context: RequestContext,
    orderId: string,
    input: CreateReturnRequestInput,
  ): Promise<ReturnRequestResponse> {
    const customerUserId = this.requireCustomer(context, RETURNS_PERMISSION.CREATE_OWN);
    const windowDays = await this.administration.getReturnWindowDays();
    if (
      !Number.isInteger(windowDays) ||
      windowDays < RETURN_WINDOW_POLICY.MIN_DAYS ||
      windowDays > RETURN_WINDOW_POLICY.MAX_DAYS
    ) {
      throw returnsError(ERROR_CODE.INTERNAL_ERROR, "Return window configuration is invalid.", 500);
    }

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const trusted = systemContext(context.requestId);
      const [order, deliveredItems] = await Promise.all([
        this.ordersUsingTransaction(transaction).getReturnSnapshot(trusted, orderId),
        this.shippingUsingTransaction(transaction).getReturnDeliverySnapshot(trusted, orderId),
      ]);
      if (order.customerUserId !== customerUserId) {
        throw returnsError(RETURNS_ERROR_CODE.SCOPE_FORBIDDEN, "Return Order is outside the customer scope.", 403);
      }

      const requestedIds = input.items.map((item) => item.orderItemId);
      await repository.lockReturnAllocations(requestedIds);
      const reservations = await repository.sumNonRejectedReturnQuantities(requestedIds);
      const reservedByItem = new Map(
        reservations.map((row) => [row.orderItemId, row.reservedQuantity]),
      );
      const deliveryByItem = new Map(deliveredItems.map((item) => [item.orderItemId, item]));
      const now = this.now();

      for (const requestedItem of input.items) {
        const orderItem = order.items.find((item) => item.orderItemId === requestedItem.orderItemId);
        if (!orderItem || orderItem.sellerOrderId !== input.sellerOrderId) {
          throw returnsError(
            RETURNS_ERROR_CODE.NOT_ELIGIBLE,
            "One or more requested items are not eligible for this Seller Order Return.",
            409,
          );
        }
        const delivery = deliveryByItem.get(requestedItem.orderItemId);
        if (!delivery || delivery.deliveredQuantity <= 0) {
          throw returnsError(
            RETURNS_ERROR_CODE.NOT_ELIGIBLE,
            "Only delivered Order Item quantities are eligible for Return.",
            409,
          );
        }
        const deadline = new Date(delivery.latestDeliveredAt).getTime() + windowDays * 86_400_000;
        if (now.getTime() > deadline) {
          throw returnsError(
            RETURNS_ERROR_CODE.WINDOW_EXPIRED,
            "The Return window has expired for one or more requested items.",
            409,
          );
        }
        const returnable = delivery.deliveredQuantity - (reservedByItem.get(requestedItem.orderItemId) ?? 0);
        if (requestedItem.quantity > returnable) {
          throw returnsError(
            RETURNS_ERROR_CODE.NOT_ELIGIBLE,
            "Requested Return quantity exceeds the remaining delivered quantity.",
            409,
          );
        }
      }

      const id = this.createId();
      const created = await repository.createReturnRequest({
        id,
        returnNo: returnNumber(id),
        orderId: order.orderId,
        sellerOrderId: input.sellerOrderId,
        customerUserId,
        status: RETURN_REQUEST_STATUS.REQUESTED,
        reasonCode: input.reasonCode,
        requestedAt: now,
      });
      const items = await repository.createReturnItems(created.id, input.items);
      const historyEntry = await repository.appendStatusHistory(created.id, {
        fromStatus: null,
        toStatus: RETURN_REQUEST_STATUS.REQUESTED,
        changedBy: customerUserId,
        changedAt: now,
      });
      const sellerId = this.sellerIdForSellerOrder(order, input.sellerOrderId);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: RETURNS_AUDIT_ACTION.REQUESTED,
        entityType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        entityId: created.id,
        sellerId,
        requestId: context.requestId,
        after: this.toReturnResponse(created, items),
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: RETURNS_OUTBOX_EVENT.REQUESTED,
        aggregateType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        aggregateId: created.id,
        payload: {
          returnRequestId: created.id,
          orderId: created.orderId,
          sellerOrderId: created.sellerOrderId,
          sellerId,
          customerUserId: created.customerUserId,
          status: created.status,
        },
      });

      return this.toReturnResponse(created, items, [historyEntry]);
    });
  }

  /** Lists only the authenticated customer's own Return Requests. */
  async listCustomerReturns(
    context: RequestContext,
    query: CustomerReturnListQuery,
  ): Promise<PaginatedReturnsResult> {
    const customerUserId = this.requireCustomer(context, RETURNS_PERMISSION.READ_OWN);
    const result = await this.repository.listCustomerReturns(customerUserId, query);
    return {
      items: await this.attachItems(result.items, this.repository),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists Return Requests only inside seller/store scopes where seller.returns.manage is effective. */
  async listSellerReturns(
    context: RequestContext,
    query: SellerReturnListQuery,
  ): Promise<PaginatedReturnsResult> {
    const scope = this.resolveSellerScope(context);
    const result = await this.repository.listSellerReturns(scope, query);
    return {
      items: await this.attachItems(result.items, this.repository),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists platform Return Requests for an authorized support/admin actor. */
  async listAdminReturns(
    context: RequestContext,
    query: AdminReturnListQuery,
  ): Promise<PaginatedReturnsResult> {
    this.requireActor(context);
    assertPermission(context, RETURNS_PERMISSION.ADMIN_MANAGE);
    const result = await this.repository.listAdminReturns(query);
    return {
      items: await this.attachItems(result.items, this.repository),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Approves one requested Return inside the actor's seller scope. */
  async approveReturn(
    context: RequestContext,
    returnRequestId: string,
    input: ApproveReturnInput,
  ): Promise<ReturnRequestResponse> {
    const scope = this.resolveSellerScope(context);
    return this.transitionSellerReturn(
      context,
      scope,
      returnRequestId,
      RETURN_REQUEST_STATUS.REQUESTED,
      RETURN_REQUEST_STATUS.APPROVED,
      input.note ?? null,
    );
  }

  /** Rejects one requested Return inside the actor's seller scope and logically releases its quantity reservation. */
  async rejectReturn(
    context: RequestContext,
    returnRequestId: string,
    input: RejectReturnInput,
  ): Promise<ReturnRequestResponse> {
    const scope = this.resolveSellerScope(context);
    return this.transitionSellerReturn(
      context,
      scope,
      returnRequestId,
      RETURN_REQUEST_STATUS.REQUESTED,
      RETURN_REQUEST_STATUS.REJECTED,
      input.reason,
    );
  }

  /** Records complete physical inspection decisions for one approved Return and moves it to received. */
  async receiveReturn(
    context: RequestContext,
    returnRequestId: string,
    input: ReceiveReturnInput,
  ): Promise<ReturnRequestResponse> {
    const scope = this.resolveSellerScope(context);
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.lockReturnInSellerScope(returnRequestId, scope);
      if (!current) throw this.scopeForbidden();
      if (current.status !== RETURN_REQUEST_STATUS.APPROVED) throw this.statusInvalid();
      const items = await repository.lockReturnItems(current.id);
      if (items.length !== input.items.length) {
        throw returnsError(
          RETURNS_ERROR_CODE.STATUS_INVALID,
          "Receive must inspect every Return Item exactly once.",
          409,
        );
      }
      const inputById = new Map(input.items.map((item) => [item.returnItemId, item]));
      for (const item of items) {
        const decision = inputById.get(item.id);
        if (!decision) {
          throw returnsError(
            RETURNS_ERROR_CODE.STATUS_INVALID,
            "Receive must inspect every Return Item exactly once.",
            409,
          );
        }
        await repository.updateReturnItemResolution(current.id, item.id, {
          itemCondition: decision.itemCondition,
          resolution: decision.resolution,
          restockQty:
            decision.resolution === RETURN_ITEM_RESOLUTION.REFUND_RESTOCK ? item.quantity : 0,
        });
      }
      const now = this.now();
      const updated = await repository.updateReturnStatus(current.id, {
        status: RETURN_REQUEST_STATUS.RECEIVED,
      });
      if (!updated) throw this.notFound();
      await repository.appendStatusHistory(current.id, {
        fromStatus: RETURN_REQUEST_STATUS.APPROVED,
        toStatus: RETURN_REQUEST_STATUS.RECEIVED,
        changedBy: context.actorId,
        reason: input.note ?? null,
        changedAt: now,
      });
      const [updatedItems, history] = await Promise.all([
        repository.listReturnItems(current.id),
        repository.listStatusHistory(current.id),
      ]);
      const order = await this.ordersUsingTransaction(transaction).getReturnSnapshot(
        systemContext(context.requestId),
        current.orderId,
      );
      const sellerId = this.sellerIdForSellerOrder(order, current.sellerOrderId);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: RETURNS_AUDIT_ACTION.RECEIVED,
        entityType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        entityId: current.id,
        sellerId,
        requestId: context.requestId,
        before: { status: current.status },
        after: { status: updated.status },
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: RETURNS_OUTBOX_EVENT.RECEIVED,
        aggregateType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        aggregateId: current.id,
        payload: {
          returnRequestId: current.id,
          orderId: current.orderId,
          sellerOrderId: current.sellerOrderId,
          sellerId,
          status: updated.status,
        },
      });

      return this.toReturnResponse(updated, updatedItems, history);
    });
  }

  /** Issues one idempotent provider refund, partial Commission reversal, optional restock, and final Return close. */
  async issueRefund(
    context: RequestContext,
    returnRequestId: string,
    input: IssueReturnRefundInput,
    idempotencyKey: string,
  ): Promise<ReturnRefundResult> {
    this.requireActor(context);
    assertPermission(context, RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: RETURNS_IDEMPOTENCY_SCOPE.REFUND,
        key,
        requestHash: sha256(
          JSON.stringify({
            version: "module14-return-refund-v1",
            returnRequestId,
            note: input.note ?? null,
          }),
        ),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return returnRefundResultSchema.parse(idempotency.replay.responseBody);
    }

    try {
      const prepared = await this.prepareRefund(
        context,
        returnRequestId,
        input,
        key,
      );
      const trusted = systemContext(context.requestId);
      const paymentTransaction = await this.payments.refundPayment(
        trusted,
        prepared.refund.paymentId,
        {
          sourceKey: this.paymentRefundSourceKey(prepared.refund),
          amount: prepared.refund.amount,
          providerReason: "requested_by_customer",
          ...(input.note ? { note: input.note } : {}),
          requestedByUserId: prepared.returnRequest.customerUserId,
        },
      );

      await this.commissions.adjustPartialRefund(trusted, {
        sourceKey: this.commissionRefundSourceKey(prepared.refund),
        orderId: prepared.returnRequest.orderId,
        refundPaymentTransactionId: paymentTransaction.id,
        items: prepared.items.map((item) => ({
          orderItemId: item.orderItemId,
          currentRefundQuantity: item.quantity,
          cumulativeRefundQuantity: item.cumulativeRefundQuantity,
          currentRefundAmount: item.refundAmount,
        })),
      });

      for (const item of prepared.items) {
        if (item.restockQty <= 0) continue;
        await this.inventory.restockStock(trusted, {
          sellerId: item.sellerId,
          storeId: item.storeId,
          variantId: item.variantId,
          quantity: item.restockQty,
          sourceId: item.returnItemId,
          sourceKey: this.restockSourceKey(prepared.returnRequest.id, item.returnItemId),
        });
      }

      return await this.finalizeRefund(
        context,
        idempotency.recordId,
        prepared,
        paymentTransaction,
      );
    } catch (error) {
      await this.idempotency.fail(idempotency.recordId).catch(() => undefined);
      throw error;
    }
  }

  /** Applies one simple requested -> approved/rejected seller transition with audit/history/outbox evidence. */
  private async transitionSellerReturn(
    context: RequestContext,
    scope: ReturnSellerScope,
    returnRequestId: string,
    expectedStatus: typeof RETURN_REQUEST_STATUS.REQUESTED,
    nextStatus:
      | typeof RETURN_REQUEST_STATUS.APPROVED
      | typeof RETURN_REQUEST_STATUS.REJECTED,
    reason: string | null,
  ): Promise<ReturnRequestResponse> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.lockReturnInSellerScope(returnRequestId, scope);
      if (!current) throw this.scopeForbidden();
      if (current.status !== expectedStatus) throw this.statusInvalid();
      const now = this.now();
      const updated = await repository.updateReturnStatus(current.id, {
        status: nextStatus,
        ...(nextStatus === RETURN_REQUEST_STATUS.APPROVED ? { approvedAt: now } : {}),
      });
      if (!updated) throw this.notFound();
      await repository.appendStatusHistory(current.id, {
        fromStatus: expectedStatus,
        toStatus: nextStatus,
        changedBy: context.actorId,
        reason,
        changedAt: now,
      });
      const [items, history] = await Promise.all([
        repository.listReturnItems(current.id),
        repository.listStatusHistory(current.id),
      ]);
      const order = await this.ordersUsingTransaction(transaction).getReturnSnapshot(
        systemContext(context.requestId),
        current.orderId,
      );
      const sellerId = this.sellerIdForSellerOrder(order, current.sellerOrderId);
      const action =
        nextStatus === RETURN_REQUEST_STATUS.APPROVED
          ? RETURNS_AUDIT_ACTION.APPROVED
          : RETURNS_AUDIT_ACTION.REJECTED;
      const eventType =
        nextStatus === RETURN_REQUEST_STATUS.APPROVED
          ? RETURNS_OUTBOX_EVENT.APPROVED
          : RETURNS_OUTBOX_EVENT.REJECTED;
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action,
        entityType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        entityId: current.id,
        sellerId,
        requestId: context.requestId,
        before: { status: current.status },
        after: { status: updated.status, approvedAt: updated.approvedAt?.toISOString() ?? null },
        ...(reason ? { metadata: { reason } } : {}),
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType,
        aggregateType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        aggregateId: current.id,
        payload: {
          returnRequestId: current.id,
          orderId: current.orderId,
          sellerOrderId: current.sellerOrderId,
          sellerId,
          status: updated.status,
        },
      });
      return this.toReturnResponse(updated, items, history);
    });
  }

  /** Persists stable refund economics before the external provider call so retries cannot recalculate a different amount. */
  private async prepareRefund(
    context: RequestContext,
    returnRequestId: string,
    input: IssueReturnRefundInput,
    idempotencyKey: string,
  ): Promise<PreparedRefund> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.lockReturnById(returnRequestId);
      if (!current) throw this.notFound();

      const items = await repository.lockReturnItems(current.id);
      this.assertRefundPreparationState(current, items);
      await repository.lockReturnAllocations(
        items.map((item) => item.orderItemId),
      );
      await this.normalizeRefundItemResolutions(repository, current, items);

      const trusted = systemContext(context.requestId);
      const economics = await this.buildPreparedRefundEconomics(
        transaction,
        repository,
        trusted,
        current,
      );
      const payment = await this.payments.getReturnRefundSnapshot(
        trusted,
        current.orderId,
      );
      if (payment.currency !== economics.order.currency) {
        throw returnsError(
          ERROR_CODE.INTERNAL_ERROR,
          "Return Payment currency does not match Order currency.",
          500,
        );
      }

      const existingRefunds = await repository.listRefundsForReturn(current.id);
      const existingRefund = this.findMatchingPreparedRefund(
        existingRefunds,
        idempotencyKey,
        payment,
        current,
        economics.amount,
        economics.order.currency,
      );
      const refund =
        existingRefund ??
        (await this.createPendingPreparedRefund(
          transaction,
          repository,
          context,
          input,
          current,
          economics.order,
          payment,
          economics.amount,
          idempotencyKey,
        ));

      await this.persistPreparedRefundAmounts(
        repository,
        current.id,
        economics.currentItems,
        economics.preparedItems,
      );

      return {
        refund,
        returnRequest: current,
        items: economics.preparedItems,
      };
    });
  }

  /** Ensures the Return is in a refundable lifecycle state and still contains at least one item. */
  private assertRefundPreparationState(
    current: ReturnRequestRow,
    items: ReturnItemRow[],
  ): void {
    if (
      current.status !== RETURN_REQUEST_STATUS.APPROVED &&
      current.status !== RETURN_REQUEST_STATUS.RECEIVED
    ) {
      throw this.statusInvalid();
    }
    if (items.length === 0) {
      throw returnsError(
        ERROR_CODE.INTERNAL_ERROR,
        "Return Request has no Return Items.",
        500,
      );
    }
  }

  /** Applies the refund-without-restock default for approved Returns or verifies received-item inspection is complete. */
  private async normalizeRefundItemResolutions(
    repository: ReturnsRefundsRepository,
    current: ReturnRequestRow,
    items: ReturnItemRow[],
  ): Promise<void> {
    if (current.status === RETURN_REQUEST_STATUS.APPROVED) {
      for (const item of items) {
        await repository.updateReturnItemResolution(current.id, item.id, {
          itemCondition: null,
          resolution: RETURN_ITEM_RESOLUTION.REFUND_NO_RESTOCK,
          restockQty: 0,
        });
      }
      return;
    }

    if (items.some((item) => item.resolution === null)) {
      throw this.statusInvalid();
    }
  }

  /** Builds immutable Return item economics used by Payment, Commission, and refund persistence. */
  private async buildPreparedRefundEconomics(
    transaction: DatabaseTransaction,
    repository: ReturnsRefundsRepository,
    trusted: RequestContext,
    current: ReturnRequestRow,
  ): Promise<{
    order: OrderReturnSnapshot;
    currentItems: ReturnItemRow[];
    preparedItems: PreparedRefundItem[];
    amount: string;
  }> {
    const order = await this.ordersUsingTransaction(transaction).getReturnSnapshot(
      trusted,
      current.orderId,
    );
    if (order.currency.length !== RETURNS_LIMITS.CURRENCY_LENGTH) {
      throw returnsError(
        ERROR_CODE.INTERNAL_ERROR,
        "Return Order currency is invalid.",
        500,
      );
    }

    const currentItems = await repository.lockReturnItems(current.id);
    const history = await repository.listReturnItemFinancialHistory(
      currentItems.map((item) => item.orderItemId),
    );
    const preparedItems = this.calculateRefundItems(
      order,
      currentItems,
      history,
      current.sellerOrderId,
    );

    return {
      order,
      currentItems,
      preparedItems,
      amount: this.calculatePreparedRefundAmount(preparedItems),
    };
  }

  /** Sums the server-derived item refund amounts and rejects a zero-value refund. */
  private calculatePreparedRefundAmount(items: PreparedRefundItem[]): string {
    const amount = scale4ToMoney(
      items.reduce(
        (total, item) => total + moneyToScale4(item.refundAmount),
        0n,
      ),
    );
    if (moneyToScale4(amount) <= 0n) {
      throw returnsError(
        RETURNS_ERROR_CODE.NOT_ELIGIBLE,
        "Return has no refundable amount.",
        409,
      );
    }
    return amount;
  }

  /** Reuses one matching pending refund command and rejects conflicting idempotency keys or economics. */
  private findMatchingPreparedRefund(
    refunds: RefundRow[],
    idempotencyKey: string,
    payment: ReturnRefundPaymentSnapshot,
    current: ReturnRequestRow,
    amount: string,
    currency: string,
  ): RefundRow | null {
    const conflicting = refunds.find(
      (refund) => refund.idempotencyKey !== idempotencyKey,
    );
    if (conflicting) {
      throw returnsError(
        RETURNS_ERROR_CODE.REFUND_DUPLICATE,
        "This Return already has a different refund command.",
        409,
      );
    }

    const refund = refunds.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey,
    );
    if (!refund) return null;

    if (
      refund.paymentId !== payment.paymentId ||
      refund.orderId !== current.orderId ||
      refund.amount !== amount ||
      refund.currency !== currency
    ) {
      throw returnsError(
        RETURNS_ERROR_CODE.REFUND_DUPLICATE,
        "The refund idempotency key belongs to different Return economics.",
        409,
      );
    }
    return refund;
  }

  /** Creates the pending Refund row once and records its immutable audit/outbox evidence. */
  private async createPendingPreparedRefund(
    transaction: DatabaseTransaction,
    repository: ReturnsRefundsRepository,
    context: RequestContext,
    input: IssueReturnRefundInput,
    current: ReturnRequestRow,
    order: OrderReturnSnapshot,
    payment: ReturnRefundPaymentSnapshot,
    amount: string,
    idempotencyKey: string,
  ): Promise<RefundRow> {
    if (moneyToScale4(amount) > moneyToScale4(payment.refundableAmount)) {
      throw returnsError(
        RETURNS_ERROR_CODE.NOT_ELIGIBLE,
        "Return refund amount exceeds the provider-authoritative refundable balance.",
        409,
      );
    }

    const refundId = this.createId();
    let refund = await repository.createRefundIfMissing({
      id: refundId,
      returnRequestId: current.id,
      orderId: current.orderId,
      paymentId: payment.paymentId,
      amount,
      currency: order.currency,
      status: RETURN_REFUND_STATUS.PENDING,
      idempotencyKey,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
    if (!refund) {
      const raced = await repository.findRefundByIdempotencyKey(idempotencyKey);
      if (!raced || raced.returnRequestId !== current.id) {
        throw returnsError(
          RETURNS_ERROR_CODE.REFUND_DUPLICATE,
          "The refund idempotency key was already used by another refund.",
          409,
        );
      }
      refund = raced;
    }

    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: RETURNS_AUDIT_ACTION.REFUND_REQUESTED,
      entityType: RETURNS_RESOURCE_TYPE.REFUND,
      entityId: refund.id,
      sellerId: this.sellerIdForSellerOrder(order, current.sellerOrderId),
      requestId: context.requestId,
      after: {
        returnRequestId: current.id,
        orderId: current.orderId,
        paymentId: payment.paymentId,
        amount,
        currency: order.currency,
        status: refund.status,
      },
      ...(input.note ? { metadata: { note: input.note } } : {}),
    });
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: RETURNS_OUTBOX_EVENT.REFUND_REQUESTED,
      aggregateType: RETURNS_RESOURCE_TYPE.REFUND,
      aggregateId: refund.id,
      payload: {
        refundId: refund.id,
        returnRequestId: current.id,
        orderId: current.orderId,
        paymentId: payment.paymentId,
        amount,
        currency: order.currency,
      },
    });

    return refund;
  }

  /** Persists each prepared item allocation so provider retries reuse identical item economics. */
  private async persistPreparedRefundAmounts(
    repository: ReturnsRefundsRepository,
    returnRequestId: string,
    currentItems: ReturnItemRow[],
    preparedItems: PreparedRefundItem[],
  ): Promise<void> {
    for (const item of preparedItems) {
      const persisted = currentItems.find(
        (candidate) => candidate.id === item.returnItemId,
      );
      if (!persisted) {
        throw returnsError(
          ERROR_CODE.INTERNAL_ERROR,
          "Prepared Return Item is missing.",
          500,
        );
      }
      if (persisted.refundAmount === item.refundAmount) continue;

      const updated = await repository.updateReturnItemRefund(
        returnRequestId,
        item.returnItemId,
        { refundAmount: item.refundAmount },
      );
      if (!updated) throw this.notFound();
    }
  }

  /** Finalizes Return persistence and Foundation replay state only after all idempotent downstream effects succeed. */
  private async finalizeRefund(
    context: RequestContext,
    idempotencyRecordId: string,
    prepared: PreparedRefund,
    paymentTransaction: PaymentTransactionResponse,
  ): Promise<ReturnRefundResult> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.lockReturnById(prepared.returnRequest.id);
      if (!current) throw this.notFound();
      if (
        current.status !== RETURN_REQUEST_STATUS.APPROVED &&
        current.status !== RETURN_REQUEST_STATUS.RECEIVED
      ) {
        throw this.statusInvalid();
      }
      const refund = await repository.findRefundByIdempotencyKey(prepared.refund.idempotencyKey);
      if (!refund || refund.id !== prepared.refund.id) {
        throw returnsError(ERROR_CODE.INTERNAL_ERROR, "Return refund persistence is inconsistent.", 500);
      }
      const now = this.now();
      const completedRefund = await repository.updateRefundResult(refund.id, {
        status: RETURN_REFUND_STATUS.COMPLETED,
        providerRef: paymentTransaction.providerTxnId,
        updatedAt: now,
      });
      if (!completedRefund) {
        throw returnsError(ERROR_CODE.INTERNAL_ERROR, "Return refund could not be finalized.", 500);
      }
      const closed = await repository.updateReturnStatus(current.id, {
        status: RETURN_REQUEST_STATUS.CLOSED,
      });
      if (!closed) throw this.notFound();
      await repository.appendStatusHistory(current.id, {
        fromStatus: current.status as typeof RETURN_REQUEST_STATUS.APPROVED | typeof RETURN_REQUEST_STATUS.RECEIVED,
        toStatus: RETURN_REQUEST_STATUS.CLOSED,
        changedBy: context.actorId,
        changedAt: now,
      });
      const order = await this.ordersUsingTransaction(transaction).getReturnSnapshot(
        systemContext(context.requestId),
        current.orderId,
      );
      const sellerId = this.sellerIdForSellerOrder(order, current.sellerOrderId);
      const response: ReturnRefundResult = {
        refundId: completedRefund.id,
        returnRequestId: current.id,
        orderId: current.orderId,
        paymentId: completedRefund.paymentId,
        amount: completedRefund.amount,
        currency: completedRefund.currency,
        providerRef: completedRefund.providerRef,
      };
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: RETURNS_AUDIT_ACTION.REFUND_COMPLETED,
        entityType: RETURNS_RESOURCE_TYPE.REFUND,
        entityId: completedRefund.id,
        sellerId,
        requestId: context.requestId,
        before: { status: refund.status },
        after: response,
        metadata: { paymentTransactionId: paymentTransaction.id },
      });
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: RETURNS_AUDIT_ACTION.CLOSED,
        entityType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        entityId: current.id,
        sellerId,
        requestId: context.requestId,
        before: { status: current.status },
        after: { status: closed.status },
      });
      const outbox = this.outboxUsingTransaction(transaction);
      await outbox.enqueue({
        eventType: RETURNS_OUTBOX_EVENT.REFUND_COMPLETED,
        aggregateType: RETURNS_RESOURCE_TYPE.REFUND,
        aggregateId: completedRefund.id,
        payload: {
          ...response,
          paymentTransactionId: paymentTransaction.id,
        },
      });
      await outbox.enqueue({
        eventType: RETURNS_OUTBOX_EVENT.CLOSED,
        aggregateType: RETURNS_RESOURCE_TYPE.RETURN_REQUEST,
        aggregateId: current.id,
        payload: {
          returnRequestId: current.id,
          orderId: current.orderId,
          sellerOrderId: current.sellerOrderId,
          sellerId,
          status: closed.status,
        },
      });
      await this.idempotencyUsingTransaction(transaction).complete(
        idempotencyRecordId,
        200,
        response,
      );
      return response;
    });
  }

  /** Calculates exact cumulative item refund allocation from immutable Order snapshots and prior non-rejected refund persistence. */
  private calculateRefundItems(
    order: OrderReturnSnapshot,
    items: ReturnItemRow[],
    history: ReturnItemFinancialHistoryRow[],
    sellerOrderId: string,
  ): PreparedRefundItem[] {
    return items.map((item) => {
      const orderItem = order.items.find((candidate) => candidate.orderItemId === item.orderItemId);
      if (!orderItem || orderItem.sellerOrderId !== sellerOrderId) {
        throw returnsError(ERROR_CODE.INTERNAL_ERROR, "Return Item Order snapshot is inconsistent.", 500);
      }
      const commercialQuantity = orderItem.quantity - orderItem.cancelledQuantity;
      if (commercialQuantity <= 0 || item.quantity > commercialQuantity) {
        throw returnsError(RETURNS_ERROR_CODE.NOT_ELIGIBLE, "Return Item quantity is not refundable.", 409);
      }
      const prior = history.filter(
        (entry) =>
          entry.orderItemId === item.orderItemId &&
          entry.returnItemId !== item.id &&
          entry.returnStatus !== RETURN_REQUEST_STATUS.REJECTED &&
          hasRefundAmount(entry.refundAmount),
      );
      const priorQuantity = prior.reduce((total, entry) => total + entry.quantity, 0);
      const priorAmount = prior.reduce(
        (total, entry) => total + moneyToScale4(entry.refundAmount),
        0n,
      );
      const cumulativeQuantity = priorQuantity + item.quantity;
      if (cumulativeQuantity > commercialQuantity) {
        throw returnsError(
          RETURNS_ERROR_CODE.NOT_ELIGIBLE,
          "Cumulative refunded quantity exceeds the immutable commercial quantity.",
          409,
        );
      }
      const cumulativeTarget = divideHalfUp(
        moneyToScale4(orderItem.lineTotal) * BigInt(cumulativeQuantity),
        BigInt(commercialQuantity),
      );
      const currentAmount = cumulativeTarget - priorAmount;
      if (currentAmount <= 0n) {
        throw returnsError(
          RETURNS_ERROR_CODE.NOT_ELIGIBLE,
          "Return Item has no remaining refundable amount.",
          409,
        );
      }
      if (item.resolution === null) {
        throw this.statusInvalid();
      }
      return {
        returnItemId: item.id,
        orderItemId: item.orderItemId,
        sellerId: orderItem.sellerId,
        storeId: orderItem.storeId,
        variantId: orderItem.variantId,
        quantity: item.quantity,
        cumulativeRefundQuantity: cumulativeQuantity,
        refundAmount: scale4ToMoney(currentAmount),
        restockQty: item.restockQty,
      };
    });
  }

  /** Loads Return Items and append-only lifecycle history for each already-scoped Return header. */
  private async attachItems(
    rows: ReturnRequestRow[],
    repository: ReturnsRefundsRepository,
  ): Promise<ReturnRequestResponse[]> {
    return Promise.all(
      rows.map(async (row) => {
        const [items, history] = await Promise.all([
          repository.listReturnItems(row.id),
          repository.listStatusHistory(row.id),
        ]);
        return this.toReturnResponse(row, items, history);
      }),
    );
  }

  /** Maps persisted Return Request, Return Item, and optional lifecycle-history rows into the safe response contract. */
  private toReturnResponse(
    row: ReturnRequestRow,
    items: ReturnItemRow[],
    history?: ReturnStatusHistoryRow[],
  ): ReturnRequestResponse {
    return {
      id: row.id,
      returnNo: row.returnNo,
      orderId: row.orderId,
      sellerOrderId: row.sellerOrderId,
      customerUserId: row.customerUserId,
      status: row.status as ReturnRequestResponse["status"],
      reasonCode: row.reasonCode as ReturnRequestResponse["reasonCode"],
      requestedAt: row.requestedAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      items: items.map((item) => ({
        id: item.id,
        orderItemId: item.orderItemId,
        quantity: item.quantity,
        itemCondition: item.itemCondition as ReturnRequestResponse["items"][number]["itemCondition"],
        resolution: item.resolution as ReturnRequestResponse["items"][number]["resolution"],
        refundAmount: item.refundAmount,
        restockQty: item.restockQty,
      })),
      ...(history
        ? {
            history: history.map((entry) => ({
              id: entry.id,
              fromStatus: entry.fromStatus as ReturnStatusHistoryResponse["fromStatus"],
              toStatus: entry.toStatus as ReturnStatusHistoryResponse["toStatus"],
              changedBy: entry.changedBy,
              reason: entry.reason,
              changedAt: entry.changedAt.toISOString(),
            })),
          }
        : {}),
    };
  }

  /** Requires an authenticated actor ID before a privileged Return service operation proceeds. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw returnsError(ERROR_CODE.UNAUTHENTICATED, "Authenticated Return access is required.", 401);
    }
    return context.actorId;
  }

  /** Requires an authenticated customer with the requested own-Return permission. */
  private requireCustomer(context: RequestContext, permission: PermissionCode): string {
    const actorId = this.requireActor(context);
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) {
      throw returnsError(RETURNS_ERROR_CODE.SCOPE_FORBIDDEN, "Customer Return scope is required.", 403);
    }
    assertPermission(context, permission);
    return actorId;
  }

  /** Resolves only seller/store scopes where seller.returns.manage is effective for the current seller actor. */
  private resolveSellerScope(context: RequestContext): ReturnSellerScope {
    this.requireActor(context);
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.scopeForbidden();
    const sellerIds = [...context.sellerIds].filter((sellerId) =>
      context.sellerPermissions.get(sellerId)?.has(RETURNS_PERMISSION.SELLER_MANAGE),
    );
    if (sellerIds.length === 0 || context.storeIds.size === 0) throw this.scopeForbidden();
    return { sellerIds, storeIds: [...context.storeIds] };
  }

  /** Finds the seller identity attached to one immutable Seller Order in the trusted Order snapshot. */
  private sellerIdForSellerOrder(order: OrderReturnSnapshot, sellerOrderId: string): string {
    const item = order.items.find((candidate) => candidate.sellerOrderId === sellerOrderId);
    if (!item) {
      throw returnsError(ERROR_CODE.INTERNAL_ERROR, "Return Seller Order ownership is inconsistent.", 500);
    }
    return item.sellerId;
  }

  /** Normalizes and bounds the client idempotency key used by one provider-refund command. */
  private normalizeIdempotencyKey(value: string): string {
    const key = value.trim();
    if (!key || key.length > RETURNS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw returnsError(ERROR_CODE.VALIDATION_FAILED, "A valid Idempotency-Key is required.", 422);
    }
    return key;
  }

  /** Creates the deterministic Module 12 refund source for one persisted business Refund row. */
  private paymentRefundSourceKey(refund: RefundRow): string {
    return `return:${refund.returnRequestId}:refund:${refund.id}`;
  }

  /** Creates the deterministic Module 16 partial-adjustment source for one persisted business Refund row. */
  private commissionRefundSourceKey(refund: RefundRow): string {
    return `return:${refund.returnRequestId}:refund:${refund.id}:commission`;
  }

  /** Creates the deterministic Module 7 restock source for one Return Item. */
  private restockSourceKey(returnRequestId: string, returnItemId: string): string {
    return `return:${returnRequestId}:item:${returnItemId}:restock`;
  }

  /** Returns the stable private-resource error for a missing Return Request. */
  private notFound(): AppError {
    return returnsError(ERROR_CODE.RESOURCE_NOT_FOUND, "Return Request was not found.", 404);
  }

  /** Returns the stable seller/customer scope error required by Module 14. */
  private scopeForbidden(): AppError {
    return returnsError(
      RETURNS_ERROR_CODE.SCOPE_FORBIDDEN,
      "Return Request is outside the authorized scope.",
      403,
    );
  }

  /** Returns the stable lifecycle conflict for an invalid Return command transition. */
  private statusInvalid(): AppError {
    return returnsError(
      RETURNS_ERROR_CODE.STATUS_INVALID,
      "Return Request status does not allow this operation.",
      409,
    );
  }
}

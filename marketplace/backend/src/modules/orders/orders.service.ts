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
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import type {
  OrderAddressRow,
  OrderItemRow,
  OrderRow,
  OrderStatusHistoryRow,
  SellerOrderRow,
} from "../../database/schema/orders.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { INVENTORY_ERROR_CODE } from "../inventory/inventory.constants.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  ORDER_CANCEL_REQUEST_VERSION,
  ORDER_FULFILLMENT_STATUS,
  ORDER_IDEMPOTENCY_SCOPE,
  ORDER_ITEM_STATUS,
  ORDER_PAYMENT_STATUS,
  ORDER_SOURCE_TYPE,
  ORDER_STATUS,
  ORDERS_AUDIT_ACTION,
  ORDERS_ERROR_CODE,
  ORDERS_LIMITS,
  ORDERS_OUTBOX_EVENT,
  ORDERS_PERMISSION,
  ORDERS_RESOURCE_TYPE,
  SELLER_ORDER_STATUS,
} from "./orders.constants.js";
import {
  OrdersRepository,
  type CreateOrderStatusHistoryRecordInput,
  type OrderPaymentBoundaryRow,
  type OrderReviewEligibilityRow,
  type OrderSellerScope,
  type SellerOrderWithParentRow,
} from "./orders.repository.js";
import {
  createOrderFromCheckoutInputSchema,
  customerOrderDetailSchema,
  type AdminOrderListQuery,
  type CancelOrderInput,
  type CreateOrderFromCheckoutInput,
  type CustomerOrderDetail,
  type CustomerOrderListQuery,
  type CustomerOrderSummary,
  type OrderItemResponse,
  type PaymentConfirmedInput,
  type SellerOrderDetail,
  type SellerOrderListItem,
  type SellerOrderListQuery,
} from "./orders.schema.js";

/** Runs one Orders transaction and allows focused service tests to replace the real database boundary. */
export type OrdersTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Transaction-bound Inventory boundary used by Payment confirmation and pre-capture cancellation. */
export interface OrdersInventoryIntegration {
  /** Commits one still-live Inventory reservation before an Order becomes payment-confirmed. */
  commitStockReservation(
    context: RequestContext,
    input: { reservationId: string },
  ): Promise<unknown>;

  /** Releases one still-reserved quantity while preserving Inventory ledger evidence. */
  releaseReservationQuantity(
    context: RequestContext,
    input: { reservationId: string; quantity: number; sourceKey: string },
  ): Promise<unknown>;
}

/** Foundation idempotency boundary used by customer/admin cancellation commands. */
export interface OrdersIdempotencyIntegration {
  /** Acquires or resolves one actor-scoped cancellation retry key. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores one stable successful cancellation response for exact replay. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Marks one failed in-progress cancellation key so a later retry can reacquire it. */
  fail(recordId: string): Promise<void>;
}

/** Small audit boundary used both inside transactions and for durable source-conflict evidence. */
export interface OrdersAuditIntegration {
  /** Appends one secret-redacted audit record. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Small outbox boundary used to append durable Module 11 domain events. */
export interface OrdersOutboxIntegration {
  /** Appends one durable event inside the current business transaction. */
  enqueue<TPayload>(event: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit dependencies keep Orders orchestration simple and independently testable. */
export interface OrdersServiceDependencies {
  repository?: OrdersRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => OrdersRepository;
  transactionRunner?: OrdersTransactionRunner;
  inventoryUsingTransaction?: (transaction: DatabaseTransaction) => OrdersInventoryIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => OrdersAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => OrdersOutboxIntegration;
  securityAudit?: OrdersAuditIntegration;
  idempotency?: OrdersIdempotencyIntegration;
  now?: () => Date;
  createId?: () => string;
}

/** Minimal result returned to Checkout after one Order is materialized exactly once. */
export interface CreatedOrderResult {
  id: string;
  orderNo: string;
}

/** Paginated Customer Order list before the HTTP envelope is applied. */
export interface PaginatedCustomerOrdersResult {
  items: CustomerOrderSummary[];
  meta: PaginationMeta;
}

/** Paginated Seller Order queue before the HTTP envelope is applied. */
export interface PaginatedSellerOrdersResult {
  items: SellerOrderListItem[];
  meta: PaginationMeta;
}

/** Paginated admin Customer Order search before the HTTP envelope is applied. */
export interface PaginatedAdminOrdersResult {
  items: CustomerOrderSummary[];
  meta: PaginationMeta;
}

/** Trusted immutable Order/payment-deadline snapshot consumed by Module 12 without importing Orders persistence. */
export interface OrderPaymentSnapshot {
  orderId: string;
  customerUserId: string;
  currency: string;
  grandTotal: string;
  paymentStatus: string;
  orderStatus: string;
  checkoutAttemptId: string;
  paymentExpiresAt: string;
  remainingItemQuantity: number;
}

/** Narrow result returned when Module 12 expiry maintenance asks Orders to cancel an unpaid Order. */
export interface ExpireUnpaidOrderResult {
  orderId: string;
  expired: boolean;
  orderStatus: string;
}

/** Minimal overdue Order identity exposed only to Module 12 Payment maintenance. */
export interface OverduePaymentOrderCandidate {
  orderId: string;
  paymentExpiresAt: string;
}

/** Stable participant identifiers exposed only to Module 18 notification policy. */
export interface OrderNotificationParticipants {
  customerUserId: string;
  sellerIds: string[];
}

/** Immutable Order Item economics exposed only to trusted Commission settlement. */
export interface OrderCommissionItemSnapshot {
  orderItemId: string;
  sellerOrderId: string;
  sellerId: string;
  productId: string;
  quantity: number;
  cancelledQuantity: number;
  unitPrice: string;
  discountAllocated: string;
  taxAllocated: string;
  lineTotal: string;
}

/** Trusted Order snapshot consumed by Module 16 without importing Orders persistence. */
export interface OrderCommissionSnapshot {
  orderId: string;
  currency: string;
  grandTotal: string;
  paymentStatus: string;
  orderStatus: string;
  capturedAt: string | null;
  couponCode: string | null;
  items: OrderCommissionItemSnapshot[];
}


/** Trusted immutable purchase identity exposed only to Module 15 Review eligibility. */
export interface OrderReviewEligibilitySnapshot {
  orderId: string;
  customerUserId: string;
  orderItemId: string;
  productId: string;
  sellerId: string;
  storeId: string;
  quantity: number;
  cancelledQuantity: number;
}

/** Trusted Order Item facts exposed only to Module 13 Shipping orchestration. */
export interface OrderShippingItemSnapshot {
  orderItemId: string;
  sellerOrderId: string;
  variantId: string;
  inventoryReservationId: string;
  quantity: number;
  cancelledQuantity: number;
}

/** Seller Order and parent facts needed by Shipping without importing Orders persistence. */
export interface OrderShippingFulfillmentSnapshot {
  orderId: string;
  sellerOrderId: string;
  sellerId: string;
  storeId: string;
  paymentStatus: string;
  sellerOrderStatus: string;
  fulfillmentStatus: string;
  items: OrderShippingItemSnapshot[];
}

/** Immutable Order Item facts exposed only to trusted Module 14 Return orchestration. */
export interface OrderReturnItemSnapshot {
  orderItemId: string;
  sellerOrderId: string;
  sellerId: string;
  storeId: string;
  variantId: string;
  quantity: number;
  cancelledQuantity: number;
  unitPrice: string;
  discountAllocated: string;
  taxAllocated: string;
  lineTotal: string;
}

/** Trusted immutable Order facts used by Module 14 without importing Orders persistence. */
export interface OrderReturnSnapshot {
  orderId: string;
  customerUserId: string;
  currency: string;
  paymentStatus: string;
  orderStatus: string;
  items: OrderReturnItemSnapshot[];
}

/** One deterministic seller/store group assembled from trusted Checkout lines. */
interface CheckoutSellerGroup {
  key: string;
  sellerId: string;
  storeId: string;
  lines: CreateOrderFromCheckoutInput["lines"];
  shipping: CreateOrderFromCheckoutInput["shippingSelections"][number];
}

/** Exact fixed four-decimal scale used for all Module 11 money reconciliation. */
const MONEY_FACTOR = 10_000n;

/** Converts one canonical non-negative money string into an exact scale-4 integer. */
function moneyToScale4(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MONEY_FACTOR + BigInt(`${fraction}0000`.slice(0, 4));
}

/** Converts one non-negative scale-4 integer into the canonical Orders money string. */
function scale4ToMoney(value: bigint): string {
  const whole = value / MONEY_FACTOR;
  const fraction = (value % MONEY_FACTOR).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** Creates one stable SHA-256 lowercase hexadecimal digest. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Formats the immutable human-readable Customer Order number from its UUID. */
function orderNumber(id: string): string {
  return `ORD-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Formats the immutable human-readable Seller Order number from its UUID. */
function sellerOrderNumber(id: string): string {
  return `SOR-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Creates one stable Module 11 business error. */
function ordersError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Module 11 business service for immutable Order snapshots, scoped reads, and lifecycle commands. */
export class OrdersService {
  private readonly repository: OrdersRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => OrdersRepository;
  private readonly transactionRunner: OrdersTransactionRunner;
  private readonly inventoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => OrdersInventoryIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => OrdersAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => OrdersOutboxIntegration;
  private readonly securityAudit: OrdersAuditIntegration;
  private readonly idempotency: OrdersIdempotencyIntegration;
  private readonly now: () => Date;
  private readonly createId: () => string;

  /** Stores explicit dependencies while keeping the default application composition straightforward. */
  constructor(dependencies: OrdersServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new OrdersRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ?? ((transaction) => new OrdersRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.inventoryUsingTransaction =
      dependencies.inventoryUsingTransaction ?? ((transaction) => InventoryService.using(transaction));
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.securityAudit = dependencies.securityAudit ?? AuditService.using(db);
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  /** Creates an Orders service that participates in an existing cross-module transaction. */
  static using(transaction: DatabaseTransaction): OrdersService {
    return new OrdersService({
      repository: new OrdersRepository(transaction),
      repositoryUsingTransaction: () => new OrdersRepository(transaction),
      transactionRunner: async (work) => work(transaction),
      inventoryUsingTransaction: () => InventoryService.using(transaction),
      auditUsingTransaction: () => AuditService.using(transaction),
      outboxUsingTransaction: () => OutboxService.using(transaction),
    });
  }

  /** Materializes one immutable Customer Order and deterministic Seller Orders from trusted Checkout state. */
  async createFromCheckout(
    context: RequestContext,
    input: CreateOrderFromCheckoutInput,
  ): Promise<CreatedOrderResult> {
    const validated = createOrderFromCheckoutInputSchema.safeParse(input);
    if (!validated.success) {
      throw ordersError(
        ERROR_CODE.VALIDATION_FAILED,
        "Checkout Order snapshot is invalid.",
        422,
      );
    }

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const replay = await this.findCheckoutReplay(
        context,
        repository,
        validated.data,
      );
      if (replay) return replay;

      const groups = this.buildCheckoutSellerGroups(validated.data);
      this.assertCheckoutMoneyReconciles(validated.data, groups);

      const order = await this.createCheckoutParentOrder(repository, validated.data);
      const sellerOrders = await this.createCheckoutSellerOrders(
        repository,
        order.id,
        groups,
      );
      await this.createCheckoutOrderItems(
        repository,
        order.id,
        sellerOrders.idByGroup,
        validated.data.lines,
      );
      await this.createInitialCheckoutOrderState(
        repository,
        order.id,
        sellerOrders.rows,
        validated.data,
      );
      await this.recordCheckoutOrderCreated(
        transaction,
        context,
        order,
        sellerOrders.rows,
        validated.data.checkoutAttemptId,
      );

      return { id: order.id, orderNo: order.orderNo };
    });
  }

  /** Returns immutable Order/Item economics for trusted Commission posting after provider capture. */
  async getCommissionSnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<OrderCommissionSnapshot> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw ordersError(ERROR_CODE.FORBIDDEN, "Internal Commission Order access is required.", 403);
    }

    const order = await this.repository.findOrderById(orderId);
    if (!order) throw this.orderNotFound();

    const [sellerOrders, items, couponCode] = await Promise.all([
      this.repository.listSellerOrdersByOrderId(order.id),
      this.repository.listOrderItemsByOrderId(order.id),
      this.repository.findCheckoutCouponCodeByAttemptId(order.checkoutAttemptId),
    ]);
    const sellerIdBySellerOrder = new Map(
      sellerOrders.map((sellerOrder) => [sellerOrder.id, sellerOrder.sellerId]),
    );

    return {
      orderId: order.id,
      currency: order.currency,
      grandTotal: order.grandTotal,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      capturedAt: order.placedAt?.toISOString() ?? null,
      couponCode,
      items: items.map((item) => {
        const sellerId = sellerIdBySellerOrder.get(item.sellerOrderId);
        if (!sellerId) {
          throw ordersError(ERROR_CODE.INTERNAL_ERROR, "Order Item seller ownership is inconsistent.", 500);
        }
        return {
          orderItemId: item.id,
          sellerOrderId: item.sellerOrderId,
          sellerId,
          productId: item.productId,
          quantity: item.qty,
          cancelledQuantity: item.cancelledQty,
          unitPrice: item.unitPrice,
          discountAllocated: item.discountAllocated,
          taxAllocated: item.taxAllocated,
          lineTotal: item.lineTotal,
        };
      }),
    };
  }


  /** Returns immutable purchase ownership required by trusted Module 15 Review eligibility. */
  async getReviewEligibilitySnapshot(
    context: RequestContext,
    orderItemId: string,
  ): Promise<OrderReviewEligibilitySnapshot | null> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw ordersError(
        ERROR_CODE.FORBIDDEN,
        "Internal Review Order access is required.",
        403,
      );
    }

    const row = await this.repository.findReviewEligibilityByOrderItemId(orderItemId);
    return row ? this.toReviewEligibilitySnapshot(row) : null;
  }

  /** Returns immutable Order ownership, seller scope, variant identity, and item economics for trusted Module 14 Returns. */
  async getReturnSnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<OrderReturnSnapshot> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw ordersError(ERROR_CODE.FORBIDDEN, "Internal Return Order access is required.", 403);
    }

    const order = await this.repository.findOrderById(orderId);
    if (!order) throw this.orderNotFound();
    const [sellerOrderRows, itemRows] = await Promise.all([
      this.repository.listSellerOrdersByOrderId(order.id),
      this.repository.listOrderItemsByOrderId(order.id),
    ]);
    const sellerScopeBySellerOrder = new Map(
      sellerOrderRows.map((sellerOrder) => [
        sellerOrder.id,
        { sellerId: sellerOrder.sellerId, storeId: sellerOrder.storeId },
      ]),
    );

    return {
      orderId: order.id,
      customerUserId: order.customerUserId,
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      items: itemRows.map((item) => {
        const scope = sellerScopeBySellerOrder.get(item.sellerOrderId);
        if (!scope) {
          throw ordersError(ERROR_CODE.INTERNAL_ERROR, "Order Item seller ownership is inconsistent.", 500);
        }
        return {
          orderItemId: item.id,
          sellerOrderId: item.sellerOrderId,
          sellerId: scope.sellerId,
          storeId: scope.storeId,
          variantId: item.variantId,
          quantity: item.qty,
          cancelledQuantity: item.cancelledQty,
          unitPrice: item.unitPrice,
          discountAllocated: item.discountAllocated,
          taxAllocated: item.taxAllocated,
          lineTotal: item.lineTotal,
        };
      }),
    };
  }

  /** Returns seller-scoped Order and reservation facts required by Module 13 Shipping. */
  async getShippingFulfillmentSnapshot(
    sellerOrderId: string,
    scope: OrderSellerScope,
  ): Promise<OrderShippingFulfillmentSnapshot | null> {
    const row = await this.repository.findSellerOrderInScope(sellerOrderId, scope);
    if (!row) return null;

    const items = await this.repository.listOrderItemsBySellerOrderInScope(
      sellerOrderId,
      scope,
    );

    return {
      orderId: row.order.id,
      sellerOrderId: row.sellerOrder.id,
      sellerId: row.sellerOrder.sellerId,
      storeId: row.sellerOrder.storeId,
      paymentStatus: row.order.paymentStatus,
      sellerOrderStatus: row.sellerOrder.status,
      fulfillmentStatus: row.order.fulfillmentStatus,
      items: items.map((item) => ({
        orderItemId: item.id,
        sellerOrderId: item.sellerOrderId,
        variantId: item.variantId,
        inventoryReservationId: item.inventoryReservationId,
        quantity: item.qty,
        cancelledQuantity: item.cancelledQty,
      })),
    };
  }

  /** Updates the parent Order fulfillment state from Shipping's authoritative issued quantity. */
  async applyShippingFulfillmentStatus(
    orderId: string,
    issuedQuantity: number,
  ): Promise<string> {
    if (!Number.isInteger(issuedQuantity) || issuedQuantity < 0) {
      throw ordersError(ERROR_CODE.INTERNAL_ERROR, "Shipping issued quantity is invalid.", 500);
    }

    const order = await this.repository.lockOrderById(orderId);
    if (!order) throw this.orderNotFound();
    const items = await this.repository.lockOrderItemsByOrderId(orderId);
    const commercialQuantity = items.reduce(
      (total, item) => total + this.remainingQuantity(item),
      0,
    );
    if (issuedQuantity > commercialQuantity) {
      throw ordersError(ERROR_CODE.INTERNAL_ERROR, "Shipping quantity exceeds Order quantity.", 500);
    }

    const nextStatus =
      issuedQuantity === 0
        ? ORDER_FULFILLMENT_STATUS.UNFULFILLED
        : issuedQuantity < commercialQuantity
          ? ORDER_FULFILLMENT_STATUS.PARTIALLY_FULFILLED
          : ORDER_FULFILLMENT_STATUS.FULFILLED;

    if (order.fulfillmentStatus !== nextStatus) {
      const updated = await this.repository.updateOrderFulfillmentStatus(
        order.id,
        nextStatus,
        this.now(),
      );
      if (!updated) throw this.orderNotFound();
    }
    return nextStatus;
  }

  /** Returns whether one Customer Order belongs to a specific authenticated customer. */
  async customerOwnsOrder(orderId: string, customerUserId: string): Promise<boolean> {
    return Boolean(await this.repository.findOrderForCustomer(orderId, customerUserId));
  }

  /** Returns whether one parent Order exists for an already-authorized platform read. */
  async orderExists(orderId: string): Promise<boolean> {
    return Boolean(await this.repository.findOrderById(orderId));
  }

  /** Resolves immutable customer and seller participants for one committed Order notification event. */
  async resolveNotificationParticipants(
    orderId: string,
  ): Promise<OrderNotificationParticipants | null> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) return null;

    const sellerOrders = await this.repository.listSellerOrdersByOrderId(order.id);
    const sellerIds = Array.from(
      new Set(sellerOrders.map((sellerOrder) => sellerOrder.sellerId)),
    ).sort();

    return {
      customerUserId: order.customerUserId,
      sellerIds,
    };
  }

  /** Returns the immutable Order amount/state and Checkout deadline required by Module 12 Payment orchestration. */
  async getPaymentSnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<OrderPaymentSnapshot> {
    const boundary = await this.findPaymentBoundaryForContext(context, orderId);
    const items = await this.repository.listOrderItemsByOrderId(boundary.order.id);
    const remainingItemQuantity = items.reduce(
      (total, item) => total + this.remainingQuantity(item),
      0,
    );

    return this.toPaymentSnapshot(boundary, remainingItemQuantity);
  }

  /** Lists a bounded deterministic batch of overdue unpaid Orders for trusted Payments maintenance. */
  async listOverduePaymentOrderCandidates(
    context: RequestContext,
    limit = 100,
  ): Promise<OverduePaymentOrderCandidate[]> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw ordersError(ERROR_CODE.FORBIDDEN, "System Payment maintenance is required.", 403);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw ordersError(
        ERROR_CODE.VALIDATION_FAILED,
        "Payment maintenance batch size must be between 1 and 100.",
        422,
      );
    }

    const rows = await this.repository.listOverduePaymentOrderCandidates({
      expiredBefore: this.now(),
      paymentStatuses: [ORDER_PAYMENT_STATUS.PENDING],
      orderStatuses: [ORDER_STATUS.PENDING_PAYMENT],
      limit,
    });

    return rows.map((row) => ({
      orderId: row.order.id,
      paymentExpiresAt: row.paymentExpiresAt.toISOString(),
    }));
  }

  /** Cancels one still-unpaid Order after its Checkout-derived Payment deadline and releases remaining reservations. */
  async expireUnpaidOrder(
    context: RequestContext,
    orderId: string,
    sourceKey: string,
  ): Promise<ExpireUnpaidOrderResult> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw ordersError(ERROR_CODE.FORBIDDEN, "System Payment maintenance is required.", 403);
    }

    const normalizedSourceKey = sourceKey.trim();
    if (!normalizedSourceKey || normalizedSourceKey.length > ORDERS_LIMITS.PAYMENT_SOURCE_KEY_MAX_LENGTH) {
      throw ordersError(ERROR_CODE.VALIDATION_FAILED, "Payment expiry source key is invalid.", 422);
    }

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const order = await repository.lockOrderById(orderId);
      if (!order) throw this.orderNotFound();

      const existingSource = await repository.findStatusHistoryBySource(
        ORDER_SOURCE_TYPE.PAYMENT_EXPIRED,
        normalizedSourceKey,
      );
      if (existingSource) {
        if (existingSource.orderId !== order.id) throw this.sourceDuplicate();
        return { orderId: order.id, expired: false, orderStatus: order.orderStatus };
      }

      if (order.paymentStatus === ORDER_PAYMENT_STATUS.CAPTURED) {
        return { orderId: order.id, expired: false, orderStatus: order.orderStatus };
      }

      const boundary = await repository.findPaymentBoundaryByOrderId(order.id);
      if (!boundary) throw this.orderNotFound();
      if (this.now().getTime() < boundary.paymentExpiresAt.getTime()) {
        return { orderId: order.id, expired: false, orderStatus: order.orderStatus };
      }
      if (order.orderStatus === ORDER_STATUS.CANCELLED) {
        return { orderId: order.id, expired: false, orderStatus: order.orderStatus };
      }
      if (
        order.paymentStatus !== ORDER_PAYMENT_STATUS.PENDING ||
        order.fulfillmentStatus !== ORDER_FULFILLMENT_STATUS.UNFULFILLED
      ) {
        throw this.statusInvalid("Only an unpaid unfulfilled Order may expire.");
      }

      const items = await repository.lockOrderItemsByOrderId(order.id);
      const inventory = this.inventoryUsingTransaction(transaction);
      const updatedItems = [...items];
      for (let index = 0; index < updatedItems.length; index += 1) {
        const item = updatedItems[index];
        if (!item) continue;
        const remaining = this.remainingQuantity(item);
        if (remaining === 0) continue;

        try {
          await inventory.releaseReservationQuantity(context, {
            reservationId: item.inventoryReservationId,
            quantity: remaining,
            sourceKey: `payment-expiry:${order.id}:${sha256(normalizedSourceKey)}:${item.id}`,
          });
        } catch (error) {
          if (this.isInventoryReservationFailure(error)) {
            throw this.cancellationNotAllowed();
          }
          throw error;
        }

        const updated = await repository.updateOrderItemCancellation(
          item.id,
          item.qty,
          ORDER_ITEM_STATUS.CANCELLED,
          this.now(),
        );
        if (!updated) throw this.cancellationNotAllowed();
        updatedItems[index] = updated;
      }

      const sellerOrders = await repository.listSellerOrdersByOrderId(order.id);
      const sellerHistory: CreateOrderStatusHistoryRecordInput[] = [];
      for (const sellerOrder of sellerOrders) {
        if (sellerOrder.status === SELLER_ORDER_STATUS.CANCELLED) continue;
        const updated = await repository.updateSellerOrderStatus(
          sellerOrder.id,
          SELLER_ORDER_STATUS.CANCELLED,
          this.now(),
        );
        if (!updated) throw this.cancellationNotAllowed();
        sellerHistory.push({
          sellerOrderId: sellerOrder.id,
          fromStatus: sellerOrder.status,
          toStatus: SELLER_ORDER_STATUS.CANCELLED,
          reason: "Payment window expired.",
          changedAt: this.now(),
        });
      }

      const updatedOrder = await repository.updateDerivedOrderStatus(
        order.id,
        ORDER_STATUS.CANCELLED,
        this.now(),
      );
      if (!updatedOrder) throw this.orderNotFound();

      await repository.createStatusHistory([
        ...sellerHistory,
        {
          orderId: order.id,
          fromStatus: order.orderStatus,
          toStatus: ORDER_STATUS.CANCELLED,
          reason: "Payment window expired.",
          changedAt: this.now(),
          sourceType: ORDER_SOURCE_TYPE.PAYMENT_EXPIRED,
          sourceKey: normalizedSourceKey,
        },
      ]);

      await this.auditUsingTransaction(transaction).record({
        actorId: null,
        actorType: context.actorType,
        action: ORDERS_AUDIT_ACTION.PAYMENT_EXPIRED,
        entityType: ORDERS_RESOURCE_TYPE.ORDER,
        entityId: order.id,
        requestId: context.requestId,
        before: { paymentStatus: order.paymentStatus, orderStatus: order.orderStatus },
        after: { paymentStatus: order.paymentStatus, orderStatus: ORDER_STATUS.CANCELLED },
        metadata: { sourceKeyHash: sha256(normalizedSourceKey) },
      });

      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: ORDERS_OUTBOX_EVENT.CANCELLED,
        aggregateType: ORDERS_RESOURCE_TYPE.ORDER,
        aggregateId: order.id,
        payload: {
          orderId: order.id,
          orderStatus: ORDER_STATUS.CANCELLED,
          reason: "payment_window_expired",
        },
      });

      return { orderId: order.id, expired: true, orderStatus: updatedOrder.orderStatus };
    });
  }

  /** Lists only the authenticated customer's own parent Orders. */
  async listCustomerOrders(
    context: RequestContext,
    query: CustomerOrderListQuery,
  ): Promise<PaginatedCustomerOrdersResult> {
    const customerUserId = this.requireActor(context);
    assertPermission(context, ORDERS_PERMISSION.READ_OWN);
    const result = await this.repository.listOrdersForCustomer(customerUserId, query);
    return {
      items: result.items.map((order) => this.toCustomerOrderSummary(order)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Reads one Customer Order only when it belongs to the authenticated customer. */
  async getCustomerOrder(context: RequestContext, orderId: string): Promise<CustomerOrderDetail> {
    const customerUserId = this.requireActor(context);
    assertPermission(context, ORDERS_PERMISSION.READ_OWN);
    const order = await this.repository.findOrderForCustomer(orderId, customerUserId);
    if (!order) throw this.orderNotFound();
    return this.buildCustomerOrderDetail(this.repository, order);
  }

  /** Lists Seller Orders only inside seller/store scopes where seller.orders.read is effective. */
  async listSellerOrders(
    context: RequestContext,
    query: SellerOrderListQuery,
  ): Promise<PaginatedSellerOrdersResult> {
    const scope = this.resolveSellerScope(context, ORDERS_PERMISSION.SELLER_READ);
    this.assertStoreInSellerScope(query.storeId, scope);
    const result = await this.repository.listSellerOrdersInScope(scope, query);
    return {
      items: result.items.map((row) => this.toSellerOrderListItem(row)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Reads one Seller Order only inside the actor's seller/store read scope. */
  async getSellerOrder(context: RequestContext, sellerOrderId: string): Promise<SellerOrderDetail> {
    const scope = this.resolveSellerScope(context, ORDERS_PERMISSION.SELLER_READ);
    const row = await this.repository.findSellerOrderInScope(sellerOrderId, scope);
    if (!row) throw this.sellerScopeForbidden();
    return this.buildSellerOrderDetail(this.repository, row, scope);
  }

  /** Searches Customer Orders for a platform actor with admin.orders.read. */
  async listAdminOrders(
    context: RequestContext,
    query: AdminOrderListQuery,
  ): Promise<PaginatedAdminOrdersResult> {
    this.requireActor(context);
    assertPermission(context, ORDERS_PERMISSION.ADMIN_READ);
    const result = await this.repository.listAdminOrders(query);
    return {
      items: result.items.map((order) => this.toCustomerOrderSummary(order)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Confirms provider-authoritative payment exactly once and commits all remaining Inventory reservations. */
  async confirmPayment(
    context: RequestContext,
    orderId: string,
    input: PaymentConfirmedInput,
  ): Promise<CustomerOrderDetail> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const order = await repository.lockOrderById(orderId);
      if (!order) throw this.orderNotFound();

      const sourceKey = input.sourceKey.trim();
      const replay = await this.findPaymentConfirmationReplay(
        context,
        repository,
        order,
        sourceKey,
      );
      if (replay) return replay;

      this.assertPaymentConfirmationAllowed(order, input);
      const items = await repository.lockOrderItemsByOrderId(order.id);
      if (!items.some((item) => this.remainingQuantity(item) > 0)) {
        throw this.statusInvalid("A fully cancelled Order cannot be payment-confirmed.");
      }

      await this.commitPaymentReservations(context, transaction, items);

      const capturedAt = new Date(input.capturedAt);
      const capturedOrder = await repository.markOrderPaymentCaptured(
        order.id,
        capturedAt,
        this.now(),
      );
      if (!capturedOrder) throw this.orderNotFound();

      const sellerTransition = await this.transitionSellerOrdersAfterPayment(
        repository,
        order.id,
        items,
      );
      const nextOrderStatus = this.deriveParentOrderStatus(
        ORDER_PAYMENT_STATUS.CAPTURED,
        sellerTransition.rows,
        items,
      );
      const updatedOrder =
        order.orderStatus === nextOrderStatus
          ? capturedOrder
          : await repository.updateDerivedOrderStatus(
              order.id,
              nextOrderStatus,
              this.now(),
            );
      if (!updatedOrder) throw this.orderNotFound();

      await this.recordPaymentConfirmationHistory(
        repository,
        order,
        nextOrderStatus,
        input,
        sourceKey,
        sellerTransition.history,
      );

      await this.recordPaymentConfirmation(
        transaction,
        context,
        order,
        nextOrderStatus,
        input,
        sourceKey,
        capturedAt,
      );

      const finalOrder = await repository.findOrderById(order.id);
      if (!finalOrder) throw this.orderNotFound();
      return this.buildCustomerOrderDetail(repository, finalOrder);
    });
  }

  /** Accepts one paid Seller Order exactly once inside the actor's seller/store manage scope. */
  async acceptSellerOrder(
    context: RequestContext,
    sellerOrderId: string,
  ): Promise<SellerOrderDetail> {
    const scope = this.resolveSellerScope(context, ORDERS_PERMISSION.SELLER_MANAGE);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const locked = await repository.lockSellerOrderInScope(sellerOrderId, scope);
      if (!locked) throw this.sellerScopeForbidden();

      if (locked.sellerOrder.status === SELLER_ORDER_STATUS.PROCESSING) {
        return this.buildSellerOrderDetail(repository, locked, scope);
      }
      if (
        locked.order.paymentStatus !== ORDER_PAYMENT_STATUS.CAPTURED ||
        locked.sellerOrder.status !== SELLER_ORDER_STATUS.PENDING_ACCEPTANCE
      ) {
        throw this.statusInvalid("This Seller Order is not ready to be accepted.");
      }

      const updatedSellerOrder = await repository.updateSellerOrderStatus(
        locked.sellerOrder.id,
        SELLER_ORDER_STATUS.PROCESSING,
        this.now(),
      );
      if (!updatedSellerOrder) throw this.statusInvalid("Seller Order state changed during acceptance.");

      await repository.createStatusHistory([
        {
          sellerOrderId: updatedSellerOrder.id,
          fromStatus: locked.sellerOrder.status,
          toStatus: SELLER_ORDER_STATUS.PROCESSING,
          changedBy: context.actorId,
          changedAt: this.now(),
        },
      ]);

      const allSellerOrders = await repository.listSellerOrdersByOrderId(locked.order.id);
      const effectiveSellerOrders = allSellerOrders.map((sellerOrder) =>
        sellerOrder.id === updatedSellerOrder.id ? updatedSellerOrder : sellerOrder,
      );
      const items = await repository.listOrderItemsByOrderId(locked.order.id);
      const nextOrderStatus = this.deriveParentOrderStatus(
        locked.order.paymentStatus,
        effectiveSellerOrders,
        items,
      );
      const finalParent = await this.persistDerivedParentStatusIfChanged(
        repository,
        this.outboxUsingTransaction(transaction),
        locked.order,
        nextOrderStatus,
        context.actorId,
      );

      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: ORDERS_AUDIT_ACTION.SELLER_ORDER_ACCEPTED,
        entityType: ORDERS_RESOURCE_TYPE.SELLER_ORDER,
        entityId: updatedSellerOrder.id,
        sellerId: updatedSellerOrder.sellerId,
        requestId: context.requestId,
        before: { status: locked.sellerOrder.status },
        after: { status: updatedSellerOrder.status },
        metadata: { orderId: locked.order.id },
      });

      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: ORDERS_OUTBOX_EVENT.SELLER_ORDER_ACCEPTED,
        aggregateType: ORDERS_RESOURCE_TYPE.SELLER_ORDER,
        aggregateId: updatedSellerOrder.id,
        payload: {
          sellerOrderId: updatedSellerOrder.id,
          orderId: locked.order.id,
          sellerId: updatedSellerOrder.sellerId,
          storeId: updatedSellerOrder.storeId,
          status: updatedSellerOrder.status,
        },
      });

      return this.buildSellerOrderDetail(
        repository,
        { sellerOrder: updatedSellerOrder, order: finalParent },
        scope,
      );
    });
  }

  /** Cancels the authenticated customer's own pre-capture Order quantities with Foundation idempotency. */
  async cancelCustomerOrder(
    context: RequestContext,
    orderId: string,
    input: CancelOrderInput,
    idempotencyKey: string,
  ): Promise<CustomerOrderDetail> {
    const actorId = this.requireActor(context);
    assertPermission(context, ORDERS_PERMISSION.READ_OWN);
    return this.cancelOrderIdempotently(
      context,
      orderId,
      input,
      idempotencyKey,
      `${ORDER_IDEMPOTENCY_SCOPE.CUSTOMER_CANCEL}:${actorId}`,
      false,
    );
  }

  /** Cancels pre-capture Order quantities through the privileged admin command with Foundation idempotency. */
  async cancelAdminOrder(
    context: RequestContext,
    orderId: string,
    input: CancelOrderInput,
    idempotencyKey: string,
  ): Promise<CustomerOrderDetail> {
    const actorId = this.requireActor(context);
    assertPermission(context, ORDERS_PERMISSION.ADMIN_CANCEL);
    return this.cancelOrderIdempotently(
      context,
      orderId,
      input,
      idempotencyKey,
      `${ORDER_IDEMPOTENCY_SCOPE.ADMIN_CANCEL}:${actorId}`,
      true,
    );
  }

  /** Executes one actor-scoped cancellation once and safely replays the stored customer-safe Order detail. */
  private async cancelOrderIdempotently(
    context: RequestContext,
    orderId: string,
    input: CancelOrderInput,
    idempotencyKey: string,
    scope: string,
    isAdmin: boolean,
  ): Promise<CustomerOrderDetail> {
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const normalizedInput = this.normalizeCancellationInput(input);
    const requestHash = this.buildCancellationRequestHash(orderId, normalizedInput);
    const result = await this.idempotency.begin(
      { scope, key: normalizedKey, requestHash },
      this.now(),
    );

    if (result.mode === "replay") {
      return this.parseCancellationReplay(result.replay.responseBody);
    }

    try {
      const detail = await this.transactionRunner(async (transaction) =>
        this.executeCancellation(
          transaction,
          context,
          orderId,
          normalizedInput,
          normalizedKey,
          isAdmin,
        ),
      );
      await this.idempotency.complete(result.recordId, 200, detail);
      return detail;
    } catch (error) {
      await this.failIdempotencySafely(result.recordId);
      throw error;
    }
  }

  /** Performs the locked pre-capture cancellation, Inventory release, status derivation, audit, and outbox work. */
  private async executeCancellation(
    transaction: DatabaseTransaction,
    context: RequestContext,
    orderId: string,
    input: CancelOrderInput,
    idempotencyKey: string,
    isAdmin: boolean,
  ): Promise<CustomerOrderDetail> {
    const repository = this.repositoryUsingTransaction(transaction);
    const actorId = this.requireActor(context);
    const order = isAdmin
      ? await repository.lockOrderById(orderId)
      : await repository.lockOrderForCustomer(orderId, actorId);
    if (!order) throw this.orderNotFound();
    if (
      order.paymentStatus !== ORDER_PAYMENT_STATUS.PENDING ||
      order.fulfillmentStatus !== ORDER_FULFILLMENT_STATUS.UNFULFILLED
    ) {
      throw this.cancellationNotAllowed();
    }

    const lockedItems = await repository.lockOrderItemsByOrderId(order.id);
    const cancellationQuantities = this.resolveCancellationQuantities(lockedItems, input);
    const inventory = this.inventoryUsingTransaction(transaction);
    const idempotencyKeyHash = sha256(idempotencyKey);
    const updatedItems = [...lockedItems];

    for (const [itemId, quantity] of cancellationQuantities) {
      const itemIndex = updatedItems.findIndex((item) => item.id === itemId);
      const item = updatedItems[itemIndex];
      if (!item) throw this.cancellationNotAllowed();

      try {
        await inventory.releaseReservationQuantity(context, {
          reservationId: item.inventoryReservationId,
          quantity,
          sourceKey: `order-cancel:${order.id}:${idempotencyKeyHash}:${item.id}`,
        });
      } catch (error) {
        if (this.isInventoryReservationFailure(error)) throw this.cancellationNotAllowed();
        throw error;
      }

      const cancelledQty = item.cancelledQty + quantity;
      const status = this.deriveItemStatus(item.qty, cancelledQty);
      const updated = await repository.updateOrderItemCancellation(
        item.id,
        cancelledQty,
        status,
        this.now(),
      );
      if (!updated) throw this.cancellationNotAllowed();
      updatedItems[itemIndex] = updated;
    }

    const sellerOrders = await repository.listSellerOrdersByOrderId(order.id);
    const nextSellerOrders: SellerOrderRow[] = [];
    const sellerHistory: CreateOrderStatusHistoryRecordInput[] = [];
    for (const sellerOrder of sellerOrders) {
      const hasRemaining = updatedItems.some(
        (item) => item.sellerOrderId === sellerOrder.id && this.remainingQuantity(item) > 0,
      );
      if (hasRemaining || sellerOrder.status === SELLER_ORDER_STATUS.CANCELLED) {
        nextSellerOrders.push(sellerOrder);
        continue;
      }
      const updated = await repository.updateSellerOrderStatus(
        sellerOrder.id,
        SELLER_ORDER_STATUS.CANCELLED,
        this.now(),
      );
      if (!updated) throw this.cancellationNotAllowed();
      nextSellerOrders.push(updated);
      sellerHistory.push({
        sellerOrderId: sellerOrder.id,
        fromStatus: sellerOrder.status,
        toStatus: SELLER_ORDER_STATUS.CANCELLED,
        reason: input.reason ?? null,
        changedBy: actorId,
        changedAt: this.now(),
      });
    }

    const nextOrderStatus = this.deriveParentOrderStatus(
      order.paymentStatus,
      nextSellerOrders,
      updatedItems,
    );
    let finalOrder = order;
    const history: CreateOrderStatusHistoryRecordInput[] = [...sellerHistory];
    if (nextOrderStatus !== order.orderStatus) {
      const updated = await repository.updateDerivedOrderStatus(order.id, nextOrderStatus, this.now());
      if (!updated) throw this.cancellationNotAllowed();
      finalOrder = updated;
      history.push({
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: nextOrderStatus,
        reason: input.reason ?? null,
        changedBy: actorId,
        changedAt: this.now(),
      });
    }
    await repository.createStatusHistory(history);

    await this.auditUsingTransaction(transaction).record({
      actorId,
      actorType: context.actorType,
      action: isAdmin
        ? ORDERS_AUDIT_ACTION.ADMIN_CANCELLED
        : ORDERS_AUDIT_ACTION.CUSTOMER_CANCELLED,
      entityType: ORDERS_RESOURCE_TYPE.ORDER,
      entityId: order.id,
      requestId: context.requestId,
      before: { orderStatus: order.orderStatus },
      after: {
        orderStatus: finalOrder.orderStatus,
        cancelledItems: [...cancellationQuantities.entries()].map(([itemId, quantity]) => ({
          itemId,
          quantity,
        })),
      },
      metadata: { idempotencyKeyHash },
    });

    const outbox = this.outboxUsingTransaction(transaction);
    if (order.orderStatus !== finalOrder.orderStatus) {
      if (finalOrder.orderStatus === ORDER_STATUS.CANCELLED) {
        await outbox.enqueue({
          eventType: ORDERS_OUTBOX_EVENT.CANCELLED,
          aggregateType: ORDERS_RESOURCE_TYPE.ORDER,
          aggregateId: order.id,
          payload: { orderId: order.id, orderStatus: finalOrder.orderStatus },
        });
      } else {
        await this.enqueueOrderStatusChanged(
          outbox,
          order.id,
          order.orderStatus,
          finalOrder.orderStatus,
        );
      }
    }

    return this.buildCustomerOrderDetail(repository, finalOrder);
  }

  /** Replays the original Payment-confirmed result or rejects reuse of the source key by another Order. */
  private async findPaymentConfirmationReplay(
    context: RequestContext,
    repository: OrdersRepository,
    order: OrderRow,
    sourceKey: string,
  ): Promise<CustomerOrderDetail | null> {
    const existingSource = await repository.findStatusHistoryBySource(
      ORDER_SOURCE_TYPE.PAYMENT_CONFIRMED,
      sourceKey,
    );
    if (!existingSource) return null;

    if (existingSource.orderId === order.id) {
      return this.buildCustomerOrderDetail(repository, order);
    }

    await this.recordSourceConflict(
      context,
      order.id,
      ORDER_SOURCE_TYPE.PAYMENT_CONFIRMED,
      sourceKey,
    );
    throw this.sourceDuplicate();
  }

  /** Validates immutable Order state and provider-captured money before Inventory is committed. */
  private assertPaymentConfirmationAllowed(
    order: OrderRow,
    input: PaymentConfirmedInput,
  ): void {
    if (
      order.paymentStatus !== ORDER_PAYMENT_STATUS.PENDING ||
      order.orderStatus === ORDER_STATUS.CANCELLED
    ) {
      throw this.statusInvalid(
        "This Order cannot accept another payment-confirmed transition.",
      );
    }
    if (input.currency !== order.currency || input.capturedAmount !== order.grandTotal) {
      throw this.statusInvalid(
        "Captured currency and amount must exactly match the Order snapshot.",
      );
    }
  }

  /** Commits every still-active Inventory reservation required by the paid Order. */
  private async commitPaymentReservations(
    context: RequestContext,
    transaction: DatabaseTransaction,
    items: OrderItemRow[],
  ): Promise<void> {
    const inventory = this.inventoryUsingTransaction(transaction);
    for (const item of items) {
      if (this.remainingQuantity(item) === 0) continue;
      try {
        await inventory.commitStockReservation(context, {
          reservationId: item.inventoryReservationId,
        });
      } catch (error) {
        if (this.isInventoryReservationFailure(error)) {
          throw this.statusInvalid(
            "A required Inventory reservation is no longer valid for payment confirmation.",
          );
        }
        throw error;
      }
    }
  }

  /** Moves each Seller Order from pending payment to acceptance or cancellation after capture. */
  private async transitionSellerOrdersAfterPayment(
    repository: OrdersRepository,
    orderId: string,
    items: OrderItemRow[],
  ): Promise<{
    rows: SellerOrderRow[];
    history: CreateOrderStatusHistoryRecordInput[];
  }> {
    const sellerOrders = await repository.listSellerOrdersByOrderId(orderId);
    const rows: SellerOrderRow[] = [];
    const history: CreateOrderStatusHistoryRecordInput[] = [];

    for (const sellerOrder of sellerOrders) {
      const hasRemaining = items.some(
        (item) =>
          item.sellerOrderId === sellerOrder.id &&
          this.remainingQuantity(item) > 0,
      );
      const nextStatus = hasRemaining
        ? SELLER_ORDER_STATUS.PENDING_ACCEPTANCE
        : SELLER_ORDER_STATUS.CANCELLED;

      if (sellerOrder.status === nextStatus) {
        rows.push(sellerOrder);
        continue;
      }
      if (sellerOrder.status !== SELLER_ORDER_STATUS.PENDING_PAYMENT) {
        throw this.statusInvalid(
          "Seller Order state is not valid for payment confirmation.",
        );
      }

      const updated = await repository.updateSellerOrderStatus(
        sellerOrder.id,
        nextStatus,
        this.now(),
      );
      if (!updated) {
        throw this.statusInvalid(
          "Seller Order state changed during confirmation.",
        );
      }
      rows.push(updated);
      history.push({
        sellerOrderId: sellerOrder.id,
        fromStatus: sellerOrder.status,
        toStatus: nextStatus,
        changedAt: this.now(),
      });
    }

    return { rows, history };
  }

  /** Appends the parent and Seller Order history rows for one successful Payment confirmation. */
  private async recordPaymentConfirmationHistory(
    repository: OrdersRepository,
    order: OrderRow,
    nextOrderStatus: string,
    input: PaymentConfirmedInput,
    sourceKey: string,
    sellerHistory: CreateOrderStatusHistoryRecordInput[],
  ): Promise<void> {
    await repository.createStatusHistory([
      {
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: nextOrderStatus,
        changedAt: this.now(),
        sourceType: ORDER_SOURCE_TYPE.PAYMENT_CONFIRMED,
        sourceKey,
        metadataJson: {
          paymentId: input.paymentId,
          paymentTransactionId: input.paymentTransactionId,
        },
      },
      ...sellerHistory,
    ]);
  }

  /** Writes audit and durable events after Payment confirmation state is persisted successfully. */
  private async recordPaymentConfirmation(
    transaction: DatabaseTransaction,
    context: RequestContext,
    order: OrderRow,
    nextOrderStatus: string,
    input: PaymentConfirmedInput,
    sourceKey: string,
    capturedAt: Date,
  ): Promise<void> {
    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: ORDERS_AUDIT_ACTION.PAYMENT_CONFIRMED,
      entityType: ORDERS_RESOURCE_TYPE.ORDER,
      entityId: order.id,
      requestId: context.requestId,
      before: {
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
      },
      after: {
        paymentStatus: ORDER_PAYMENT_STATUS.CAPTURED,
        orderStatus: nextOrderStatus,
      },
      metadata: {
        paymentId: input.paymentId,
        paymentTransactionId: input.paymentTransactionId,
        sourceKeyHash: sha256(sourceKey),
      },
    });

    const outbox = this.outboxUsingTransaction(transaction);
    await outbox.enqueue({
      eventType: ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED,
      aggregateType: ORDERS_RESOURCE_TYPE.ORDER,
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        paymentStatus: ORDER_PAYMENT_STATUS.CAPTURED,
        orderStatus: nextOrderStatus,
        placedAt: capturedAt.toISOString(),
      },
    });
    if (order.orderStatus !== nextOrderStatus) {
      await this.enqueueOrderStatusChanged(
        outbox,
        order.id,
        order.orderStatus,
        nextOrderStatus,
      );
    }
  }

  /** Returns the previously created Order when a Checkout retry matches the immutable snapshot exactly. */
  private async findCheckoutReplay(
    context: RequestContext,
    repository: OrdersRepository,
    input: CreateOrderFromCheckoutInput,
  ): Promise<CreatedOrderResult | null> {
    const existing = await repository.findOrderByCheckoutAttemptId(input.checkoutAttemptId);
    if (!existing) return null;

    if (await this.existingOrderMatchesCheckout(repository, existing, input)) {
      return { id: existing.id, orderNo: existing.orderNo };
    }

    await this.recordSourceConflict(
      context,
      existing.id,
      "checkout_attempt",
      input.checkoutAttemptId,
    );
    throw this.sourceDuplicate();
  }

  /** Creates the parent Customer Order from the already validated Checkout snapshot. */
  private async createCheckoutParentOrder(
    repository: OrdersRepository,
    input: CreateOrderFromCheckoutInput,
  ): Promise<OrderRow> {
    const orderId = this.createId();
    return repository.createOrder({
      id: orderId,
      orderNo: orderNumber(orderId),
      checkoutAttemptId: input.checkoutAttemptId,
      customerUserId: input.customerUserId,
      currency: input.currency,
      subtotal: input.subtotal,
      discountTotal: input.discountTotal,
      taxTotal: input.taxTotal,
      shippingTotal: input.shippingTotal,
      grandTotal: input.grandTotal,
      paymentStatus: ORDER_PAYMENT_STATUS.PENDING,
      fulfillmentStatus: ORDER_FULFILLMENT_STATUS.UNFULFILLED,
      orderStatus: ORDER_STATUS.PENDING_PAYMENT,
    });
  }

  /** Creates one deterministic Seller Order row for every seller/store Checkout group. */
  private async createCheckoutSellerOrders(
    repository: OrdersRepository,
    orderId: string,
    groups: CheckoutSellerGroup[],
  ): Promise<{ rows: SellerOrderRow[]; idByGroup: Map<string, string> }> {
    const idByGroup = new Map<string, string>();
    const rows = groups.map((group) => {
      const id = this.createId();
      idByGroup.set(group.key, id);
      return {
        id,
        orderId,
        sellerId: group.sellerId,
        storeId: group.storeId,
        sellerOrderNo: sellerOrderNumber(id),
        ...this.calculateSellerGroupTotals(group),
        status: SELLER_ORDER_STATUS.PENDING_PAYMENT,
        shippingMethodId: group.shipping.shippingMethodId,
        shippingMethodCodeSnapshot: group.shipping.shippingMethodCodeSnapshot,
        shippingMethodNameSnapshot: group.shipping.shippingMethodNameSnapshot,
      };
    });

    return {
      rows: await repository.createSellerOrders(rows),
      idByGroup,
    };
  }

  /** Stores immutable Order Item snapshots and links each line to its deterministic Seller Order. */
  private async createCheckoutOrderItems(
    repository: OrdersRepository,
    orderId: string,
    sellerOrderIdByGroup: Map<string, string>,
    lines: CreateOrderFromCheckoutInput["lines"],
  ): Promise<void> {
    await repository.createOrderItems(
      lines.map((line) => {
        const groupKey = this.sellerGroupKey(line.sellerId, line.storeId);
        const sellerOrderId = sellerOrderIdByGroup.get(groupKey);
        if (!sellerOrderId) throw this.sourceDuplicate();
        return {
          id: this.createId(),
          orderId,
          sellerOrderId,
          productId: line.productId,
          variantId: line.variantId,
          inventoryReservationId: line.inventoryReservationId,
          skuSnapshot: line.skuSnapshot,
          nameSnapshot: line.nameSnapshot,
          variantTitleSnapshot: line.variantTitleSnapshot,
          qty: line.quantity,
          unitPrice: line.unitPrice,
          discountAllocated: line.discountAllocated,
          taxAllocated: line.taxAllocated,
          lineTotal: line.lineTotal,
          commissionRuleSnapshotJson: null,
          status: ORDER_ITEM_STATUS.ACTIVE,
          cancelledQty: 0,
        };
      }),
    );
  }

  /** Stores immutable addresses plus the initial parent and Seller Order status history. */
  private async createInitialCheckoutOrderState(
    repository: OrdersRepository,
    orderId: string,
    sellerOrders: SellerOrderRow[],
    input: CreateOrderFromCheckoutInput,
  ): Promise<void> {
    await repository.createOrderAddresses([
      this.toAddressRecord(orderId, "shipping", input.shippingAddress),
      this.toAddressRecord(orderId, "billing", input.billingAddress),
    ]);

    const changedAt = this.now();
    await repository.createStatusHistory([
      {
        orderId,
        toStatus: ORDER_STATUS.PENDING_PAYMENT,
        changedAt,
      },
      ...sellerOrders.map((sellerOrder) => ({
        sellerOrderId: sellerOrder.id,
        toStatus: SELLER_ORDER_STATUS.PENDING_PAYMENT,
        changedAt,
      })),
    ]);
  }

  /** Writes the Order creation audit record and durable parent/Seller Order events. */
  private async recordCheckoutOrderCreated(
    transaction: DatabaseTransaction,
    context: RequestContext,
    order: OrderRow,
    sellerOrders: SellerOrderRow[],
    checkoutAttemptId: string,
  ): Promise<void> {
    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: ORDERS_AUDIT_ACTION.CREATED,
      entityType: ORDERS_RESOURCE_TYPE.ORDER,
      entityId: order.id,
      requestId: context.requestId,
      after: {
        orderNo: order.orderNo,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        sellerOrderCount: sellerOrders.length,
      },
      metadata: { checkoutAttemptId },
    });

    const outbox = this.outboxUsingTransaction(transaction);
    await outbox.enqueue({
      eventType: ORDERS_OUTBOX_EVENT.CREATED,
      aggregateType: ORDERS_RESOURCE_TYPE.ORDER,
      aggregateId: order.id,
      payload: {
        orderId: order.id,
        orderNo: order.orderNo,
        customerUserId: order.customerUserId,
        currency: order.currency,
        grandTotal: order.grandTotal,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
      },
    });

    for (const sellerOrder of sellerOrders) {
      await outbox.enqueue({
        eventType: ORDERS_OUTBOX_EVENT.SELLER_ORDER_CREATED,
        aggregateType: ORDERS_RESOURCE_TYPE.SELLER_ORDER,
        aggregateId: sellerOrder.id,
        payload: {
          sellerOrderId: sellerOrder.id,
          orderId: order.id,
          sellerId: sellerOrder.sellerId,
          storeId: sellerOrder.storeId,
          status: sellerOrder.status,
        },
      });
    }
  }

  /** Builds deterministic seller/store groups and pairs each group with exactly one Checkout Shipping snapshot. */
  private buildCheckoutSellerGroups(input: CreateOrderFromCheckoutInput): CheckoutSellerGroup[] {
    const linesByGroup = new Map<string, CreateOrderFromCheckoutInput["lines"]>();
    for (const line of input.lines) {
      const key = this.sellerGroupKey(line.sellerId, line.storeId);
      const lines = linesByGroup.get(key) ?? [];
      lines.push(line);
      linesByGroup.set(key, lines);
    }

    const shippingByGroup = new Map(
      input.shippingSelections.map((selection: CreateOrderFromCheckoutInput["shippingSelections"][number]) => [
        this.sellerGroupKey(selection.sellerId, selection.storeId),
        selection,
      ]),
    );

    return [...linesByGroup.entries()]
      .map(([key, lines]) => {
        const first = lines[0];
        const shipping = shippingByGroup.get(key);
        if (!first || !shipping) throw this.sourceDuplicate();
        return {
          key,
          sellerId: first.sellerId,
          storeId: first.storeId,
          lines,
          shipping,
        };
      })
      .sort((left, right) =>
        left.storeId === right.storeId
          ? left.sellerId.localeCompare(right.sellerId)
          : left.storeId.localeCompare(right.storeId),
      );
  }

  /** Calculates one Seller Order's exact immutable commercial totals from its grouped lines and Shipping snapshot. */
  private calculateSellerGroupTotals(group: CheckoutSellerGroup) {
    const subtotal = group.lines.reduce(
      (sum: bigint, line: CreateOrderFromCheckoutInput["lines"][number]) =>
        sum + moneyToScale4(line.unitPrice) * BigInt(line.quantity),
      0n,
    );
    const discountTotal = group.lines.reduce(
      (sum: bigint, line: CreateOrderFromCheckoutInput["lines"][number]) =>
        sum + moneyToScale4(line.discountAllocated),
      0n,
    );
    const taxTotal = group.lines.reduce(
      (sum: bigint, line: CreateOrderFromCheckoutInput["lines"][number]) =>
        sum + moneyToScale4(line.taxAllocated),
      0n,
    );
    const shippingTotal = moneyToScale4(group.shipping.amount);
    const grandTotal = subtotal - discountTotal + taxTotal + shippingTotal;
    return {
      subtotal: scale4ToMoney(subtotal),
      discountTotal: scale4ToMoney(discountTotal),
      taxTotal: scale4ToMoney(taxTotal),
      shippingTotal: scale4ToMoney(shippingTotal),
      grandTotal: scale4ToMoney(grandTotal),
    };
  }

  /** Verifies line formulas plus the exact Customer Order ↔ Seller Order money reconciliation contract. */
  private assertCheckoutMoneyReconciles(
    input: CreateOrderFromCheckoutInput,
    groups: CheckoutSellerGroup[],
  ): void {
    for (const line of input.lines) {
      const expectedLineTotal =
        moneyToScale4(line.unitPrice) * BigInt(line.quantity) -
        moneyToScale4(line.discountAllocated) +
        moneyToScale4(line.taxAllocated);
      if (scale4ToMoney(expectedLineTotal) !== line.lineTotal) {
        throw this.sourceDuplicate("Checkout line money does not reconcile.");
      }
    }

    const totals = groups.map((group) => this.calculateSellerGroupTotals(group));
    /** Sums one Seller Order money field with exact scale-4 arithmetic. */
    const sumField = (field: keyof (typeof totals)[number]) =>
      totals.reduce((sum, total) => sum + moneyToScale4(total[field]), 0n);
    const expected = {
      subtotal: input.subtotal,
      discountTotal: input.discountTotal,
      taxTotal: input.taxTotal,
      shippingTotal: input.shippingTotal,
      grandTotal: input.grandTotal,
    };

    for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
      if (scale4ToMoney(sumField(field)) !== expected[field]) {
        throw this.sourceDuplicate(`Checkout ${field} does not reconcile to Seller Orders.`);
      }
    }
  }

  /** Confirms an existing Checkout source still represents the same immutable full commercial snapshot. */
  private async existingOrderMatchesCheckout(
    repository: OrdersRepository,
    order: OrderRow,
    input: CreateOrderFromCheckoutInput,
  ): Promise<boolean> {
    const parentMatches =
      order.customerUserId === input.customerUserId &&
      order.currency === input.currency &&
      order.subtotal === input.subtotal &&
      order.discountTotal === input.discountTotal &&
      order.taxTotal === input.taxTotal &&
      order.shippingTotal === input.shippingTotal &&
      order.grandTotal === input.grandTotal;
    if (!parentMatches) return false;

    const [sellerOrders, items, addresses] = await Promise.all([
      repository.listSellerOrdersByOrderId(order.id),
      repository.listOrderItemsByOrderId(order.id),
      repository.listOrderAddressesByOrderId(order.id),
    ]);
    if (items.length !== input.lines.length) return false;

    const groups = this.buildCheckoutSellerGroups(input);
    if (sellerOrders.length !== groups.length) return false;
    for (const group of groups) {
      const sellerOrder = sellerOrders.find(
        (candidate) =>
          candidate.sellerId === group.sellerId && candidate.storeId === group.storeId,
      );
      if (!sellerOrder) return false;
      const totals = this.calculateSellerGroupTotals(group);
      if (
        sellerOrder.subtotal !== totals.subtotal ||
        sellerOrder.discountTotal !== totals.discountTotal ||
        sellerOrder.taxTotal !== totals.taxTotal ||
        sellerOrder.shippingTotal !== totals.shippingTotal ||
        sellerOrder.grandTotal !== totals.grandTotal ||
        sellerOrder.shippingMethodId !== group.shipping.shippingMethodId ||
        sellerOrder.shippingMethodCodeSnapshot !== group.shipping.shippingMethodCodeSnapshot ||
        sellerOrder.shippingMethodNameSnapshot !== group.shipping.shippingMethodNameSnapshot
      ) {
        return false;
      }
    }

    for (const line of input.lines) {
      const item = items.find(
        (candidate) => candidate.inventoryReservationId === line.inventoryReservationId,
      );
      if (
        !item ||
        item.productId !== line.productId ||
        item.variantId !== line.variantId ||
        item.skuSnapshot !== line.skuSnapshot ||
        item.nameSnapshot !== line.nameSnapshot ||
        item.variantTitleSnapshot !== line.variantTitleSnapshot ||
        item.qty !== line.quantity ||
        item.unitPrice !== line.unitPrice ||
        item.discountAllocated !== line.discountAllocated ||
        item.taxAllocated !== line.taxAllocated ||
        item.lineTotal !== line.lineTotal
      ) {
        return false;
      }
      const sellerOrder = sellerOrders.find((candidate) => candidate.id === item.sellerOrderId);
      if (!sellerOrder || sellerOrder.sellerId !== line.sellerId || sellerOrder.storeId !== line.storeId) {
        return false;
      }
    }

    return (
      this.addressSnapshotMatches(addresses, "shipping", input.shippingAddress) &&
      this.addressSnapshotMatches(addresses, "billing", input.billingAddress)
    );
  }

  /** Compares one immutable persisted address snapshot with the final trusted Checkout address input. */
  private addressSnapshotMatches(
    addresses: OrderAddressRow[],
    type: "shipping" | "billing",
    expected: CreateOrderFromCheckoutInput["shippingAddress"],
  ): boolean {
    const address = addresses.find((candidate) => candidate.type === type);
    return Boolean(
      address &&
        address.sourceAddressId === expected.sourceAddressId &&
        address.recipientName === expected.recipientName &&
        address.phone === expected.phone &&
        address.line1 === expected.line1 &&
        address.line2 === expected.line2 &&
        address.city === expected.city &&
        address.region === expected.region &&
        address.postalCode === expected.postalCode &&
        address.countryCode === expected.countryCode,
    );
  }

  /** Builds the repository address record from one final Checkout address snapshot. */
  private toAddressRecord(
    orderId: string,
    type: "shipping" | "billing",
    address: CreateOrderFromCheckoutInput["shippingAddress"],
  ) {
    return {
      orderId,
      type,
      sourceAddressId: address.sourceAddressId,
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
    };
  }

  /** Resolves the Payment boundary only for the owning customer or a trusted system caller. */
  private async findPaymentBoundaryForContext(
    context: RequestContext,
    orderId: string,
  ): Promise<OrderPaymentBoundaryRow> {
    if (context.actorType === ACTOR_TYPE.SYSTEM) {
      const row = await this.repository.findPaymentBoundaryByOrderId(orderId);
      if (!row) throw this.orderNotFound();
      return row;
    }

    if (context.actorType !== ACTOR_TYPE.CUSTOMER || !context.actorId) {
      throw ordersError(ERROR_CODE.FORBIDDEN, "You cannot access this Order Payment state.", 403);
    }

    const row = await this.repository.findPaymentBoundaryForCustomer(orderId, context.actorId);
    if (!row) throw this.orderNotFound();
    return row;
  }

  /** Converts one trusted repository boundary into the provider-neutral Module 12 Order snapshot. */
  private toPaymentSnapshot(
    boundary: OrderPaymentBoundaryRow,
    remainingItemQuantity: number,
  ): OrderPaymentSnapshot {
    return {
      orderId: boundary.order.id,
      customerUserId: boundary.order.customerUserId,
      currency: boundary.order.currency,
      grandTotal: boundary.order.grandTotal,
      paymentStatus: boundary.order.paymentStatus,
      orderStatus: boundary.order.orderStatus,
      checkoutAttemptId: boundary.order.checkoutAttemptId,
      paymentExpiresAt: boundary.paymentExpiresAt.toISOString(),
      remainingItemQuantity,
    };
  }

  /** Resolves seller/store IDs where one seller-scoped Orders permission is actually effective. */
  private resolveSellerScope(context: RequestContext, permission: PermissionCode): OrderSellerScope {
    const sellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) =>
          context.sellerIds.has(sellerId) && permissions.has(permission),
      )
      .map(([sellerId]) => sellerId);
    const storeIds = [...context.storeIds];
    if (sellerIds.length === 0 || storeIds.length === 0) throw this.sellerScopeForbidden();
    return { sellerIds, storeIds };
  }

  /** Rejects a seller-list store filter that is outside the server-derived active store scope. */
  private assertStoreInSellerScope(storeId: string | undefined, scope: OrderSellerScope): void {
    if (storeId && !scope.storeIds.includes(storeId)) throw this.sellerScopeForbidden();
  }

  /** Derives the parent lifecycle state from payment, child Seller Order state, and remaining item quantities. */
  private deriveParentOrderStatus(
    paymentStatus: string,
    sellerOrders: SellerOrderRow[],
    items: OrderItemRow[],
  ): (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS] {
    if (items.every((item) => this.remainingQuantity(item) === 0)) {
      return ORDER_STATUS.CANCELLED;
    }
    if (paymentStatus !== ORDER_PAYMENT_STATUS.CAPTURED) return ORDER_STATUS.PENDING_PAYMENT;
    if (
      sellerOrders.some(
        (sellerOrder) =>
          sellerOrder.status !== SELLER_ORDER_STATUS.CANCELLED &&
          sellerOrder.status === SELLER_ORDER_STATUS.PROCESSING,
      )
    ) {
      return ORDER_STATUS.PROCESSING;
    }
    return ORDER_STATUS.CONFIRMED;
  }

  /** Derives the Order Item cancellation status from original and accumulated cancelled quantity. */
  private deriveItemStatus(
    quantity: number,
    cancelledQuantity: number,
  ): (typeof ORDER_ITEM_STATUS)[keyof typeof ORDER_ITEM_STATUS] {
    if (cancelledQuantity === 0) return ORDER_ITEM_STATUS.ACTIVE;
    if (cancelledQuantity === quantity) return ORDER_ITEM_STATUS.CANCELLED;
    return ORDER_ITEM_STATUS.PARTIALLY_CANCELLED;
  }

  /** Returns the still-active commercial quantity for one immutable Order Item. */
  private remainingQuantity(item: OrderItemRow): number {
    return item.qty - item.cancelledQty;
  }

  /** Resolves requested incremental cancellation quantities or all remaining quantities when items are omitted. */
  private resolveCancellationQuantities(
    items: OrderItemRow[],
    input: CancelOrderInput,
  ): Map<string, number> {
    const byId = new Map(items.map((item) => [item.id, item]));
    const result = new Map<string, number>();

    if (!input.items) {
      for (const item of items) {
        const remaining = this.remainingQuantity(item);
        if (remaining > 0) result.set(item.id, remaining);
      }
    } else {
      for (const request of input.items) {
        const item = byId.get(request.orderItemId);
        if (!item || request.quantity > this.remainingQuantity(item)) {
          throw this.cancellationNotAllowed();
        }
        result.set(item.id, request.quantity);
      }
    }

    if (result.size === 0) throw this.cancellationNotAllowed();
    return result;
  }

  /** Normalizes cancellation input before hashing and locked business execution. */
  private normalizeCancellationInput(input: CancelOrderInput): CancelOrderInput {
    return {
      items: input.items
        ? [...input.items]
            .map((item) => ({
              orderItemId: item.orderItemId.toLowerCase(),
              quantity: item.quantity,
            }))
            .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId))
        : undefined,
      reason: input.reason?.trim(),
    };
  }

  /** Builds the exact fixed-order Patch 0005 request hash for cancellation idempotency. */
  private buildCancellationRequestHash(orderId: string, input: CancelOrderInput): string {
    return sha256(
      JSON.stringify({
        version: ORDER_CANCEL_REQUEST_VERSION,
        orderId: orderId.toLowerCase(),
        items: input.items ?? null,
        reason: input.reason ?? null,
      }),
    );
  }

  /** Validates and trims the required cancellation Idempotency-Key without logging the raw value. */
  private normalizeIdempotencyKey(idempotencyKey: string): string {
    const value = idempotencyKey.trim();
    if (value.length < 1 || value.length > ORDERS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw ordersError(
        ERROR_CODE.VALIDATION_FAILED,
        "A valid Idempotency-Key header is required.",
        422,
      );
    }
    return value;
  }

  /** Parses a stored Foundation replay and fails closed if the persisted cancellation response is malformed. */
  private parseCancellationReplay(responseBody: unknown): CustomerOrderDetail {
    const parsed = customerOrderDetailSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw ordersError(
        ERROR_CODE.INTERNAL_ERROR,
        "Stored Order cancellation idempotency response is invalid.",
        500,
      );
    }
    return parsed.data;
  }

  /** Marks one acquired idempotency record failed without hiding the original business error. */
  private async failIdempotencySafely(recordId: string): Promise<void> {
    try {
      await this.idempotency.fail(recordId);
    } catch {
      // The original business/database error remains the useful failure for the caller.
    }
  }

  /** Persists and records a parent status only when the derived lifecycle value actually changed. */
  private async persistDerivedParentStatusIfChanged(
    repository: OrdersRepository,
    outbox: OrdersOutboxIntegration,
    order: OrderRow,
    nextStatus: string,
    changedBy: string | null,
  ): Promise<OrderRow> {
    if (order.orderStatus === nextStatus) return order;
    const updated = await repository.updateDerivedOrderStatus(order.id, nextStatus, this.now());
    if (!updated) throw this.orderNotFound();
    await repository.createStatusHistory([
      {
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: nextStatus,
        changedBy,
        changedAt: this.now(),
      },
    ]);
    await this.enqueueOrderStatusChanged(outbox, order.id, order.orderStatus, nextStatus);
    return updated;
  }

  /** Appends the durable parent status-changed event without leaking private Order snapshot data. */
  private async enqueueOrderStatusChanged(
    outbox: OrdersOutboxIntegration,
    orderId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<void> {
    await outbox.enqueue({
      eventType: ORDERS_OUTBOX_EVENT.STATUS_CHANGED,
      aggregateType: ORDERS_RESOURCE_TYPE.ORDER,
      aggregateId: orderId,
      payload: { orderId, fromStatus, toStatus },
    });
  }

  /** Builds one complete customer-safe Order detail from immutable repository rows. */
  private async buildCustomerOrderDetail(
    repository: OrdersRepository,
    order: OrderRow,
  ): Promise<CustomerOrderDetail> {
    const [sellerOrders, items, addresses, history] = await Promise.all([
      repository.listSellerOrdersByOrderId(order.id),
      repository.listOrderItemsByOrderId(order.id),
      repository.listOrderAddressesByOrderId(order.id),
      repository.listOrderStatusHistory(order.id),
    ]);
    const shippingAddress = this.requireAddress(addresses, "shipping");
    const billingAddress = this.requireAddress(addresses, "billing");

    return {
      ...this.toCustomerOrderSummary(order),
      shippingAddress: this.toOrderAddressResponse(shippingAddress),
      billingAddress: this.toOrderAddressResponse(billingAddress),
      sellerOrders: sellerOrders.map((sellerOrder) => ({
        id: sellerOrder.id,
        sellerOrderNo: sellerOrder.sellerOrderNo,
        sellerId: sellerOrder.sellerId,
        storeId: sellerOrder.storeId,
        subtotal: sellerOrder.subtotal,
        discountTotal: sellerOrder.discountTotal,
        taxTotal: sellerOrder.taxTotal,
        shippingTotal: sellerOrder.shippingTotal,
        grandTotal: sellerOrder.grandTotal,
        status: sellerOrder.status as CustomerOrderDetail["sellerOrders"][number]["status"],
        shippingMethod: this.toShippingMethodResponse(sellerOrder, order.currency),
        items: items
          .filter((item) => item.sellerOrderId === sellerOrder.id)
          .map((item) => this.toOrderItemResponse(item)),
      })),
      statusHistory: history.map((row) => this.toStatusHistoryResponse(row)),
    };
  }

  /** Builds one seller-safe detail containing only that Seller Order, its items, and the shipping address. */
  private async buildSellerOrderDetail(
    repository: OrdersRepository,
    row: SellerOrderWithParentRow,
    scope: OrderSellerScope,
  ): Promise<SellerOrderDetail> {
    const [items, addresses, history] = await Promise.all([
      repository.listOrderItemsBySellerOrderInScope(row.sellerOrder.id, scope),
      repository.listOrderAddressesByOrderId(row.order.id),
      repository.listSellerOrderStatusHistoryInScope(row.sellerOrder.id, scope),
    ]);
    const shippingAddress = this.requireAddress(addresses, "shipping");
    return {
      ...this.toSellerOrderListItem(row),
      shippingMethod: this.toShippingMethodResponse(row.sellerOrder, row.order.currency),
      items: items.map((item) => this.toOrderItemResponse(item)),
      shippingAddress: this.toOrderAddressResponse(shippingAddress),
      statusHistory: history.map((item) => this.toStatusHistoryResponse(item)),
    };
  }

  /** Converts one parent Order row into the safe customer/admin list response. */
  private toCustomerOrderSummary(order: OrderRow): CustomerOrderSummary {
    return {
      id: order.id,
      orderNo: order.orderNo,
      currency: order.currency,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      shippingTotal: order.shippingTotal,
      grandTotal: order.grandTotal,
      paymentStatus: order.paymentStatus as CustomerOrderSummary["paymentStatus"],
      fulfillmentStatus: order.fulfillmentStatus as CustomerOrderSummary["fulfillmentStatus"],
      orderStatus: order.orderStatus as CustomerOrderSummary["orderStatus"],
      placedAt: order.placedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  /** Converts one scoped Seller Order + parent row into the seller queue response. */
  private toSellerOrderListItem(row: SellerOrderWithParentRow): SellerOrderListItem {
    return {
      id: row.sellerOrder.id,
      sellerOrderNo: row.sellerOrder.sellerOrderNo,
      sellerId: row.sellerOrder.sellerId,
      storeId: row.sellerOrder.storeId,
      orderId: row.order.id,
      orderNo: row.order.orderNo,
      currency: row.order.currency,
      subtotal: row.sellerOrder.subtotal,
      discountTotal: row.sellerOrder.discountTotal,
      taxTotal: row.sellerOrder.taxTotal,
      shippingTotal: row.sellerOrder.shippingTotal,
      grandTotal: row.sellerOrder.grandTotal,
      status: row.sellerOrder.status as SellerOrderListItem["status"],
      paymentStatus: row.order.paymentStatus as SellerOrderListItem["paymentStatus"],
      fulfillmentStatus: row.order.fulfillmentStatus as SellerOrderListItem["fulfillmentStatus"],
      createdAt: row.sellerOrder.createdAt.toISOString(),
    };
  }


  /** Maps one repository purchase row to the narrow Review service boundary. */
  private toReviewEligibilitySnapshot(
    row: OrderReviewEligibilityRow,
  ): OrderReviewEligibilitySnapshot {
    return {
      orderId: row.orderId,
      customerUserId: row.customerUserId,
      orderItemId: row.orderItemId,
      productId: row.productId,
      sellerId: row.sellerId,
      storeId: row.storeId,
      quantity: row.quantity,
      cancelledQuantity: row.cancelledQuantity,
    };
  }

  /** Converts one immutable Order Item row into the customer/seller-safe response. */
  private toOrderItemResponse(item: OrderItemRow): OrderItemResponse {
    return {
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.skuSnapshot,
      name: item.nameSnapshot,
      variantTitle: item.variantTitleSnapshot,
      quantity: item.qty,
      cancelledQuantity: item.cancelledQty,
      remainingQuantity: this.remainingQuantity(item),
      unitPrice: item.unitPrice,
      discountAllocated: item.discountAllocated,
      taxAllocated: item.taxAllocated,
      lineTotal: item.lineTotal,
      status: item.status as OrderItemResponse["status"],
    };
  }

  /** Converts one immutable address row into the safe Order response shape. */
  private toOrderAddressResponse(address: OrderAddressRow) {
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
    };
  }

  /** Converts one Seller Order's immutable Shipping selection into the safe response shape. */
  private toShippingMethodResponse(sellerOrder: SellerOrderRow, currency: string) {
    return {
      id: sellerOrder.shippingMethodId,
      code: sellerOrder.shippingMethodCodeSnapshot,
      name: sellerOrder.shippingMethodNameSnapshot,
      amount: sellerOrder.shippingTotal,
      currency,
    };
  }

  /** Converts one append-only status history row while excluding source keys and internal metadata. */
  private toStatusHistoryResponse(row: OrderStatusHistoryRow) {
    return {
      id: row.id,
      orderId: row.orderId,
      sellerOrderId: row.sellerOrderId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      changedAt: row.changedAt.toISOString(),
    };
  }

  /** Finds one required immutable address type and fails closed if persistence is inconsistent. */
  private requireAddress(
    addresses: OrderAddressRow[],
    type: "shipping" | "billing",
  ): OrderAddressRow {
    const address = addresses.find((candidate) => candidate.type === type);
    if (!address) {
      throw ordersError(
        ERROR_CODE.INTERNAL_ERROR,
        "Order address snapshot is incomplete.",
        500,
      );
    }
    return address;
  }

  /** Records one source-identity conflict without storing the raw external source value. */
  private async recordSourceConflict(
    context: RequestContext,
    orderId: string,
    sourceType: string,
    sourceKey: string,
  ): Promise<void> {
    await this.securityAudit.record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: ORDERS_AUDIT_ACTION.SOURCE_CONFLICT,
      entityType: ORDERS_RESOURCE_TYPE.ORDER,
      entityId: orderId,
      requestId: context.requestId,
      metadata: { sourceType, sourceKeyHash: sha256(sourceKey) },
    });
  }

  /** Returns true when an Inventory reservation error must fail the Order lifecycle transition safely. */
  private isInventoryReservationFailure(error: unknown): boolean {
    if (!isAppError(error)) return false;
    const failureCodes = new Set<string>([
      INVENTORY_ERROR_CODE.INVENTORY_NOT_FOUND,
      INVENTORY_ERROR_CODE.STOCK_ADJUSTMENT_INVALID,
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_NOT_FOUND,
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_STATUS_INVALID,
      INVENTORY_ERROR_CODE.STOCK_RESERVATION_EXPIRED,
    ]);
    return failureCodes.has(error.code);
  }

  /** Returns one stable seller/store grouping key without exposing it outside service internals. */
  private sellerGroupKey(sellerId: string, storeId: string): string {
    return `${sellerId}:${storeId}`;
  }

  /** Requires an authenticated actor identifier for every private Orders operation. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId) {
      throw ordersError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
    return context.actorId;
  }

  /** Creates the non-enumerating Customer Order not-found error. */
  private orderNotFound(): AppError {
    return ordersError(ORDERS_ERROR_CODE.NOT_FOUND, "Order not found.", 404);
  }

  /** Creates the seller-scope error used when a Seller Order is outside the actor's effective scope. */
  private sellerScopeForbidden(): AppError {
    return ordersError(
      ORDERS_ERROR_CODE.SELLER_SCOPE_FORBIDDEN,
      "You cannot access this Seller Order.",
      403,
    );
  }

  /** Creates the stable lifecycle-state error for commands that cannot run from current authoritative state. */
  private statusInvalid(message = "The requested Order transition is not allowed."): AppError {
    return ordersError(ORDERS_ERROR_CODE.STATUS_INVALID, message, 409);
  }

  /** Creates the stable cancellation error for payment/fulfillment/item states outside Module 11 policy. */
  private cancellationNotAllowed(): AppError {
    return ordersError(
      ORDERS_ERROR_CODE.CANCELLATION_NOT_ALLOWED,
      "This Order can no longer be cancelled in the current state.",
      409,
    );
  }

  /** Creates the stable source-identity conflict error without exposing another resource. */
  private sourceDuplicate(message = "The Order source has already been applied."): AppError {
    return ordersError(ORDERS_ERROR_CODE.SOURCE_DUPLICATE, message, 409);
  }
}

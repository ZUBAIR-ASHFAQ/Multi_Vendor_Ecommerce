import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { checkoutAttempts, checkoutQuotes } from "../../database/schema/checkout.js";
import { db } from "../../database/db.js";
import {
  orderAddresses,
  orderItems,
  orders,
  orderStatusHistory,
  sellerOrders,
  type NewOrderAddressRow,
  type NewOrderItemRow,
  type NewOrderRow,
  type NewOrderStatusHistoryRow,
  type NewSellerOrderRow,
  type OrderAddressRow,
  type OrderItemRow,
  type OrderRow,
  type OrderStatusHistoryRow,
  type SellerOrderRow,
} from "../../database/schema/orders.js";
import { stores } from "../../database/schema/sellers.js";
import { shipments } from "../../database/schema/shipping.js";
import type { DatabaseExecutor } from "../../database/types.js";
import type {
  AdminOrderListQuery,
  CustomerOrderListQuery,
  SellerOrderListQuery,
} from "./orders.schema.js";

/** Server-derived seller/store IDs that must constrain every private Seller Order query. */
export interface OrderSellerScope {
  sellerIds: string[];
  storeIds: string[];
}


/** Immutable Order Item ownership facts required by the Reviews service boundary. */
export interface OrderReviewEligibilityRow {
  orderId: string;
  customerUserId: string;
  orderItemId: string;
  productId: string;
  sellerId: string;
  storeId: string;
  quantity: number;
  cancelledQuantity: number;
}

/** Parent Customer Order fields already reconciled and approved by the Orders service. */
export interface CreateOrderRecordInput {
  id: string;
  orderNo: string;
  checkoutAttemptId: string;
  customerUserId: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  orderStatus: string;
  placedAt?: Date | null;
}

/** One deterministic seller/store fulfillment unit already calculated by the Orders service. */
export interface CreateSellerOrderRecordInput {
  id: string;
  orderId: string;
  sellerId: string;
  storeId: string;
  sellerOrderNo: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  status: string;
  shippingMethodId: string;
  shippingMethodCodeSnapshot: string;
  shippingMethodNameSnapshot: string;
}

/** One immutable Product/price snapshot line already assigned to a Seller Order. */
export interface CreateOrderItemRecordInput {
  id: string;
  orderId: string;
  sellerOrderId: string;
  productId: string;
  variantId: string;
  inventoryReservationId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  variantTitleSnapshot: string | null;
  qty: number;
  unitPrice: string;
  discountAllocated: string;
  taxAllocated: string;
  lineTotal: string;
  commissionRuleSnapshotJson?: unknown | null;
  status: string;
  cancelledQty?: number;
}

/** One immutable shipping or billing address snapshot copied from final Checkout state. */
export interface CreateOrderAddressRecordInput {
  orderId: string;
  type: "shipping" | "billing";
  sourceAddressId: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  countryCode: string;
}

/** One append-only parent-Order or Seller-Order lifecycle history row. */
export interface CreateOrderStatusHistoryRecordInput {
  orderId?: string | null;
  sellerOrderId?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  changedBy?: string | null;
  changedAt?: Date;
  sourceType?: string | null;
  sourceKey?: string | null;
  metadataJson?: unknown | null;
}

/** One Seller Order row paired with the safe parent lifecycle fields needed by seller services. */
export interface SellerOrderWithParentRow {
  sellerOrder: SellerOrderRow;
  order: OrderRow;
}

/** Paginated parent Customer Order rows returned by customer/admin list reads. */
export interface PaginatedOrderRows {
  items: OrderRow[];
  totalItems: number;
}

/** Customer-list Seller Order identity plus the current public store name used only for display. */
export interface CustomerOrderListSellerOrderRow {
  orderId: string;
  sellerOrderId: string;
  storeId: string;
  storeName: string;
  status: string;
}

/** Immutable Order Item fields required by the bounded customer Order-history preview. */
export interface CustomerOrderListItemPreviewRow {
  orderId: string;
  sellerOrderId: string;
  orderItemId: string;
  name: string;
  variantTitle: string | null;
  quantity: number;
}

/** Customer-visible latest Shipment state used only to decide whether tracking is available. */
export interface CustomerOrderListShipmentRow {
  sellerOrderId: string;
  status: "shipped" | "delivered";
}

/** Paginated Seller Order rows returned only inside one server-derived seller/store scope. */
export interface PaginatedSellerOrderRows {
  items: SellerOrderWithParentRow[];
  totalItems: number;
}

/** Trusted Order + Checkout-attempt deadline row used only by the Module 12 Payment service boundary. */
export interface OrderPaymentBoundaryRow {
  order: OrderRow;
  paymentExpiresAt: Date;
}

/** Persistence filters supplied by the Payments service for one bounded overdue Order scan. */
export interface OverduePaymentOrderCandidatesQuery {
  expiredBefore: Date;
  paymentStatuses: string[];
  orderStatuses: string[];
  limit: number;
}

/** Returns a SQL false predicate when a required seller/store scope is empty. */
function sellerOrderScopeCondition(scope: OrderSellerScope): SQL {
  if (scope.sellerIds.length === 0 || scope.storeIds.length === 0) {
    return sql`false`;
  }

  return and(
    inArray(sellerOrders.sellerId, scope.sellerIds),
    inArray(sellerOrders.storeId, scope.storeIds),
  ) as SQL;
}

/** Combines only SQL predicates that are actually present. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Maps Customer/Admin Order sorting to deterministic SQL ordering. */
function customerOrderSort(query: Pick<CustomerOrderListQuery, "sort" | "order">): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "orderNo":
      return [direction(orders.orderNo), asc(orders.id)];
    case "createdAt":
    default:
      return [direction(orders.createdAt), asc(orders.id)];
  }
}

/** Maps Seller Order sorting to deterministic SQL ordering. */
function sellerOrderSort(query: SellerOrderListQuery): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "sellerOrderNo":
      return [direction(sellerOrders.sellerOrderNo), asc(sellerOrders.id)];
    case "createdAt":
    default:
      return [direction(sellerOrders.createdAt), asc(sellerOrders.id)];
  }
}

/** Builds the optional admin seller/store filter without duplicating parent Order rows. */
function adminSellerScopeFilter(query: AdminOrderListQuery): SQL | undefined {
  if (!query.sellerId && !query.storeId) return undefined;

  const childConditions = [
    sql`${sellerOrders.orderId} = ${orders.id}`,
    query.sellerId ? eq(sellerOrders.sellerId, query.sellerId) : undefined,
    query.storeId ? eq(sellerOrders.storeId, query.storeId) : undefined,
  ].filter((condition): condition is SQL => Boolean(condition));

  const childWhere = and(...childConditions) as SQL;
  return sql`exists (select 1 from ${sellerOrders} where ${childWhere})`;
}

/**
 * Persistence-only Module 11 repository.
 * State machines, money reconciliation, ownership decisions, Inventory calls, idempotency, audit, and outbox stay in services.
 */
export class OrdersRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Inserts one immutable parent Customer Order after the service has reconciled the Checkout snapshot. */
  async createOrder(input: CreateOrderRecordInput): Promise<OrderRow> {
    const values: NewOrderRow = {
      ...input,
      placedAt: input.placedAt ?? null,
    };
    const [row] = await this.executor.insert(orders).values(values).returning();

    if (!row) {
      throw new Error("Order insert completed without returning a row.");
    }

    return row;
  }

  /** Inserts deterministic Seller Orders already grouped and reconciled by the service. */
  async createSellerOrders(inputs: CreateSellerOrderRecordInput[]): Promise<SellerOrderRow[]> {
    if (inputs.length === 0) return [];

    const values: NewSellerOrderRow[] = inputs;
    return this.executor.insert(sellerOrders).values(values).returning();
  }

  /** Inserts immutable Order Item snapshots already assigned to their deterministic Seller Orders. */
  async createOrderItems(inputs: CreateOrderItemRecordInput[]): Promise<OrderItemRow[]> {
    if (inputs.length === 0) return [];

    const values: NewOrderItemRow[] = inputs.map((input) => ({
      ...input,
      commissionRuleSnapshotJson: input.commissionRuleSnapshotJson ?? null,
      cancelledQty: input.cancelledQty ?? 0,
    }));
    return this.executor.insert(orderItems).values(values).returning();
  }

  /** Inserts immutable shipping and billing address snapshots for one Customer Order. */
  async createOrderAddresses(inputs: CreateOrderAddressRecordInput[]): Promise<OrderAddressRow[]> {
    if (inputs.length === 0) return [];

    const values: NewOrderAddressRow[] = inputs;
    return this.executor.insert(orderAddresses).values(values).returning();
  }

  /** Appends lifecycle history rows after the service has approved each state transition. */
  async createStatusHistory(
    inputs: CreateOrderStatusHistoryRecordInput[],
  ): Promise<OrderStatusHistoryRow[]> {
    if (inputs.length === 0) return [];

    const values: NewOrderStatusHistoryRow[] = inputs.map((input) => ({
      orderId: input.orderId ?? null,
      sellerOrderId: input.sellerOrderId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
      changedBy: input.changedBy ?? null,
      changedAt: input.changedAt ?? new Date(),
      sourceType: input.sourceType ?? null,
      sourceKey: input.sourceKey ?? null,
      metadataJson: input.metadataJson ?? null,
    }));

    return this.executor.insert(orderStatusHistory).values(values).returning();
  }

  /** Finds the Customer Order already materialized from one Checkout attempt for exact replay handling. */
  async findOrderByCheckoutAttemptId(checkoutAttemptId: string): Promise<OrderRow | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(eq(orders.checkoutAttemptId, checkoutAttemptId))
      .limit(1);

    return row ?? null;
  }

  /** Reads the immutable Checkout coupon code that produced one Order attempt. */
  async findCheckoutCouponCodeByAttemptId(checkoutAttemptId: string): Promise<string | null> {
    const [row] = await this.executor
      .select({ couponCode: checkoutQuotes.couponCode })
      .from(checkoutAttempts)
      .innerJoin(checkoutQuotes, eq(checkoutQuotes.id, checkoutAttempts.quoteId))
      .where(eq(checkoutAttempts.id, checkoutAttemptId))
      .limit(1);

    return row?.couponCode ?? null;
  }

  /** Reads one parent Order by identifier for trusted internal service composition. */
  async findOrderById(orderId: string): Promise<OrderRow | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one parent Order only when it belongs to the supplied authenticated customer. */
  async findOrderForCustomer(orderId: string, customerUserId: string): Promise<OrderRow | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.customerUserId, customerUserId)))
      .limit(1);

    return row ?? null;
  }

  /** Reads one customer-owned Order with the original Checkout-attempt deadline used as its Payment deadline. */
  async findPaymentBoundaryForCustomer(
    orderId: string,
    customerUserId: string,
  ): Promise<OrderPaymentBoundaryRow | null> {
    const [row] = await this.executor
      .select({ order: orders, paymentExpiresAt: checkoutAttempts.expiresAt })
      .from(orders)
      .innerJoin(
        checkoutAttempts,
        and(
          eq(checkoutAttempts.id, orders.checkoutAttemptId),
          eq(checkoutAttempts.orderId, orders.id),
        ),
      )
      .where(and(eq(orders.id, orderId), eq(orders.customerUserId, customerUserId)))
      .limit(1);

    return row ?? null;
  }

  /** Reads one Order and its Checkout-attempt Payment deadline for trusted system Payment work. */
  async findPaymentBoundaryByOrderId(orderId: string): Promise<OrderPaymentBoundaryRow | null> {
    const [row] = await this.executor
      .select({ order: orders, paymentExpiresAt: checkoutAttempts.expiresAt })
      .from(orders)
      .innerJoin(
        checkoutAttempts,
        and(
          eq(checkoutAttempts.id, orders.checkoutAttemptId),
          eq(checkoutAttempts.orderId, orders.id),
        ),
      )
      .where(eq(orders.id, orderId))
      .limit(1);

    return row ?? null;
  }

  /** Lists a deterministic bounded batch of expired Order-linked Checkout attempts for Payment maintenance. */
  async listOverduePaymentOrderCandidates(
    query: OverduePaymentOrderCandidatesQuery,
  ): Promise<OrderPaymentBoundaryRow[]> {
    if (query.paymentStatuses.length === 0 || query.orderStatuses.length === 0) return [];

    const limit = Math.min(Math.max(Math.trunc(query.limit), 1), 100);

    return this.executor
      .select({ order: orders, paymentExpiresAt: checkoutAttempts.expiresAt })
      .from(checkoutAttempts)
      .innerJoin(
        orders,
        and(
          eq(orders.checkoutAttemptId, checkoutAttempts.id),
          eq(orders.id, checkoutAttempts.orderId),
        ),
      )
      .where(
        and(
          lte(checkoutAttempts.expiresAt, query.expiredBefore),
          inArray(orders.paymentStatus, query.paymentStatuses),
          inArray(orders.orderStatus, query.orderStatuses),
        ),
      )
      .orderBy(
        asc(checkoutAttempts.expiresAt),
        asc(checkoutAttempts.id),
        asc(orders.id),
      )
      .limit(limit);
  }

  /** Lists the authenticated customer's own parent Orders with bounded filters and deterministic sorting. */
  async listOrdersForCustomer(
    customerUserId: string,
    query: CustomerOrderListQuery,
  ): Promise<PaginatedOrderRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(orders.customerUserId, customerUserId),
      query.orderStatus ? eq(orders.orderStatus, query.orderStatus) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(orders)
      .where(where)
      .orderBy(...customerOrderSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(orders)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Loads Seller Order/store display rows for one already customer-scoped page of parent Orders. */
  async listCustomerOrderSellerOrders(
    orderIds: string[],
  ): Promise<CustomerOrderListSellerOrderRow[]> {
    if (orderIds.length === 0) return [];

    return this.executor
      .select({
        orderId: sellerOrders.orderId,
        sellerOrderId: sellerOrders.id,
        storeId: sellerOrders.storeId,
        storeName: stores.name,
        status: sellerOrders.status,
      })
      .from(sellerOrders)
      .innerJoin(stores, eq(stores.id, sellerOrders.storeId))
      .where(inArray(sellerOrders.orderId, orderIds))
      .orderBy(asc(sellerOrders.orderId), asc(stores.name), asc(sellerOrders.id));
  }

  /** Loads immutable item snapshots for one customer-scoped Order page without issuing per-Order queries. */
  async listCustomerOrderItemPreviews(
    orderIds: string[],
  ): Promise<CustomerOrderListItemPreviewRow[]> {
    if (orderIds.length === 0) return [];

    return this.executor
      .select({
        orderId: orderItems.orderId,
        sellerOrderId: orderItems.sellerOrderId,
        orderItemId: orderItems.id,
        name: orderItems.nameSnapshot,
        variantTitle: orderItems.variantTitleSnapshot,
        quantity: orderItems.qty,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.orderId), asc(orderItems.sellerOrderId), asc(orderItems.id));
  }

  /** Loads only customer-visible Shipment states for one customer-scoped Order page. */
  async listCustomerOrderVisibleShipments(
    orderIds: string[],
  ): Promise<CustomerOrderListShipmentRow[]> {
    if (orderIds.length === 0) return [];

    const rows = await this.executor
      .select({
        sellerOrderId: shipments.sellerOrderId,
        status: shipments.status,
      })
      .from(shipments)
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          inArray(sellerOrders.orderId, orderIds),
          inArray(shipments.status, ["shipped", "delivered"]),
        ),
      )
      .orderBy(asc(shipments.createdAt), asc(shipments.id));

    return rows.map((row) => ({
      sellerOrderId: row.sellerOrderId,
      status: row.status as CustomerOrderListShipmentRow["status"],
    }));
  }

  /** Locks one Customer-owned parent Order before cancellation revalidation and mutation. */
  async lockOrderForCustomer(
    orderId: string,
    customerUserId: string,
  ): Promise<OrderRow | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.customerUserId, customerUserId)))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one parent Order by identifier for admin/internal state transitions. */
  async lockOrderById(orderId: string): Promise<OrderRow | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Lists Seller Orders belonging to one parent Order in deterministic seller/store order. */
  async listSellerOrdersByOrderId(orderId: string): Promise<SellerOrderRow[]> {
    return this.executor
      .select()
      .from(sellerOrders)
      .where(eq(sellerOrders.orderId, orderId))
      .orderBy(asc(sellerOrders.storeId), asc(sellerOrders.sellerId), asc(sellerOrders.id));
  }

  /** Lists only Seller Orders inside the actor's server-derived seller/store scope. */
  async listSellerOrdersInScope(
    scope: OrderSellerScope,
    query: SellerOrderListQuery,
  ): Promise<PaginatedSellerOrderRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerOrderScopeCondition(scope),
      query.storeId ? eq(sellerOrders.storeId, query.storeId) : undefined,
      query.status ? eq(sellerOrders.status, query.status) : undefined,
    ]);

    const rows = await this.executor
      .select({ sellerOrder: sellerOrders, order: orders })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(where)
      .orderBy(...sellerOrderSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(sellerOrders)
      .where(where);

    return {
      items: rows,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads one Seller Order and parent only inside the actor's server-derived seller/store scope. */
  async findSellerOrderInScope(
    sellerOrderId: string,
    scope: OrderSellerScope,
  ): Promise<SellerOrderWithParentRow | null> {
    const [row] = await this.executor
      .select({ sellerOrder: sellerOrders, order: orders })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(and(eq(sellerOrders.id, sellerOrderId), sellerOrderScopeCondition(scope)))
      .limit(1);

    return row ?? null;
  }

  /** Locks one Seller Order and parent only inside the actor's seller/store scope before acceptance. */
  async lockSellerOrderInScope(
    sellerOrderId: string,
    scope: OrderSellerScope,
  ): Promise<SellerOrderWithParentRow | null> {
    const [row] = await this.executor
      .select({ sellerOrder: sellerOrders, order: orders })
      .from(sellerOrders)
      .innerJoin(orders, eq(orders.id, sellerOrders.orderId))
      .where(and(eq(sellerOrders.id, sellerOrderId), sellerOrderScopeCondition(scope)))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Searches parent Orders for privileged admins without changing Order ownership or lifecycle state. */
  async listAdminOrders(query: AdminOrderListQuery): Promise<PaginatedOrderRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.orderNo ? eq(orders.orderNo, query.orderNo) : undefined,
      query.customerUserId ? eq(orders.customerUserId, query.customerUserId) : undefined,
      query.orderStatus ? eq(orders.orderStatus, query.orderStatus) : undefined,
      query.paymentStatus ? eq(orders.paymentStatus, query.paymentStatus) : undefined,
      query.createdFrom ? gte(orders.createdAt, new Date(query.createdFrom)) : undefined,
      query.createdTo ? lte(orders.createdAt, new Date(query.createdTo)) : undefined,
      adminSellerScopeFilter(query),
    ]);

    const items = await this.executor
      .select()
      .from(orders)
      .where(where)
      .orderBy(...customerOrderSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(orders)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }


  /** Reads immutable purchase ownership for one Order Item without exposing Orders tables to downstream modules. */
  async findReviewEligibilityByOrderItemId(
    orderItemId: string,
  ): Promise<OrderReviewEligibilityRow | null> {
    const [row] = await this.executor
      .select({
        orderId: orders.id,
        customerUserId: orders.customerUserId,
        orderItemId: orderItems.id,
        productId: orderItems.productId,
        sellerId: sellerOrders.sellerId,
        storeId: sellerOrders.storeId,
        quantity: orderItems.qty,
        cancelledQuantity: orderItems.cancelledQty,
      })
      .from(orderItems)
      .innerJoin(
        sellerOrders,
        and(
          eq(sellerOrders.id, orderItems.sellerOrderId),
          eq(sellerOrders.orderId, orderItems.orderId),
        ),
      )
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orderItems.id, orderItemId))
      .limit(1);

    return row ?? null;
  }

  /** Lists every immutable Order Item for one parent Order in deterministic ID order. */
  async listOrderItemsByOrderId(orderId: string): Promise<OrderItemRow[]> {
    return this.executor
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id));
  }

  /** Locks every Order Item in one parent Order before quantity cancellation revalidation. */
  async lockOrderItemsByOrderId(orderId: string): Promise<OrderItemRow[]> {
    return this.executor
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id))
      .for("update");
  }

  /** Lists immutable items for one Seller Order only inside the actor's seller/store scope. */
  async listOrderItemsBySellerOrderInScope(
    sellerOrderId: string,
    scope: OrderSellerScope,
  ): Promise<OrderItemRow[]> {
    const rows = await this.executor
      .select({ item: orderItems })
      .from(orderItems)
      .innerJoin(sellerOrders, eq(sellerOrders.id, orderItems.sellerOrderId))
      .where(
        and(
          eq(orderItems.sellerOrderId, sellerOrderId),
          sellerOrderScopeCondition(scope),
        ),
      )
      .orderBy(asc(orderItems.id));

    return rows.map((row) => row.item);
  }

  /** Lists the immutable shipping/billing snapshots for one parent Order. */
  async listOrderAddressesByOrderId(orderId: string): Promise<OrderAddressRow[]> {
    return this.executor
      .select()
      .from(orderAddresses)
      .where(eq(orderAddresses.orderId, orderId))
      .orderBy(asc(orderAddresses.type));
  }

  /** Lists parent Order status history without interpreting lifecycle meaning in the repository. */
  async listOrderStatusHistory(orderId: string): Promise<OrderStatusHistoryRow[]> {
    return this.executor
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id));
  }

  /** Lists one Seller Order's status history only inside the actor's seller/store scope. */
  async listSellerOrderStatusHistoryInScope(
    sellerOrderId: string,
    scope: OrderSellerScope,
  ): Promise<OrderStatusHistoryRow[]> {
    const rows = await this.executor
      .select({ history: orderStatusHistory })
      .from(orderStatusHistory)
      .innerJoin(sellerOrders, eq(sellerOrders.id, orderStatusHistory.sellerOrderId))
      .where(
        and(
          eq(orderStatusHistory.sellerOrderId, sellerOrderId),
          sellerOrderScopeCondition(scope),
        ),
      )
      .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id));

    return rows.map((row) => row.history);
  }

  /** Finds one replay-safe lifecycle source row for Checkout/Payment source-conflict handling. */
  async findStatusHistoryBySource(
    sourceType: string,
    sourceKey: string,
  ): Promise<OrderStatusHistoryRow | null> {
    const [row] = await this.executor
      .select()
      .from(orderStatusHistory)
      .where(
        and(
          eq(orderStatusHistory.sourceType, sourceType),
          eq(orderStatusHistory.sourceKey, sourceKey),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Persists the trusted Payment-confirmed parent fields after service-level amount/source validation. */
  async markOrderPaymentCaptured(
    orderId: string,
    capturedAt: Date,
    updatedAt: Date = new Date(),
  ): Promise<OrderRow | null> {
    const [row] = await this.executor
      .update(orders)
      .set({
        paymentStatus: "captured",
        placedAt: capturedAt,
        updatedAt,
      })
      .where(eq(orders.id, orderId))
      .returning();

    return row ?? null;
  }

  /** Persists the Shipping-derived fulfillment status for one parent Order. */
  async updateOrderFulfillmentStatus(
    orderId: string,
    fulfillmentStatus: string,
    updatedAt: Date = new Date(),
  ): Promise<OrderRow | null> {
    const [row] = await this.executor
      .update(orders)
      .set({ fulfillmentStatus, updatedAt })
      .where(eq(orders.id, orderId))
      .returning();

    return row ?? null;
  }

  /** Persists a service-derived parent Order status without accepting status from an HTTP repository boundary. */
  async updateDerivedOrderStatus(
    orderId: string,
    orderStatus: string,
    updatedAt: Date = new Date(),
  ): Promise<OrderRow | null> {
    const [row] = await this.executor
      .update(orders)
      .set({ orderStatus, updatedAt })
      .where(eq(orders.id, orderId))
      .returning();

    return row ?? null;
  }

  /** Persists one service-approved Seller Order lifecycle state. */
  async updateSellerOrderStatus(
    sellerOrderId: string,
    status: string,
    updatedAt: Date = new Date(),
  ): Promise<SellerOrderRow | null> {
    const [row] = await this.executor
      .update(sellerOrders)
      .set({ status, updatedAt })
      .where(eq(sellerOrders.id, sellerOrderId))
      .returning();

    return row ?? null;
  }

  /** Persists service-approved cancellation accounting after the item row was locked and validated. */
  async updateOrderItemCancellation(
    orderItemId: string,
    cancelledQty: number,
    status: string,
    updatedAt: Date = new Date(),
  ): Promise<OrderItemRow | null> {
    const [row] = await this.executor
      .update(orderItems)
      .set({ cancelledQty, status, updatedAt })
      .where(eq(orderItems.id, orderItemId))
      .returning();

    return row ?? null;
  }
}

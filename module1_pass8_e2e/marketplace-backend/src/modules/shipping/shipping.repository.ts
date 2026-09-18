import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import { orderItems, sellerOrders } from "../../database/schema/orders.js";
import {
  shipmentItems,
  shipments,
  shipmentStatusHistory,
  shippingMethods,
  type NewShipmentItemRow,
  type NewShipmentRow,
  type NewShipmentStatusHistoryRow,
  type ShipmentItemRow,
  type ShipmentRow,
  type ShipmentStatusHistoryRow,
  type ShippingMethodRow,
} from "../../database/schema/shipping.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_STATUS,
  SHIPPING_OWNER_TYPE,
  SHIPPING_PRICING_TYPE,
} from "./shipping.constants.js";
import type {
  SellerShipmentListQuery,
  ShipmentStatus,
} from "./shipping.schema.js";

/** Server-derived seller/store identities that constrain every private Shipment repository operation. */
export interface ShippingSellerScope {
  sellerIds: string[];
  storeIds: string[];
}

/** One bounded seller Shipment page before the service attaches item/history projections. */
export interface PaginatedShipmentRows {
  items: ShipmentRow[];
  totalItems: number;
}

/** Delivered quantity and latest delivery timestamp for one Order Item. */
export interface ReturnDeliveryItemRow {
  orderItemId: string;
  deliveredQuantity: number;
  latestDeliveredAt: Date;
}


/** Trusted commercial quantity plus delivered evidence for one Wallet settlement source Order Item. */
export interface WalletDeliveryItemRow {
  orderId: string;
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  commercialQuantity: number;
  deliveredQuantity: number;
  latestDeliveredAt: Date | null;
}

/** Shipment header fields already authorized and decided by the Shipping service. */
export interface CreateShipmentRecordInput {
  id: string;
  sellerOrderId: string;
  shipmentNo: string;
  status: ShipmentStatus;
}

/** Immutable Shipment Item allocation already validated by the Shipping service. */
export interface CreateShipmentItemRecordInput {
  orderItemId: string;
  quantity: number;
}

/** One append-only Shipment lifecycle row already approved by the Shipping service. */
export interface CreateShipmentStatusHistoryRecordInput {
  status: ShipmentStatus;
  source: string;
  occurredAt: Date;
  payloadRef?: string | null;
}

/** Tracking fields already normalized and authorized by the Shipping service. */
export interface UpdateShipmentTrackingRecordInput {
  carrier: string;
  trackingNo: string;
  serviceLevel: string | null;
  updatedAt?: Date;
}

/** Lifecycle fields already validated by the Shipping service before persistence. */
export interface UpdateShipmentLifecycleRecordInput {
  status: ShipmentStatus;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  updatedAt?: Date;
}

/** Persisted allocated quantity for one Order Item across immutable Shipment allocations. */
export interface ShipmentAllocationTotalRow {
  orderItemId: string;
  allocatedQuantity: number;
}

/** Returns a SQL false predicate when a required seller/store scope is empty. */
function sellerScopeCondition(scope: ShippingSellerScope): SQL {
  if (scope.sellerIds.length === 0 || scope.storeIds.length === 0) {
    return sql`false`;
  }

  return and(
    inArray(sellerOrders.sellerId, scope.sellerIds),
    inArray(sellerOrders.storeId, scope.storeIds),
  ) as SQL;
}

/** Combines only SQL predicates that are present so optional list filters remain readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length === 0 ? undefined : and(...active);
}

/** Builds deterministic seller Shipment ordering from the validated allow-listed sort contract. */
function sellerShipmentSort(query: SellerShipmentListQuery): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "shipmentNo":
      return [direction(shipments.shipmentNo), asc(shipments.id)];
    case "createdAt":
    default:
      return [direction(shipments.createdAt), asc(shipments.id)];
  }
}

/** Returns unique sorted IDs so transaction locks are always acquired in deterministic order. */
function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/**
 * Persistence-only Module 13 repository.
 * Shipment eligibility, quantity decisions, lifecycle policy, RBAC, idempotency, audit, outbox, and Inventory calls stay in services.
 */
export class ShippingRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): ShippingRepository {
    return new ShippingRepository(executor);
  }

  /** Builds a correlated SQL ownership guard for one Shipment row without loading private Order facts. */
  private shipmentScopeExists(scope: ShippingSellerScope): SQL {
    return exists(
      this.executor
        .select({ id: sellerOrders.id })
        .from(sellerOrders)
        .where(
          and(
            eq(sellerOrders.id, shipments.sellerOrderId),
            sellerScopeCondition(scope),
          ),
        ),
    );
  }

  /**
   * Reads active flat-rate methods for one Checkout currency and the supplied seller set.
   * Platform methods are included once; seller methods are limited to the server-derived sellers.
   */
  async listCheckoutEligibleMethods(
    currency: string,
    sellerIds: string[],
  ): Promise<ShippingMethodRow[]> {
    const ownerCondition =
      sellerIds.length === 0
        ? eq(shippingMethods.ownerType, SHIPPING_OWNER_TYPE.PLATFORM)
        : or(
            eq(shippingMethods.ownerType, SHIPPING_OWNER_TYPE.PLATFORM),
            and(
              eq(shippingMethods.ownerType, SHIPPING_OWNER_TYPE.SELLER),
              inArray(shippingMethods.sellerId, sellerIds),
            ),
          );

    return this.executor
      .select()
      .from(shippingMethods)
      .where(
        and(
          eq(shippingMethods.currency, currency),
          eq(shippingMethods.pricingType, SHIPPING_PRICING_TYPE.FLAT),
          eq(shippingMethods.status, SHIPPING_METHOD_STATUS.ACTIVE),
          ownerCondition,
        ),
      )
      .orderBy(asc(shippingMethods.code), asc(shippingMethods.id));
  }

  /** Lists seller-visible Shipment headers with seller/store scope enforced inside the SQL query. */
  async listSellerShipments(
    scope: ShippingSellerScope,
    query: SellerShipmentListQuery,
  ): Promise<PaginatedShipmentRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      sellerScopeCondition(scope),
      query.sellerOrderId
        ? eq(shipments.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.status ? eq(shipments.status, query.status) : undefined,
    ]);

    const rows = await this.executor
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(where)
      .orderBy(...sellerShipmentSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(shipments)
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(where);

    return {
      items: rows.map((row) => row.shipment),
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads one Shipment only when its Seller Order belongs to the supplied server-derived seller/store scope. */
  async findShipmentInScope(
    shipmentId: string,
    scope: ShippingSellerScope,
  ): Promise<ShipmentRow | null> {
    const [row] = await this.executor
      .select({ shipment: shipments })
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), this.shipmentScopeExists(scope)))
      .limit(1);

    return row?.shipment ?? null;
  }

  /** Locks one seller-scoped Shipment before a service-approved tracking or lifecycle command. */
  async findShipmentForUpdateInScope(
    shipmentId: string,
    scope: ShippingSellerScope,
  ): Promise<ShipmentRow | null> {
    const [row] = await this.executor
      .select({ shipment: shipments })
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), this.shipmentScopeExists(scope)))
      .limit(1)
      .for("update");

    return row?.shipment ?? null;
  }

  /**
   * Serializes Shipment allocation calculations for the supplied Order Items inside the caller transaction.
   * Deterministic advisory-lock order prevents two concurrent create commands from allocating the same quantity.
   */
  async lockShipmentAllocations(orderItemIds: string[]): Promise<void> {
    for (const orderItemId of uniqueSortedIds(orderItemIds)) {
      const lockKey = `shipping-allocation:${orderItemId}`;
      await this.executor.execute(
        sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`,
      );
    }
  }

  /** Returns total persisted Shipment allocation per requested Order Item inside one scoped Seller Order. */
  async sumAllocatedQuantitiesInScope(
    sellerOrderId: string,
    orderItemIds: string[],
    scope: ShippingSellerScope,
  ): Promise<ShipmentAllocationTotalRow[]> {
    const uniqueOrderItemIds = uniqueSortedIds(orderItemIds);
    if (uniqueOrderItemIds.length === 0) return [];

    const rows = await this.executor
      .select({
        orderItemId: shipmentItems.orderItemId,
        allocatedQuantity: sql<number>`sum(${shipmentItems.quantity})::int`,
      })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(shipments.sellerOrderId, sellerOrderId),
          inArray(shipmentItems.orderItemId, uniqueOrderItemIds),
          sellerScopeCondition(scope),
        ),
      )
      .groupBy(shipmentItems.orderItemId)
      .orderBy(asc(shipmentItems.orderItemId));

    return rows.map((row) => ({
      orderItemId: row.orderItemId,
      allocatedQuantity: Number(row.allocatedQuantity),
    }));
  }

  /** Inserts one Shipment only after repository-level seller/store scope has been confirmed for its Seller Order. */
  async createShipmentInScope(
    input: CreateShipmentRecordInput,
    scope: ShippingSellerScope,
  ): Promise<ShipmentRow | null> {
    const [scopedSellerOrder] = await this.executor
      .select({ id: sellerOrders.id })
      .from(sellerOrders)
      .where(and(eq(sellerOrders.id, input.sellerOrderId), sellerScopeCondition(scope)))
      .limit(1);

    if (!scopedSellerOrder) return null;

    const values: NewShipmentRow = input;
    const [row] = await this.executor.insert(shipments).values(values).returning();

    if (!row) {
      throw new Error("Shipment insert completed without returning a row.");
    }

    return row;
  }

  /** Appends immutable Shipment Item allocations after confirming the parent Shipment remains in seller scope. */
  async createShipmentItemsInScope(
    shipmentId: string,
    items: CreateShipmentItemRecordInput[],
    scope: ShippingSellerScope,
  ): Promise<ShipmentItemRow[]> {
    if (items.length === 0) return [];
    if (!(await this.findShipmentInScope(shipmentId, scope))) return [];

    const values: NewShipmentItemRow[] = items.map((item) => ({
      shipmentId,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
    }));

    return this.executor.insert(shipmentItems).values(values).returning();
  }

  /** Appends one lifecycle-history row after confirming the parent Shipment remains in seller scope. */
  async appendStatusHistoryInScope(
    shipmentId: string,
    input: CreateShipmentStatusHistoryRecordInput,
    scope: ShippingSellerScope,
  ): Promise<ShipmentStatusHistoryRow | null> {
    if (!(await this.findShipmentInScope(shipmentId, scope))) return null;

    const values: NewShipmentStatusHistoryRow = {
      shipmentId,
      status: input.status,
      source: input.source,
      occurredAt: input.occurredAt,
      payloadRef: input.payloadRef ?? null,
    };
    const [row] = await this.executor
      .insert(shipmentStatusHistory)
      .values(values)
      .returning();

    return row ?? null;
  }

  /** Updates only service-approved tracking fields after rechecking seller/store scope. */
  async updateTrackingInScope(
    shipmentId: string,
    input: UpdateShipmentTrackingRecordInput,
    scope: ShippingSellerScope,
  ): Promise<ShipmentRow | null> {
    if (!(await this.findShipmentInScope(shipmentId, scope))) return null;

    const { updatedAt, ...tracking } = input;
    const [row] = await this.executor
      .update(shipments)
      .set({ ...tracking, updatedAt: updatedAt ?? new Date() })
      .where(and(eq(shipments.id, shipmentId), this.shipmentScopeExists(scope)))
      .returning();

    return row ?? null;
  }

  /** Persists only lifecycle fields already approved by the service after rechecking seller/store scope. */
  async updateLifecycleInScope(
    shipmentId: string,
    input: UpdateShipmentLifecycleRecordInput,
    scope: ShippingSellerScope,
  ): Promise<ShipmentRow | null> {
    if (!(await this.findShipmentInScope(shipmentId, scope))) return null;

    const { updatedAt, ...lifecycle } = input;
    const [row] = await this.executor
      .update(shipments)
      .set({ ...lifecycle, updatedAt: updatedAt ?? new Date() })
      .where(and(eq(shipments.id, shipmentId), this.shipmentScopeExists(scope)))
      .returning();

    return row ?? null;
  }

  /** Batch-loads immutable Shipment Items for seller-visible Shipments while preserving seller/store scope in SQL. */
  async listSellerShipmentItems(
    shipmentIds: string[],
    scope: ShippingSellerScope,
  ): Promise<ShipmentItemRow[]> {
    const uniqueShipmentIds = uniqueSortedIds(shipmentIds);
    if (uniqueShipmentIds.length === 0) return [];

    const rows = await this.executor
      .select({ item: shipmentItems })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          inArray(shipmentItems.shipmentId, uniqueShipmentIds),
          sellerScopeCondition(scope),
        ),
      )
      .orderBy(asc(shipmentItems.shipmentId), asc(shipmentItems.orderItemId));

    return rows.map((row) => row.item);
  }

  /** Batch-loads append-only Shipment history for seller-visible Shipments with seller/store scope enforced in SQL. */
  async listSellerShipmentHistory(
    shipmentIds: string[],
    scope: ShippingSellerScope,
  ): Promise<ShipmentStatusHistoryRow[]> {
    const uniqueShipmentIds = uniqueSortedIds(shipmentIds);
    if (uniqueShipmentIds.length === 0) return [];

    const rows = await this.executor
      .select({ history: shipmentStatusHistory })
      .from(shipmentStatusHistory)
      .innerJoin(shipments, eq(shipments.id, shipmentStatusHistory.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          inArray(shipmentStatusHistory.shipmentId, uniqueShipmentIds),
          sellerScopeCondition(scope),
        ),
      )
      .orderBy(
        asc(shipmentStatusHistory.shipmentId),
        asc(shipmentStatusHistory.occurredAt),
        asc(shipmentStatusHistory.id),
      );

    return rows.map((row) => row.history);
  }

  /** Serializes parent Order fulfillment reconciliation across concurrent Shipment state changes. */
  async lockOrderFulfillmentCalculation(orderId: string): Promise<void> {
    const lockKey = `shipping-fulfillment:${orderId}`;
    await this.executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );
  }

  /** Returns physically issued quantity across shipped/delivered Shipments for one parent Order. */
  async sumIssuedQuantityForOrder(orderId: string): Promise<number> {
    const [row] = await this.executor
      .select({
        quantity: sql<number>`coalesce(sum(${shipmentItems.quantity}), 0)::int`,
      })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, orderId),
          inArray(shipments.status, [...CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES]),
        ),
      );

    return Number(row?.quantity ?? 0);
  }

  /** Aggregates only delivered Shipment Items for one trusted parent Order Return-eligibility read. */
  async listDeliveredItemsForOrder(orderId: string): Promise<ReturnDeliveryItemRow[]> {
    const rows = await this.executor
      .select({
        orderItemId: shipmentItems.orderItemId,
        deliveredQuantity: sql<number>`sum(${shipmentItems.quantity})::int`,
        latestDeliveredAt: sql<Date>`max(${shipments.deliveredAt})`,
      })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, orderId),
          eq(shipments.status, "delivered"),
          sql`${shipments.deliveredAt} is not null`,
        ),
      )
      .groupBy(shipmentItems.orderItemId)
      .orderBy(asc(shipmentItems.orderItemId));

    return rows.map((row) => ({
      orderItemId: row.orderItemId,
      deliveredQuantity: Number(row.deliveredQuantity),
      latestDeliveredAt: row.latestDeliveredAt,
    }));
  }


  /** Reads one Wallet settlement delivery source without exposing Shipment persistence to Module 17. */
  async findWalletDeliveryItem(input: {
    orderId: string;
    sellerId: string;
    sellerOrderId: string;
    orderItemId: string;
  }): Promise<WalletDeliveryItemRow | null> {
    const [orderItem] = await this.executor
      .select({
        orderId: sellerOrders.orderId,
        sellerId: sellerOrders.sellerId,
        sellerOrderId: sellerOrders.id,
        orderItemId: orderItems.id,
        commercialQuantity: sql<number>`(${orderItems.qty} - ${orderItems.cancelledQty})::int`,
      })
      .from(orderItems)
      .innerJoin(sellerOrders, eq(sellerOrders.id, orderItems.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, input.orderId),
          eq(sellerOrders.sellerId, input.sellerId),
          eq(sellerOrders.id, input.sellerOrderId),
          eq(orderItems.id, input.orderItemId),
        ),
      )
      .limit(1);

    if (!orderItem) return null;

    const [delivery] = await this.executor
      .select({
        deliveredQuantity: sql<number>`coalesce(sum(${shipmentItems.quantity}), 0)::int`,
        latestDeliveredAt: sql<Date | null>`max(${shipments.deliveredAt})`,
      })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .where(
        and(
          eq(shipmentItems.orderItemId, input.orderItemId),
          eq(shipments.sellerOrderId, input.sellerOrderId),
          eq(shipments.status, "delivered"),
          sql`${shipments.deliveredAt} is not null`,
        ),
      );

    return {
      ...orderItem,
      deliveredQuantity: Number(delivery?.deliveredQuantity ?? 0),
      latestDeliveredAt: delivery?.latestDeliveredAt ?? null,
    };
  }

  /** Lists only shipped/delivered Shipment headers for one already-authorized Customer Order. */
  async listCustomerVisibleShipmentsForOrder(orderId: string): Promise<ShipmentRow[]> {
    const rows = await this.executor
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, orderId),
          inArray(shipments.status, [...CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES]),
        ),
      )
      .orderBy(asc(shipments.createdAt), asc(shipments.id));

    return rows.map((row) => row.shipment);
  }

  /** Loads Shipment Items only for customer-visible Shipments belonging to one already-authorized Customer Order. */
  async listCustomerVisibleShipmentItemsForOrder(
    orderId: string,
    shipmentIds: string[],
  ): Promise<ShipmentItemRow[]> {
    const uniqueShipmentIds = uniqueSortedIds(shipmentIds);
    if (uniqueShipmentIds.length === 0) return [];

    const rows = await this.executor
      .select({ item: shipmentItems })
      .from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, orderId),
          inArray(shipments.id, uniqueShipmentIds),
          inArray(shipments.status, [...CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES]),
        ),
      )
      .orderBy(asc(shipmentItems.shipmentId), asc(shipmentItems.orderItemId));

    return rows.map((row) => row.item);
  }

  /** Loads only shipped/delivered timeline entries for customer-visible Shipments on one authorized Customer Order. */
  async listCustomerVisibleShipmentHistoryForOrder(
    orderId: string,
    shipmentIds: string[],
  ): Promise<ShipmentStatusHistoryRow[]> {
    const uniqueShipmentIds = uniqueSortedIds(shipmentIds);
    if (uniqueShipmentIds.length === 0) return [];

    const rows = await this.executor
      .select({ history: shipmentStatusHistory })
      .from(shipmentStatusHistory)
      .innerJoin(shipments, eq(shipments.id, shipmentStatusHistory.shipmentId))
      .innerJoin(sellerOrders, eq(sellerOrders.id, shipments.sellerOrderId))
      .where(
        and(
          eq(sellerOrders.orderId, orderId),
          inArray(shipments.id, uniqueShipmentIds),
          inArray(shipments.status, [...CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES]),
          inArray(shipmentStatusHistory.status, [
            ...CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES,
          ]),
        ),
      )
      .orderBy(
        asc(shipmentStatusHistory.shipmentId),
        asc(shipmentStatusHistory.occurredAt),
        asc(shipmentStatusHistory.id),
      );

    return rows.map((row) => row.history);
  }
}

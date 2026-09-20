import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { OrderItemRow, OrderRow, SellerOrderRow } from "../../src/database/schema/orders.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import {
  ORDER_FULFILLMENT_STATUS,
  ORDER_ITEM_STATUS,
  ORDER_PAYMENT_STATUS,
  ORDER_SOURCE_TYPE,
  ORDER_STATUS,
  SELLER_ORDER_STATUS,
} from "../../src/modules/orders/orders.constants.js";
import { OrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";

/** Builds a customer or system context for the narrow Module 12 -> Orders boundaries. */
function requestContext(actorType: "customer" | "system", actorId: string | null): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates the minimum immutable parent Order fields needed by Payment-boundary tests. */
function orderRow(customerUserId: string): OrderRow {
  const id = randomUUID();
  return {
    id,
    orderNo: `ORD-${id.replaceAll("-", "").toUpperCase()}`,
    checkoutAttemptId: randomUUID(),
    customerUserId,
    currency: "PKR",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "0.0000",
    grandTotal: "100.0000",
    paymentStatus: ORDER_PAYMENT_STATUS.PENDING,
    fulfillmentStatus: ORDER_FULFILLMENT_STATUS.UNFULFILLED,
    orderStatus: ORDER_STATUS.PENDING_PAYMENT,
    placedAt: null,
    createdAt: new Date("2026-09-13T12:00:00.000Z"),
    updatedAt: new Date("2026-09-13T12:00:00.000Z"),
  };
}

/** Creates one active Order Item with a still-reserved quantity. */
function orderItem(order: OrderRow, sellerOrderId: string): OrderItemRow {
  return {
    id: randomUUID(),
    orderId: order.id,
    sellerOrderId,
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryReservationId: randomUUID(),
    skuSnapshot: "PAY-SKU-1",
    nameSnapshot: "Payment Boundary Product",
    variantTitleSnapshot: null,
    qty: 3,
    unitPrice: "33.3333",
    discountAllocated: "0.0000",
    taxAllocated: "0.0000",
    lineTotal: "99.9999",
    commissionRuleSnapshotJson: null,
    status: ORDER_ITEM_STATUS.ACTIVE,
    cancelledQty: 1,
    createdAt: new Date("2026-09-13T12:00:00.000Z"),
    updatedAt: new Date("2026-09-13T12:00:00.000Z"),
  };
}

/** Creates one pending-payment Seller Order used by unpaid-expiry tests. */
function sellerOrder(order: OrderRow): SellerOrderRow {
  const id = randomUUID();
  return {
    id,
    orderId: order.id,
    sellerId: randomUUID(),
    storeId: randomUUID(),
    sellerOrderNo: `SOR-${id.replaceAll("-", "").toUpperCase()}`,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    shippingTotal: order.shippingTotal,
    grandTotal: order.grandTotal,
    status: SELLER_ORDER_STATUS.PENDING_PAYMENT,
    shippingMethodId: randomUUID(),
    shippingMethodCodeSnapshot: "STANDARD",
    shippingMethodNameSnapshot: "Standard Delivery",
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

describe("Module 12 Pass 2 narrow Orders service boundaries", () => {
  it("returns the owning customer's immutable Order total and Checkout-attempt Payment deadline", async () => {
    const customerUserId = randomUUID();
    const order = orderRow(customerUserId);
    const sellerOrderId = randomUUID();
    const item = orderItem(order, sellerOrderId);
    const repository = {
      findPaymentBoundaryForCustomer: vi.fn().mockResolvedValue({
        order,
        paymentExpiresAt: new Date("2026-09-13T13:00:00.000Z"),
      }),
      listOrderItemsByOrderId: vi.fn().mockResolvedValue([item]),
    } as unknown as OrdersRepository;
    const service = new OrdersService({ repository });

    const snapshot = await service.getPaymentSnapshot(
      requestContext(ACTOR_TYPE.CUSTOMER, customerUserId),
      order.id,
    );

    expect(snapshot).toEqual({
      orderId: order.id,
      customerUserId,
      currency: "PKR",
      grandTotal: "100.0000",
      paymentStatus: ORDER_PAYMENT_STATUS.PENDING,
      orderStatus: ORDER_STATUS.PENDING_PAYMENT,
      checkoutAttemptId: order.checkoutAttemptId,
      paymentExpiresAt: "2026-09-13T13:00:00.000Z",
      remainingItemQuantity: 2,
    });
  });

  it("expires one overdue unpaid Order and releases every remaining Inventory reservation exactly once", async () => {
    const now = new Date("2026-09-13T14:00:00.000Z");
    const customerUserId = randomUUID();
    const order = orderRow(customerUserId);
    const child = sellerOrder(order);
    const item = orderItem(order, child.id);
    const updatedItem = { ...item, cancelledQty: item.qty, status: ORDER_ITEM_STATUS.CANCELLED };
    const updatedChild = { ...child, status: SELLER_ORDER_STATUS.CANCELLED };
    const updatedOrder = { ...order, orderStatus: ORDER_STATUS.CANCELLED };
    const releaseReservationQuantity = vi.fn().mockResolvedValue({});
    const createStatusHistory = vi.fn().mockResolvedValue([]);

    const repository = {
      lockOrderById: vi.fn().mockResolvedValue(order),
      findStatusHistoryBySource: vi.fn().mockResolvedValue(null),
      findPaymentBoundaryByOrderId: vi.fn().mockResolvedValue({
        order,
        paymentExpiresAt: new Date("2026-09-13T13:00:00.000Z"),
      }),
      lockOrderItemsByOrderId: vi.fn().mockResolvedValue([item]),
      updateOrderItemCancellation: vi.fn().mockResolvedValue(updatedItem),
      listSellerOrdersByOrderId: vi.fn().mockResolvedValue([child]),
      updateSellerOrderStatus: vi.fn().mockResolvedValue(updatedChild),
      updateDerivedOrderStatus: vi.fn().mockResolvedValue(updatedOrder),
      createStatusHistory,
    } as unknown as OrdersRepository;
    const transaction = {} as DatabaseTransaction;
    const auditRecord = vi.fn().mockResolvedValue(randomUUID());
    const enqueue = vi.fn().mockResolvedValue(randomUUID());
    const service = new OrdersService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      inventoryUsingTransaction: () => ({
        commitStockReservation: vi.fn(),
        releaseReservationQuantity,
      }),
      auditUsingTransaction: () => ({ record: auditRecord }),
      outboxUsingTransaction: () => ({ enqueue }),
      now: () => now,
    });

    const result = await service.expireUnpaidOrder(
      requestContext(ACTOR_TYPE.SYSTEM, null),
      order.id,
      `payments:expiry:${order.id}`,
    );

    expect(result).toEqual({ orderId: order.id, expired: true, orderStatus: ORDER_STATUS.CANCELLED });
    expect(releaseReservationQuantity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reservationId: item.inventoryReservationId, quantity: 2 }),
    );
    expect(createStatusHistory).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: order.id,
          sourceType: ORDER_SOURCE_TYPE.PAYMENT_EXPIRED,
          sourceKey: `payments:expiry:${order.id}`,
          toStatus: ORDER_STATUS.CANCELLED,
        }),
      ]),
    );
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("never expires an Order that is already provider-confirmed", async () => {
    const customerUserId = randomUUID();
    const order = { ...orderRow(customerUserId), paymentStatus: ORDER_PAYMENT_STATUS.CAPTURED };
    const repository = {
      lockOrderById: vi.fn().mockResolvedValue(order),
      findStatusHistoryBySource: vi.fn().mockResolvedValue(null),
    } as unknown as OrdersRepository;
    const transaction = {} as DatabaseTransaction;
    const releaseReservationQuantity = vi.fn();
    const service = new OrdersService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      inventoryUsingTransaction: () => ({
        commitStockReservation: vi.fn(),
        releaseReservationQuantity,
      }),
    });

    await expect(
      service.expireUnpaidOrder(
        requestContext(ACTOR_TYPE.SYSTEM, null),
        order.id,
        `payments:expiry:${order.id}`,
      ),
    ).resolves.toEqual({ orderId: order.id, expired: false, orderStatus: order.orderStatus });
    expect(releaseReservationQuantity).not.toHaveBeenCalled();
  });
});

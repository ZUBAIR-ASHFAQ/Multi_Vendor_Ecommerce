import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { OrderItemRow, OrderRow, SellerOrderRow } from "../../src/database/schema/orders.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import {
  ORDER_PAYMENT_STATUS,
  ORDER_STATUS,
  ORDERS_ERROR_CODE,
  ORDERS_OUTBOX_EVENT,
  ORDERS_PERMISSION,
  SELLER_ORDER_STATUS,
} from "../../src/modules/orders/orders.constants.js";
import {
  OrdersRepository,
  type CreateOrderRecordInput,
  type CreateSellerOrderRecordInput,
} from "../../src/modules/orders/orders.repository.js";
import {
  OrdersService,
  type OrdersAuditIntegration,
  type OrdersIdempotencyIntegration,
  type OrdersInventoryIntegration,
  type OrdersOutboxIntegration,
} from "../../src/modules/orders/orders.service.js";
import type { CreateOrderFromCheckoutInput } from "../../src/modules/orders/orders.schema.js";

/** Builds an authenticated customer/admin context for readable Orders service tests. */
function actorContext(
  actorType: RequestContext["actorType"] = ACTOR_TYPE.CUSTOMER,
  permissions: PermissionCode[] = [ORDERS_PERMISSION.READ_OWN],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one seller context whose permission is effective only in one seller/store scope. */
function sellerContext(
  sellerId: string,
  storeId: string,
  permission = ORDERS_PERMISSION.SELLER_MANAGE,
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([sellerId]),
    storeIds: new Set([storeId]),
    sellerPermissions: new Map([[sellerId, new Set([permission])]]),
    sessionId: randomUUID(),
  };
}

/** Creates the smallest trusted Checkout snapshot containing two deterministic seller/store groups. */
function checkoutSnapshot(): CreateOrderFromCheckoutInput {
  const sellerA = randomUUID();
  const sellerB = randomUUID();
  const storeA = randomUUID();
  const storeB = randomUUID();
  const address = {
    sourceAddressId: randomUUID(),
    recipientName: "Orders Customer",
    phone: "+92 300 1234567",
    line1: "1 Order Road",
    line2: null,
    city: "Karachi",
    region: "Sindh",
    postalCode: "74000",
    countryCode: "PK",
  };

  return {
    checkoutAttemptId: randomUUID(),
    customerUserId: randomUUID(),
    currency: "PKR",
    subtotal: "300.0000",
    discountTotal: "30.0000",
    taxTotal: "13.5000",
    shippingTotal: "30.0000",
    grandTotal: "313.5000",
    shippingAddress: address,
    billingAddress: address,
    lines: [
      {
        productId: randomUUID(),
        variantId: randomUUID(),
        sellerId: sellerA,
        storeId: storeA,
        inventoryReservationId: randomUUID(),
        skuSnapshot: "SKU-A",
        nameSnapshot: "Product A",
        variantTitleSnapshot: "Default",
        quantity: 2,
        unitPrice: "100.0000",
        discountAllocated: "20.0000",
        taxAllocated: "9.0000",
        lineTotal: "189.0000",
      },
      {
        productId: randomUUID(),
        variantId: randomUUID(),
        sellerId: sellerB,
        storeId: storeB,
        inventoryReservationId: randomUUID(),
        skuSnapshot: "SKU-B",
        nameSnapshot: "Product B",
        variantTitleSnapshot: null,
        quantity: 1,
        unitPrice: "100.0000",
        discountAllocated: "10.0000",
        taxAllocated: "4.5000",
        lineTotal: "94.5000",
      },
    ],
    shippingSelections: [
      {
        sellerId: sellerA,
        storeId: storeA,
        shippingMethodId: randomUUID(),
        shippingMethodCodeSnapshot: "STANDARD-A",
        shippingMethodNameSnapshot: "Standard A",
        amount: "10.0000",
        currency: "PKR",
      },
      {
        sellerId: sellerB,
        storeId: storeB,
        shippingMethodId: randomUUID(),
        shippingMethodCodeSnapshot: "STANDARD-B",
        shippingMethodNameSnapshot: "Standard B",
        amount: "20.0000",
        currency: "PKR",
      },
    ],
  };
}

/** Creates a narrow repository double while preserving the real repository type at the service boundary. */
function repositoryStub(overrides: Partial<Record<keyof OrdersRepository, unknown>>): OrdersRepository {
  return {
    findOrderByCheckoutAttemptId: vi.fn().mockResolvedValue(null),
    createOrder: vi.fn(),
    createSellerOrders: vi.fn().mockResolvedValue([]),
    createOrderItems: vi.fn().mockResolvedValue([]),
    createOrderAddresses: vi.fn().mockResolvedValue([]),
    createStatusHistory: vi.fn().mockResolvedValue([]),
    listSellerOrdersByOrderId: vi.fn().mockResolvedValue([]),
    listOrderItemsByOrderId: vi.fn().mockResolvedValue([]),
    listOrderAddressesByOrderId: vi.fn().mockResolvedValue([]),
    listOrderStatusHistory: vi.fn().mockResolvedValue([]),
    findOrderById: vi.fn(),
    updateSellerOrderStatus: vi.fn(),
    ...overrides,
  } as unknown as OrdersRepository;
}

/** Returns transaction dependencies that never touch a real database, audit table, or outbox. */
function serviceDependencies(repository: OrdersRepository) {
  const audit: OrdersAuditIntegration = { record: vi.fn().mockResolvedValue(randomUUID()) };
  const outbox = { enqueue: vi.fn().mockResolvedValue(randomUUID()) } as unknown as OrdersOutboxIntegration;
  const transaction = {} as DatabaseTransaction;
  return {
    repository,
    repositoryUsingTransaction: () => repository,
    transactionRunner: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
    auditUsingTransaction: () => audit,
    outboxUsingTransaction: () => outbox,
    securityAudit: audit,
    audit,
    outbox,
  };
}

/** Builds one persisted parent Order row for lifecycle tests. */
function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  const now = new Date("2026-09-12T12:00:00.000Z");
  return {
    id: randomUUID(),
    orderNo: `ORD-${randomUUID().replaceAll("-", "").toUpperCase()}`,
    checkoutAttemptId: randomUUID(),
    customerUserId: randomUUID(),
    currency: "PKR",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "10.0000",
    grandTotal: "110.0000",
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    orderStatus: "pending_payment",
    placedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Builds one persisted Seller Order row for lifecycle tests. */
function sellerOrderRow(orderId: string, overrides: Partial<SellerOrderRow> = {}): SellerOrderRow {
  const now = new Date("2026-09-12T12:00:00.000Z");
  return {
    id: randomUUID(),
    orderId,
    sellerId: randomUUID(),
    storeId: randomUUID(),
    sellerOrderNo: `SOR-${randomUUID().replaceAll("-", "").toUpperCase()}`,
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "10.0000",
    grandTotal: "110.0000",
    status: "pending_payment",
    shippingMethodId: randomUUID(),
    shippingMethodCodeSnapshot: "STANDARD",
    shippingMethodNameSnapshot: "Standard",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Builds one persisted Order Item row backed by an Inventory reservation. */
function orderItemRow(
  orderId: string,
  sellerOrderId: string,
  overrides: Partial<OrderItemRow> = {},
): OrderItemRow {
  const now = new Date("2026-09-12T12:00:00.000Z");
  return {
    id: randomUUID(),
    orderId,
    sellerOrderId,
    productId: randomUUID(),
    variantId: randomUUID(),
    inventoryReservationId: randomUUID(),
    skuSnapshot: "SKU-1",
    nameSnapshot: "Product 1",
    variantTitleSnapshot: null,
    qty: 2,
    unitPrice: "50.0000",
    discountAllocated: "0.0000",
    taxAllocated: "0.0000",
    lineTotal: "100.0000",
    commissionRuleSnapshotJson: null,
    status: "active",
    cancelledQty: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Module 11 Orders service rules", () => {
  it("creates one immutable parent Order plus deterministic reconciled Seller Orders from Checkout", async () => {
    const snapshot = checkoutSnapshot();
    const createdOrder = orderRow({
      checkoutAttemptId: snapshot.checkoutAttemptId,
      customerUserId: snapshot.customerUserId,
      subtotal: snapshot.subtotal,
      discountTotal: snapshot.discountTotal,
      taxTotal: snapshot.taxTotal,
      shippingTotal: snapshot.shippingTotal,
      grandTotal: snapshot.grandTotal,
    });
    const createdSellerOrders: SellerOrderRow[] = [];
    const repository = repositoryStub({
      createOrder: vi.fn().mockImplementation(async (input: CreateOrderRecordInput) => ({
        ...createdOrder,
        ...input,
      })),
      createSellerOrders: vi.fn().mockImplementation(async (inputs: CreateSellerOrderRecordInput[]) => {
        createdSellerOrders.push(
          ...inputs.map((input: CreateSellerOrderRecordInput) => sellerOrderRow(createdOrder.id, input)),
        );
        return createdSellerOrders;
      }),
    });
    const dependencies = serviceDependencies(repository);
    const service = new OrdersService({
      ...dependencies,
      createId: vi
        .fn()
        .mockReturnValueOnce(createdOrder.id)
        .mockReturnValueOnce(randomUUID())
        .mockReturnValueOnce(randomUUID())
        .mockReturnValue(randomUUID()),
    });

    await expect(service.createFromCheckout(actorContext(), snapshot)).resolves.toMatchObject({
      id: createdOrder.id,
    });
    expect(repository.createSellerOrders).toHaveBeenCalledTimes(1);
    expect(createdSellerOrders).toHaveLength(2);
    expect(createdSellerOrders.reduce((sum, row) => sum + Number(row.grandTotal), 0)).toBe(313.5);
    expect(repository.createOrderItems).toHaveBeenCalledTimes(1);
    expect(repository.createOrderAddresses).toHaveBeenCalledTimes(1);
    expect(repository.createStatusHistory).toHaveBeenCalledTimes(1);
    expect(dependencies.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: ORDERS_OUTBOX_EVENT.CREATED }),
    );
  });

  it("rejects a trusted Checkout snapshot whose Seller Order money cannot reconcile", async () => {
    const snapshot = checkoutSnapshot();
    snapshot.grandTotal = "999.0000";
    const repository = repositoryStub({});
    const dependencies = serviceDependencies(repository);
    const service = new OrdersService(dependencies);

    await expect(service.createFromCheckout(actorContext(), snapshot)).rejects.toMatchObject({
      code: ORDERS_ERROR_CODE.SOURCE_DUPLICATE,
      statusCode: 409,
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it("commits remaining reservations and moves Seller Orders to pending acceptance on payment confirmation", async () => {
    const order = orderRow();
    const sellerOrder = sellerOrderRow(order.id);
    const item = orderItemRow(order.id, sellerOrder.id);
    const captured = { ...order, paymentStatus: ORDER_PAYMENT_STATUS.CAPTURED, placedAt: new Date() };
    const confirmed = { ...captured, orderStatus: ORDER_STATUS.CONFIRMED };
    const pendingAcceptance = {
      ...sellerOrder,
      status: SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
    };
    const repository = repositoryStub({
      lockOrderById: vi.fn().mockResolvedValue(order),
      findStatusHistoryBySource: vi.fn().mockResolvedValue(null),
      lockOrderItemsByOrderId: vi.fn().mockResolvedValue([item]),
      markOrderPaymentCaptured: vi.fn().mockResolvedValue(captured),
      listSellerOrdersByOrderId: vi.fn().mockResolvedValue([sellerOrder]),
      updateSellerOrderStatus: vi.fn().mockResolvedValue(pendingAcceptance),
      updateDerivedOrderStatus: vi.fn().mockResolvedValue(confirmed),
      findOrderById: vi.fn().mockResolvedValue(confirmed),
      listOrderItemsByOrderId: vi.fn().mockResolvedValue([item]),
      listOrderAddressesByOrderId: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          orderId: order.id,
          type: "shipping",
          sourceAddressId: randomUUID(),
          recipientName: "Customer",
          phone: "123",
          line1: "Street",
          line2: null,
          city: "Karachi",
          region: "Sindh",
          postalCode: null,
          countryCode: "PK",
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          orderId: order.id,
          type: "billing",
          sourceAddressId: randomUUID(),
          recipientName: "Customer",
          phone: "123",
          line1: "Street",
          line2: null,
          city: "Karachi",
          region: "Sindh",
          postalCode: null,
          countryCode: "PK",
          createdAt: new Date(),
        },
      ]),
      listOrderStatusHistory: vi.fn().mockResolvedValue([]),
    });
    const inventory: OrdersInventoryIntegration = {
      commitStockReservation: vi.fn().mockResolvedValue({}),
      releaseReservationQuantity: vi.fn(),
    };
    const dependencies = serviceDependencies(repository);
    const service = new OrdersService({
      ...dependencies,
      inventoryUsingTransaction: () => inventory,
    });

    await service.confirmPayment(actorContext(ACTOR_TYPE.SYSTEM, []), order.id, {
      paymentId: randomUUID(),
      paymentTransactionId: randomUUID(),
      sourceKey: `payments:${randomUUID()}`,
      currency: order.currency,
      capturedAmount: order.grandTotal,
      capturedAt: new Date().toISOString(),
    });

    expect(inventory.commitStockReservation).toHaveBeenCalledWith(
      expect.anything(),
      { reservationId: item.inventoryReservationId },
    );
    expect(repository.updateSellerOrderStatus).toHaveBeenCalledWith(
      sellerOrder.id,
      SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
      expect.any(Date),
    );
    expect(dependencies.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED }),
    );
  });


  it("releases reserved quantity and derives child/parent cancellation state in the same transaction", async () => {
    const context = actorContext();
    const order = orderRow({ customerUserId: context.actorId! });
    const sellerOrder = sellerOrderRow(order.id);
    const item = orderItemRow(order.id, sellerOrder.id, { qty: 2 });
    const cancelledItem = { ...item, cancelledQty: 2, status: "cancelled" };
    const cancelledSeller = { ...sellerOrder, status: SELLER_ORDER_STATUS.CANCELLED };
    const cancelledOrder = { ...order, orderStatus: ORDER_STATUS.CANCELLED };
    const repository = repositoryStub({
      lockOrderForCustomer: vi.fn().mockResolvedValue(order),
      lockOrderItemsByOrderId: vi.fn().mockResolvedValue([item]),
      updateOrderItemCancellation: vi.fn().mockResolvedValue(cancelledItem),
      listSellerOrdersByOrderId: vi.fn().mockResolvedValue([sellerOrder]),
      updateSellerOrderStatus: vi.fn().mockResolvedValue(cancelledSeller),
      updateDerivedOrderStatus: vi.fn().mockResolvedValue(cancelledOrder),
      listOrderItemsByOrderId: vi.fn().mockResolvedValue([cancelledItem]),
      listOrderAddressesByOrderId: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          orderId: order.id,
          type: "shipping",
          sourceAddressId: null,
          recipientName: "Customer",
          phone: "123",
          line1: "Street",
          line2: null,
          city: "Karachi",
          region: "Sindh",
          postalCode: null,
          countryCode: "PK",
          createdAt: new Date(),
        },
        {
          id: randomUUID(),
          orderId: order.id,
          type: "billing",
          sourceAddressId: null,
          recipientName: "Customer",
          phone: "123",
          line1: "Street",
          line2: null,
          city: "Karachi",
          region: "Sindh",
          postalCode: null,
          countryCode: "PK",
          createdAt: new Date(),
        },
      ]),
      listOrderStatusHistory: vi.fn().mockResolvedValue([]),
    });
    const inventory: OrdersInventoryIntegration = {
      commitStockReservation: vi.fn(),
      releaseReservationQuantity: vi.fn().mockResolvedValue({}),
    };
    const idempotency: OrdersIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({ mode: "acquired", recordId: randomUUID() }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const dependencies = serviceDependencies(repository);
    const service = new OrdersService({
      ...dependencies,
      inventoryUsingTransaction: () => inventory,
      idempotency,
    });

    await service.cancelCustomerOrder(
      context,
      order.id,
      { items: [{ orderItemId: item.id, quantity: 2 }], reason: "Changed my mind" },
      "cancel-order-once",
    );

    expect(inventory.releaseReservationQuantity).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        reservationId: item.inventoryReservationId,
        quantity: 2,
        sourceKey: expect.stringContaining(`order-cancel:${order.id}:`),
      }),
    );
    expect(repository.updateSellerOrderStatus).toHaveBeenCalledWith(
      sellerOrder.id,
      SELLER_ORDER_STATUS.CANCELLED,
      expect.any(Date),
    );
    expect(repository.updateDerivedOrderStatus).toHaveBeenCalledWith(
      order.id,
      ORDER_STATUS.CANCELLED,
      expect.any(Date),
    );
    expect(dependencies.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: ORDERS_OUTBOX_EVENT.CANCELLED }),
    );
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });

  it("replays a completed customer cancellation without opening another transaction", async () => {
    const detail = {
      id: randomUUID(),
      orderNo: `ORD-${randomUUID().replaceAll("-", "").toUpperCase()}`,
      currency: "PKR",
      subtotal: "100.0000",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      shippingTotal: "10.0000",
      grandTotal: "110.0000",
      paymentStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      orderStatus: "cancelled",
      placedAt: null,
      createdAt: new Date().toISOString(),
      shippingAddress: {
        recipientName: "Customer",
        phone: "123",
        line1: "Street",
        line2: null,
        city: "Karachi",
        region: "Sindh",
        postalCode: null,
        countryCode: "PK",
      },
      billingAddress: {
        recipientName: "Customer",
        phone: "123",
        line1: "Street",
        line2: null,
        city: "Karachi",
        region: "Sindh",
        postalCode: null,
        countryCode: "PK",
      },
      sellerOrders: [],
      statusHistory: [],
    };
    const idempotency: OrdersIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({
        mode: "replay",
        replay: { statusCode: 200, responseBody: detail },
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const transactionRunner = vi.fn();
    const service = new OrdersService({ idempotency, transactionRunner });
    const context = actorContext();

    await expect(
      service.cancelCustomerOrder(context, detail.id, {}, "customer-cancel-retry"),
    ).resolves.toEqual(detail);
    expect(transactionRunner).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it("resolves Notification participants from the immutable Order and de-duplicates seller identities", async () => {
    const order = orderRow();
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const listSellerOrdersByOrderId = vi.fn().mockResolvedValue([
      sellerOrderRow(order.id, { sellerId: sellerB }),
      sellerOrderRow(order.id, { sellerId: sellerA }),
      sellerOrderRow(order.id, { sellerId: sellerB }),
    ]);
    const repository = repositoryStub({
      findOrderById: vi.fn().mockResolvedValue(order),
      listSellerOrdersByOrderId,
    });
    const service = new OrdersService({ repository });

    await expect(service.resolveNotificationParticipants(order.id)).resolves.toEqual({
      customerUserId: order.customerUserId,
      sellerIds: [sellerA, sellerB].sort(),
    });
    expect(listSellerOrdersByOrderId).toHaveBeenCalledWith(order.id);
  });

  it("keeps seller acceptance scoped and treats an already-processing Seller Order as an exact retry", async () => {
    const order = orderRow({ paymentStatus: "captured", orderStatus: "processing" });
    const sellerOrder = sellerOrderRow(order.id, { status: "processing" });
    const context = sellerContext(
      sellerOrder.sellerId,
      sellerOrder.storeId,
      ORDERS_PERMISSION.SELLER_MANAGE,
    );
    const repository = repositoryStub({
      lockSellerOrderInScope: vi.fn().mockResolvedValue({ order, sellerOrder }),
      listOrderItemsBySellerOrderInScope: vi.fn().mockResolvedValue([]),
      listOrderAddressesByOrderId: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          orderId: order.id,
          type: "shipping",
          sourceAddressId: null,
          recipientName: "Customer",
          phone: "123",
          line1: "Street",
          line2: null,
          city: "Karachi",
          region: "Sindh",
          postalCode: null,
          countryCode: "PK",
          createdAt: new Date(),
        },
      ]),
      listSellerOrderStatusHistoryInScope: vi.fn().mockResolvedValue([]),
    });
    const dependencies = serviceDependencies(repository);
    const service = new OrdersService(dependencies);

    await service.acceptSellerOrder(context, sellerOrder.id);
    expect(repository.updateSellerOrderStatus).not.toHaveBeenCalled();
    expect(dependencies.outbox.enqueue).not.toHaveBeenCalled();
  });
});

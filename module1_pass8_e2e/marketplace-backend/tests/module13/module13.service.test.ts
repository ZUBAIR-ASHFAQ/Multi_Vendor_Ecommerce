import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { ShipmentRow, ShippingMethodRow } from "../../src/database/schema/shipping.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import type { CartResponse } from "../../src/modules/cart-wishlist/cart-wishlist.schema.js";
import {
  SHIPMENT_STATUS,
  SHIPPING_ERROR_CODE,
  SHIPPING_PERMISSION,
} from "../../src/modules/shipping/shipping.constants.js";
import { ShippingRepository } from "../../src/modules/shipping/shipping.repository.js";
import {
  ShippingService,
  type ShippingCartIntegration,
  type ShippingCurrencyIntegration,
  type ShippingCustomerIntegration,
  type ShippingAuditIntegration,
  type ShippingIdempotencyIntegration,
  type ShippingInventoryIntegration,
  type ShippingOrdersIntegration,
  type ShippingOutboxIntegration,
  type ShippingProductIntegration,
} from "../../src/modules/shipping/shipping.service.js";

/** Builds one authenticated customer context for Shipping Core service tests. */
function customerContext(actorId = randomUUID()): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one available Cart line with server-preview fields required by the current Cart contract. */
function cartLine(productId: string, variantId = randomUUID()) {
  const now = "2026-09-12T10:00:00.000Z";
  return {
    id: randomUUID(),
    productId,
    variantId,
    productName: "Shipping Product",
    productSlug: `shipping-${productId}`,
    variantTitle: "Default",
    sku: `SKU-${variantId}`,
    currentUnitPrice: "100.00",
    currency: "PKR",
    quantity: 1,
    previewLineSubtotal: "100.00",
    inStock: true,
    isPurchasable: true,
    addedAt: now,
    updatedAt: now,
  } as const;
}

/** Builds a minimal current Cart response for Shipping Core orchestration tests. */
function cartResponse(productIds: string[], unavailable = false): CartResponse {
  return {
    id: randomUUID(),
    currency: "PKR",
    items: productIds.map((productId) => cartLine(productId)),
    previewSubtotal: `${productIds.length * 100}.00`,
    hasUnavailableItems: unavailable,
    updatedAt: "2026-09-12T10:00:00.000Z",
  };
}

/** Builds one persisted shipping-method row for an explicit owner/currency. */
function shippingMethod(input: {
  ownerType: "platform" | "seller";
  sellerId: string | null;
  code: string;
  rate: string;
}): ShippingMethodRow {
  return {
    id: randomUUID(),
    ownerType: input.ownerType,
    sellerId: input.sellerId,
    code: input.code,
    name: `${input.code} Shipping`,
    pricingType: "flat",
    baseRate: input.rate,
    currency: "PKR",
    status: "active",
  };
}

/** Creates a repository double that exposes only the Checkout-eligible read used by the service. */
function repositoryStub(methods: ShippingMethodRow[]): ShippingRepository {
  return {
    listCheckoutEligibleMethods: vi.fn().mockResolvedValue(methods),
  } as unknown as ShippingRepository;
}

describe("Module 13 Shipping Configuration Core service", () => {
  it("derives store groups from Cart Products and keeps seller-private methods inside their own group", async () => {
    const context = customerContext();
    const addressId = randomUUID();
    const productA = randomUUID();
    const productB = randomUUID();
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const storeA = "00000000-0000-4000-8000-000000000002";
    const storeB = "00000000-0000-4000-8000-000000000001";
    const platform = shippingMethod({
      ownerType: "platform",
      sellerId: null,
      code: "A-PLATFORM",
      rate: "10.0000",
    });
    const methodA = shippingMethod({
      ownerType: "seller",
      sellerId: sellerA,
      code: "B-SELLER-A",
      rate: "7.0000",
    });
    const methodB = shippingMethod({
      ownerType: "seller",
      sellerId: sellerB,
      code: "B-SELLER-B",
      rate: "8.0000",
    });
    const customers: ShippingCustomerIntegration = {
      assertActiveOwnedAddress: vi.fn().mockResolvedValue(undefined),
    };
    const cart: ShippingCartIntegration = {
      getCheckoutCart: vi.fn().mockResolvedValue(cartResponse([productA, productB, productA])),
    };
    const products: ShippingProductIntegration = {
      resolvePublicProductSellerStoreScope: vi.fn().mockImplementation(async (productId) =>
        productId === productA
          ? { productId, sellerId: sellerA, storeId: storeA, categoryId: randomUUID() }
          : { productId, sellerId: sellerB, storeId: storeB, categoryId: randomUUID() },
      ),
    };
    const currencies: ShippingCurrencyIntegration = {
      isSupportedCurrency: vi.fn().mockResolvedValue(true),
    };
    const repository = repositoryStub([methodB, platform, methodA]);
    const service = new ShippingService({
      repository,
      customers,
      cart,
      products,
      currencies,
    });

    const result = await service.getCheckoutShippingOptions(context, { addressId });

    expect(customers.assertActiveOwnedAddress).toHaveBeenCalledWith(context, addressId);
    expect(repository.listCheckoutEligibleMethods).toHaveBeenCalledWith("PKR", [
      sellerA,
      sellerB,
    ].sort());
    expect(result.groups.map((group) => group.storeId)).toEqual([storeB, storeA]);
    expect(result.groups[0]?.options.map((option) => option.code)).toEqual([
      "A-PLATFORM",
      "B-SELLER-B",
    ]);
    expect(result.groups[1]?.options.map((option) => option.code)).toEqual([
      "A-PLATFORM",
      "B-SELLER-A",
    ]);
  });

  it("rejects a stale Cart before reading shipping methods", async () => {
    const customers: ShippingCustomerIntegration = {
      assertActiveOwnedAddress: vi.fn().mockResolvedValue(undefined),
    };
    const cart: ShippingCartIntegration = {
      getCheckoutCart: vi.fn().mockResolvedValue(cartResponse([randomUUID()], true)),
    };
    const repository = repositoryStub([]);
    const service = new ShippingService({ customers, cart, repository });

    await expect(
      service.getCheckoutShippingOptions(customerContext(), { addressId: randomUUID() }),
    ).rejects.toMatchObject({ code: ERROR_CODE.CONFLICT, statusCode: 409 });
    expect(repository.listCheckoutEligibleMethods).not.toHaveBeenCalled();
  });

  it("rejects an unsupported Cart currency before reading shipping methods", async () => {
    const customers: ShippingCustomerIntegration = {
      assertActiveOwnedAddress: vi.fn().mockResolvedValue(undefined),
    };
    const cart: ShippingCartIntegration = {
      getCheckoutCart: vi.fn().mockResolvedValue(cartResponse([])),
    };
    const currencies: ShippingCurrencyIntegration = {
      isSupportedCurrency: vi.fn().mockResolvedValue(false),
    };
    const repository = repositoryStub([]);
    const service = new ShippingService({
      customers,
      cart,
      currencies,
      repository,
    });

    await expect(
      service.getCheckoutShippingOptions(customerContext(), { addressId: randomUUID() }),
    ).rejects.toMatchObject({ code: ERROR_CODE.CONFLICT, statusCode: 409 });
    expect(repository.listCheckoutEligibleMethods).not.toHaveBeenCalled();
  });
});

/** Builds one seller context with the exact Shipping permissions required by private fulfillment services. */
function sellerContext(input: {
  actorId?: string | null;
  sellerId?: string;
  storeId?: string;
} = {}): RequestContext {
  const sellerId = input.sellerId ?? randomUUID();
  const storeId = input.storeId ?? randomUUID();
  return {
    requestId: randomUUID(),
    actorId: input.actorId === undefined ? randomUUID() : input.actorId,
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([sellerId]),
    storeIds: new Set([storeId]),
    sellerPermissions: new Map([
      [
        sellerId,
        new Set([
          SHIPPING_PERMISSION.SELLER_READ,
          SHIPPING_PERMISSION.SELLER_MANAGE,
        ]),
      ],
    ]),
    sessionId: randomUUID(),
  };
}

/** Builds one persisted Shipment row for focused fulfillment service regression tests. */
function shipmentRow(
  status: "created" | "shipped" | "delivered",
  input: Partial<ShipmentRow> = {},
): ShipmentRow {
  const id = input.id ?? randomUUID();
  const now = new Date("2026-09-15T04:00:00.000Z");
  const shippedAt =
    status === SHIPMENT_STATUS.CREATED
      ? null
      : input.shippedAt ?? new Date("2026-09-15T04:05:00.000Z");
  const deliveredAt =
    status === SHIPMENT_STATUS.DELIVERED
      ? input.deliveredAt ?? new Date("2026-09-15T04:10:00.000Z")
      : null;

  return {
    id,
    sellerOrderId: input.sellerOrderId ?? randomUUID(),
    shipmentNo: `SHP-${id.replaceAll("-", "").toUpperCase()}`,
    carrier: input.carrier ?? (status === SHIPMENT_STATUS.CREATED ? null : "Carrier"),
    serviceLevel: input.serviceLevel ?? null,
    trackingNo: input.trackingNo ?? (status === SHIPMENT_STATUS.CREATED ? null : "TRACK-1"),
    status,
    shippedAt,
    deliveredAt,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** Builds one Orders fulfillment snapshot that stays inside the seller/store scope used by the test. */
function fulfillmentSnapshot(input: {
  orderId?: string;
  sellerOrderId: string;
  sellerId: string;
  storeId: string;
  orderItemId?: string;
  variantId?: string;
  reservationId?: string;
}) {
  return {
    orderId: input.orderId ?? randomUUID(),
    sellerOrderId: input.sellerOrderId,
    sellerId: input.sellerId,
    storeId: input.storeId,
    paymentStatus: "captured",
    sellerOrderStatus: "processing",
    fulfillmentStatus: "unfulfilled",
    items: [
      {
        orderItemId: input.orderItemId ?? randomUUID(),
        sellerOrderId: input.sellerOrderId,
        variantId: input.variantId ?? randomUUID(),
        inventoryReservationId: input.reservationId ?? randomUUID(),
        quantity: 1,
        cancelledQuantity: 0,
      },
    ],
  };
}

/** Creates an acquired root idempotency double and a transaction-bound completion double. */
function idempotencyDoubles() {
  const root: ShippingIdempotencyIntegration = {
    begin: vi.fn().mockResolvedValue({ mode: "acquired", recordId: randomUUID() }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const transactional: ShippingIdempotencyIntegration = {
    begin: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn(),
  };
  return { root, transactional };
}

/** Creates simple transaction-aware audit and outbox doubles used by fulfillment mutation tests. */
function evidenceDoubles() {
  const audit: ShippingAuditIntegration = {
    record: vi.fn().mockResolvedValue(randomUUID()),
  };
  const outbox: ShippingOutboxIntegration = {
    enqueue: vi.fn().mockResolvedValue(randomUUID()),
  };
  return { audit, outbox };
}

describe("Module 13 fulfillment service repair regressions", () => {
  it("rejects seller-scoped reads when no real authenticated actor exists", async () => {
    const repository = {
      listSellerShipments: vi.fn(),
    } as unknown as ShippingRepository;
    const context = sellerContext({ actorId: null });
    const service = new ShippingService({ repository });

    await expect(
      service.listSellerShipments(context, {
        page: 1,
        pageSize: 20,
        sort: "createdAt",
        order: "desc",
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.UNAUTHENTICATED, statusCode: 401 });
    expect(repository.listSellerShipments).not.toHaveBeenCalled();
  });

  it("rejects a fresh mark-shipped idempotency key when the Shipment is already shipped", async () => {
    const context = sellerContext();
    const shipment = shipmentRow(SHIPMENT_STATUS.SHIPPED);
    const repository = {
      findShipmentForUpdateInScope: vi.fn().mockResolvedValue(shipment),
    } as unknown as ShippingRepository;
    const { root, transactional } = idempotencyDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      idempotency: root,
      idempotencyUsingTransaction: () => transactional,
    });

    await expect(
      service.markShipmentShipped(context, shipment.id, "new-command-key"),
    ).rejects.toMatchObject({
      code: SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID,
      statusCode: 409,
    });
    expect(root.fail).toHaveBeenCalledTimes(1);
    expect(transactional.complete).not.toHaveBeenCalled();
  });

  it("rejects a fresh mark-delivered idempotency key when the Shipment is already delivered", async () => {
    const context = sellerContext();
    const shipment = shipmentRow(SHIPMENT_STATUS.DELIVERED);
    const repository = {
      findShipmentForUpdateInScope: vi.fn().mockResolvedValue(shipment),
    } as unknown as ShippingRepository;
    const { root, transactional } = idempotencyDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      idempotency: root,
      idempotencyUsingTransaction: () => transactional,
    });

    await expect(
      service.markShipmentDelivered(context, shipment.id, "new-delivery-key"),
    ).rejects.toMatchObject({
      code: SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID,
      statusCode: 409,
    });
    expect(root.fail).toHaveBeenCalledTimes(1);
    expect(transactional.complete).not.toHaveBeenCalled();
  });

  it("completes create-shipment idempotency inside the Shipment transaction", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const context = sellerContext({ sellerId, storeId });
    const sellerOrderId = randomUUID();
    const shipmentId = randomUUID();
    const orderItemId = randomUUID();
    const variantId = randomUUID();
    const reservationId = randomUUID();
    const createdAt = new Date("2026-09-15T04:30:00.000Z");
    const shipment = shipmentRow(SHIPMENT_STATUS.CREATED, {
      id: shipmentId,
      sellerOrderId,
      createdAt,
      updatedAt: createdAt,
    });
    const item = { shipmentId, orderItemId, quantity: 1 };
    const history = {
      id: randomUUID(),
      shipmentId,
      status: SHIPMENT_STATUS.CREATED,
      source: "seller_create",
      occurredAt: createdAt,
      payloadRef: null,
    };
    const snapshot = fulfillmentSnapshot({
      sellerOrderId,
      sellerId,
      storeId,
      orderItemId,
      variantId,
      reservationId,
    });
    const repository = {
      lockShipmentAllocations: vi.fn().mockResolvedValue(undefined),
      sumAllocatedQuantitiesInScope: vi.fn().mockResolvedValue([]),
      createShipmentInScope: vi.fn().mockResolvedValue(shipment),
      createShipmentItemsInScope: vi.fn().mockResolvedValue([item]),
      appendStatusHistoryInScope: vi.fn().mockResolvedValue(history),
    } as unknown as ShippingRepository;
    const orders: ShippingOrdersIntegration = {
      getShippingFulfillmentSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyShippingFulfillmentStatus: vi.fn(),
      customerOwnsOrder: vi.fn(),
      orderExists: vi.fn(),
    };
    const inventory: ShippingInventoryIntegration = {
      getShippingReservationSnapshot: vi.fn().mockResolvedValue({
        reservationId,
        variantId,
        remainingQuantity: 1,
        status: "committed",
      }),
      shipStock: vi.fn(),
    };
    const { root, transactional } = idempotencyDoubles();
    const { audit, outbox } = evidenceDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      ordersUsingTransaction: () => orders,
      inventoryUsingTransaction: () => inventory,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      idempotency: root,
      idempotencyUsingTransaction: () => transactional,
      now: () => createdAt,
      createId: () => shipmentId,
    });

    const result = await service.createShipment(
      context,
      sellerOrderId,
      { items: [{ orderItemId, quantity: 1 }] },
      "create-key",
    );

    expect(result.id).toBe(shipmentId);
    expect(transactional.complete).toHaveBeenCalledWith(
      expect.any(String),
      201,
      expect.objectContaining({ id: shipmentId }),
    );
    expect(root.complete).not.toHaveBeenCalled();
  });

  it("writes tracking audit evidence with the resolved seller ID", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const context = sellerContext({ sellerId, storeId });
    const original = shipmentRow(SHIPMENT_STATUS.CREATED);
    const updated = {
      ...original,
      carrier: "Carrier",
      trackingNo: "TRACK-2",
      serviceLevel: "Express",
    };
    const history = {
      id: randomUUID(),
      shipmentId: original.id,
      status: SHIPMENT_STATUS.CREATED,
      source: "seller_create",
      occurredAt: original.createdAt,
      payloadRef: null,
    };
    const item = { shipmentId: original.id, orderItemId: randomUUID(), quantity: 1 };
    const snapshot = fulfillmentSnapshot({
      sellerOrderId: original.sellerOrderId,
      sellerId,
      storeId,
      orderItemId: item.orderItemId,
    });
    const repository = {
      findShipmentForUpdateInScope: vi.fn().mockResolvedValue(original),
      updateTrackingInScope: vi.fn().mockResolvedValue(updated),
      listSellerShipmentItems: vi.fn().mockResolvedValue([item]),
      listSellerShipmentHistory: vi.fn().mockResolvedValue([history]),
    } as unknown as ShippingRepository;
    const orders: ShippingOrdersIntegration = {
      getShippingFulfillmentSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyShippingFulfillmentStatus: vi.fn(),
      customerOwnsOrder: vi.fn(),
      orderExists: vi.fn(),
    };
    const { audit, outbox } = evidenceDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      ordersUsingTransaction: () => orders,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
    });

    await service.updateShipmentTracking(context, original.id, {
      carrier: " Carrier ",
      trackingNo: " TRACK-2 ",
      serviceLevel: " Express ",
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId, entityId: original.id }),
    );
  });

  it("completes delivery idempotency inside the business transaction and audits the seller", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const context = sellerContext({ sellerId, storeId });
    const shipped = shipmentRow(SHIPMENT_STATUS.SHIPPED);
    const deliveredAt = new Date("2026-09-15T05:00:00.000Z");
    const delivered = {
      ...shipped,
      status: SHIPMENT_STATUS.DELIVERED,
      deliveredAt,
      updatedAt: deliveredAt,
    };
    const item = { shipmentId: shipped.id, orderItemId: randomUUID(), quantity: 1 };
    const history = {
      id: randomUUID(),
      shipmentId: shipped.id,
      status: SHIPMENT_STATUS.DELIVERED,
      source: "seller_mark_delivered",
      occurredAt: deliveredAt,
      payloadRef: null,
    };
    const snapshot = fulfillmentSnapshot({
      sellerOrderId: shipped.sellerOrderId,
      sellerId,
      storeId,
      orderItemId: item.orderItemId,
    });
    const repository = {
      findShipmentForUpdateInScope: vi.fn().mockResolvedValue(shipped),
      updateLifecycleInScope: vi.fn().mockResolvedValue(delivered),
      appendStatusHistoryInScope: vi.fn().mockResolvedValue(history),
      listSellerShipmentItems: vi.fn().mockResolvedValue([item]),
      listSellerShipmentHistory: vi.fn().mockResolvedValue([history]),
    } as unknown as ShippingRepository;
    const orders: ShippingOrdersIntegration = {
      getShippingFulfillmentSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyShippingFulfillmentStatus: vi.fn(),
      customerOwnsOrder: vi.fn(),
      orderExists: vi.fn(),
    };
    const { root, transactional } = idempotencyDoubles();
    const { audit, outbox } = evidenceDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      ordersUsingTransaction: () => orders,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      idempotency: root,
      idempotencyUsingTransaction: () => transactional,
      now: () => deliveredAt,
    });

    const result = await service.markShipmentDelivered(context, shipped.id, "delivery-key");

    expect(result.status).toBe(SHIPMENT_STATUS.DELIVERED);
    expect(transactional.complete).toHaveBeenCalledTimes(1);
    expect(root.complete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId, entityId: shipped.id }),
    );
  });

  it("serializes parent fulfillment reconciliation before summing issued quantity", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const context = sellerContext({ sellerId, storeId });
    const created = shipmentRow(SHIPMENT_STATUS.CREATED, {
      carrier: "Carrier",
      trackingNo: "TRACK-SHIP",
    });
    const shippedAt = new Date("2026-09-15T05:15:00.000Z");
    const shipped = {
      ...created,
      status: SHIPMENT_STATUS.SHIPPED,
      shippedAt,
      updatedAt: shippedAt,
    };
    const orderItemId = randomUUID();
    const variantId = randomUUID();
    const reservationId = randomUUID();
    const item = { shipmentId: created.id, orderItemId, quantity: 1 };
    const history = {
      id: randomUUID(),
      shipmentId: created.id,
      status: SHIPMENT_STATUS.SHIPPED,
      source: "seller_mark_shipped",
      occurredAt: shippedAt,
      payloadRef: null,
    };
    const snapshot = fulfillmentSnapshot({
      sellerOrderId: created.sellerOrderId,
      sellerId,
      storeId,
      orderItemId,
      variantId,
      reservationId,
    });
    const lockOrderFulfillmentCalculation = vi.fn().mockResolvedValue(undefined);
    const sumIssuedQuantityForOrder = vi.fn().mockResolvedValue(1);
    const repository = {
      findShipmentForUpdateInScope: vi.fn().mockResolvedValue(created),
      listSellerShipmentItems: vi.fn().mockResolvedValue([item]),
      listSellerShipmentHistory: vi.fn().mockResolvedValue([history]),
      updateLifecycleInScope: vi.fn().mockResolvedValue(shipped),
      appendStatusHistoryInScope: vi.fn().mockResolvedValue(history),
      lockOrderFulfillmentCalculation,
      sumIssuedQuantityForOrder,
    } as unknown as ShippingRepository;
    const applyShippingFulfillmentStatus = vi.fn().mockResolvedValue("fulfilled");
    const orders: ShippingOrdersIntegration = {
      getShippingFulfillmentSnapshot: vi.fn().mockResolvedValue(snapshot),
      applyShippingFulfillmentStatus,
      customerOwnsOrder: vi.fn(),
      orderExists: vi.fn(),
    };
    const inventory: ShippingInventoryIntegration = {
      getShippingReservationSnapshot: vi.fn().mockResolvedValue({
        reservationId,
        variantId,
        remainingQuantity: 1,
        status: "committed",
      }),
      shipStock: vi.fn().mockResolvedValue(undefined),
    };
    const { root, transactional } = idempotencyDoubles();
    const { audit, outbox } = evidenceDoubles();
    const transaction = {} as DatabaseTransaction;
    const service = new ShippingService({
      repository,
      repositoryUsingTransaction: () => repository,
      transactionRunner: async (work) => work(transaction),
      ordersUsingTransaction: () => orders,
      inventoryUsingTransaction: () => inventory,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      idempotency: root,
      idempotencyUsingTransaction: () => transactional,
      now: () => shippedAt,
    });

    await service.markShipmentShipped(context, created.id, "ship-key");

    expect(lockOrderFulfillmentCalculation).toHaveBeenCalledWith(snapshot.orderId);
    expect(sumIssuedQuantityForOrder).toHaveBeenCalledWith(snapshot.orderId);
    expect(applyShippingFulfillmentStatus).toHaveBeenCalledWith(snapshot.orderId, 1);
    expect(lockOrderFulfillmentCalculation.mock.invocationCallOrder[0]).toBeLessThan(
      sumIssuedQuantityForOrder.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(sumIssuedQuantityForOrder.mock.invocationCallOrder[0]).toBeLessThan(
      applyShippingFulfillmentStatus.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(transactional.complete).toHaveBeenCalledTimes(1);
    expect(root.complete).not.toHaveBeenCalled();
  });
});


import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import { OrdersRepository } from "../../src/modules/orders/orders.repository.js";
import {
  addCartItemViaHttp,
  confirmCheckoutQuoteViaHttp,
  createAddressViaHttp,
  createCheckoutQuoteViaHttp,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  insertShippingMethod,
  loginUser,
  registerCustomer,
  resetModule10Tables,
} from "../module10/module10.test-helpers.js";

/** Formats the immutable Customer Order number required by the Pass 0/1 database contract. */
function orderNumber(id: string): string {
  return `ORD-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Formats the immutable Seller Order number required by the Pass 0/1 database contract. */
function sellerOrderNumber(id: string): string {
  return `SOR-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Creates the smallest released Checkout attempt needed to exercise the Orders repository against real foreign keys. */
async function prepareConfirmedCheckout() {
  const admin = await createPlatformAdmin(`module11-repo-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const product = await createPublishedCartWishlistFixture(adminToken, "OrdersRepo", {
    currency: "PKR",
    price: "100.00",
    onHandQty: 10,
  });
  const customer = await registerCustomer(`module11-repo-customer-${randomUUID()}@example.com`);
  const customerToken = await loginUser(customer);
  const address = await createAddressViaHttp(customerToken, {
    isDefaultShipping: true,
    isDefaultBilling: true,
  });
  await addCartItemViaHttp(customerToken, product.variant.id, 2);
  const shippingMethod = await insertShippingMethod({
    ownerType: "seller",
    sellerId: product.seller.sellerId,
    code: `ORDERS-${randomUUID()}`,
    name: "Orders Standard",
    baseRate: "12.5000",
    currency: "PKR",
    status: "active",
  });
  const quote = await createCheckoutQuoteViaHttp(customerToken, {
    shippingAddressId: address.id,
    shippingSelections: [
      {
        storeId: product.seller.storeId,
        shippingMethodId: shippingMethod.id,
      },
    ],
  });
  const attempt = await confirmCheckoutQuoteViaHttp(
    customerToken,
    quote.id,
    quote.stateHash,
    `module11-repo-${randomUUID()}`,
  );
  const reservationResult = await databasePool.query<{ id: string }>(
    "select id from stock_reservations where order_attempt_id = $1 and variant_id = $2",
    [attempt.id, product.variant.id],
  );
  const reservationId = reservationResult.rows[0]?.id;
  if (!reservationId) throw new Error("Confirmed Checkout did not create the expected Inventory reservation.");

  return {
    customer,
    address,
    product,
    shippingMethod,
    quote,
    attempt,
    reservationId,
  };
}

beforeEach(async () => {
  await resetModule10Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 11 Orders repository boundaries", () => {
  it("persists immutable Order snapshots and keeps customer/seller reads scoped", async () => {
    const fixture = await prepareConfirmedCheckout();
    const otherCustomer = await registerCustomer(`module11-repo-other-${randomUUID()}@example.com`);
    const repository = new OrdersRepository();
    const orderId = randomUUID();
    const sellerOrderId = randomUUID();
    const line = fixture.quote.lines[0];
    if (!line) throw new Error("Checkout quote did not contain the expected line.");

    const order = await repository.createOrder({
      id: orderId,
      orderNo: orderNumber(orderId),
      checkoutAttemptId: fixture.attempt.id,
      customerUserId: fixture.customer.id,
      currency: fixture.quote.currency,
      subtotal: fixture.quote.subtotal,
      discountTotal: fixture.quote.discountTotal,
      taxTotal: fixture.quote.taxTotal,
      shippingTotal: fixture.quote.shippingTotal,
      grandTotal: fixture.quote.grandTotal,
      paymentStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      orderStatus: "pending_payment",
    });
    await repository.createSellerOrders([
      {
        id: sellerOrderId,
        orderId,
        sellerId: fixture.product.seller.sellerId,
        storeId: fixture.product.seller.storeId,
        sellerOrderNo: sellerOrderNumber(sellerOrderId),
        subtotal: fixture.quote.subtotal,
        discountTotal: fixture.quote.discountTotal,
        taxTotal: fixture.quote.taxTotal,
        shippingTotal: fixture.quote.shippingTotal,
        grandTotal: fixture.quote.grandTotal,
        status: "pending_payment",
        shippingMethodId: fixture.shippingMethod.id,
        shippingMethodCodeSnapshot: fixture.shippingMethod.code,
        shippingMethodNameSnapshot: fixture.shippingMethod.name,
      },
    ]);
    const [item] = await repository.createOrderItems([
      {
        id: randomUUID(),
        orderId,
        sellerOrderId,
        productId: fixture.product.product.id,
        variantId: fixture.product.variant.id,
        inventoryReservationId: fixture.reservationId,
        skuSnapshot: fixture.product.variant.sku,
        nameSnapshot: fixture.product.product.name,
        variantTitleSnapshot: fixture.product.variant.title,
        qty: line.quantity,
        unitPrice: line.unitPrice,
        discountAllocated: line.discount,
        taxAllocated: line.tax,
        lineTotal: line.lineTotal,
        status: "active",
      },
    ]);
    await repository.createOrderAddresses([
      {
        orderId,
        type: "shipping",
        sourceAddressId: String(fixture.address.id),
        recipientName: String(fixture.address.recipientName),
        phone: String(fixture.address.phone),
        line1: String(fixture.address.line1),
        line2: fixture.address.line2 ? String(fixture.address.line2) : null,
        city: String(fixture.address.city),
        region: String(fixture.address.region),
        postalCode: fixture.address.postalCode ? String(fixture.address.postalCode) : null,
        countryCode: String(fixture.address.countryCode),
      },
      {
        orderId,
        type: "billing",
        sourceAddressId: String(fixture.address.id),
        recipientName: String(fixture.address.recipientName),
        phone: String(fixture.address.phone),
        line1: String(fixture.address.line1),
        line2: fixture.address.line2 ? String(fixture.address.line2) : null,
        city: String(fixture.address.city),
        region: String(fixture.address.region),
        postalCode: fixture.address.postalCode ? String(fixture.address.postalCode) : null,
        countryCode: String(fixture.address.countryCode),
      },
    ]);
    await repository.createStatusHistory([
      {
        orderId,
        toStatus: "pending_payment",
      },
      {
        sellerOrderId,
        toStatus: "pending_payment",
      },
    ]);

    await expect(repository.findOrderByCheckoutAttemptId(fixture.attempt.id)).resolves.toMatchObject({
      id: order.id,
      checkoutAttemptId: fixture.attempt.id,
    });
    await expect(repository.findOrderForCustomer(orderId, fixture.customer.id)).resolves.toMatchObject({
      id: orderId,
    });
    await expect(repository.findOrderForCustomer(orderId, otherCustomer.id)).resolves.toBeNull();

    const customerList = await repository.listOrdersForCustomer(fixture.customer.id, {
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
    });
    expect(customerList.items.map((row) => row.id)).toEqual([orderId]);
    await expect(repository.listCustomerOrderSellerOrders([orderId])).resolves.toEqual([
      expect.objectContaining({
        orderId,
        sellerOrderId,
        storeId: fixture.product.seller.storeId,
        storeName: expect.any(String),
      }),
    ]);
    await expect(repository.listCustomerOrderItemPreviews([orderId])).resolves.toEqual([
      expect.objectContaining({
        orderId,
        sellerOrderId,
        orderItemId: item?.id,
        name: fixture.product.product.name,
      }),
    ]);
    await expect(repository.listCustomerOrderVisibleShipments([orderId])).resolves.toEqual([]);

    const sellerScope = {
      sellerIds: [fixture.product.seller.sellerId],
      storeIds: [fixture.product.seller.storeId],
    };
    await expect(repository.findSellerOrderInScope(sellerOrderId, sellerScope)).resolves.toMatchObject({
      sellerOrder: { id: sellerOrderId },
      order: { id: orderId },
    });
    await expect(
      repository.findSellerOrderInScope(sellerOrderId, {
        sellerIds: [randomUUID()],
        storeIds: [randomUUID()],
      }),
    ).resolves.toBeNull();

    const sellerList = await repository.listSellerOrdersInScope(sellerScope, {
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
    });
    expect(sellerList.items.map((row) => row.sellerOrder.id)).toEqual([sellerOrderId]);
    expect(sellerList.items[0]?.fulfillment).toEqual({
      commercialQuantity: line.quantity,
      allocatedQuantity: 0,
      deliveredQuantity: 0,
      hasCreatedShipment: false,
      hasShippedShipment: false,
    });
    await expect(repository.getSellerOrderFulfillmentMetricsInScope(sellerOrderId, sellerScope)).resolves.toEqual(
      sellerList.items[0]?.fulfillment,
    );

    await expect(repository.listOrderItemsByOrderId(orderId)).resolves.toEqual([
      expect.objectContaining({ id: item?.id, inventoryReservationId: fixture.reservationId }),
    ]);
    await expect(repository.listOrderAddressesByOrderId(orderId)).resolves.toHaveLength(2);
    await expect(repository.listOrderStatusHistory(orderId)).resolves.toHaveLength(1);
    await expect(repository.listSellerOrderStatusHistoryInScope(sellerOrderId, sellerScope)).resolves.toHaveLength(1);
  });

  it("lists only overdue linked Orders that match the Payments maintenance state filter", async () => {
    const fixture = await prepareConfirmedCheckout();
    const repository = new OrdersRepository();
    const orderId = randomUUID();

    await repository.createOrder({
      id: orderId,
      orderNo: orderNumber(orderId),
      checkoutAttemptId: fixture.attempt.id,
      customerUserId: fixture.customer.id,
      currency: fixture.quote.currency,
      subtotal: fixture.quote.subtotal,
      discountTotal: fixture.quote.discountTotal,
      taxTotal: fixture.quote.taxTotal,
      shippingTotal: fixture.quote.shippingTotal,
      grandTotal: fixture.quote.grandTotal,
      paymentStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      orderStatus: "pending_payment",
    });
    await databasePool.query(
      "update checkout_attempts set order_id = $1 where id = $2",
      [orderId, fixture.attempt.id],
    );

    const candidates = await repository.listOverduePaymentOrderCandidates({
      expiredBefore: new Date("2099-01-01T00:00:00.000Z"),
      paymentStatuses: ["pending"],
      orderStatuses: ["pending_payment"],
      limit: 20,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.order.id).toBe(orderId);
    expect(candidates[0]?.paymentExpiresAt).toBeInstanceOf(Date);

    await repository.markOrderPaymentCaptured(orderId, new Date());
    await expect(
      repository.listOverduePaymentOrderCandidates({
        expiredBefore: new Date("2099-01-01T00:00:00.000Z"),
        paymentStatuses: ["pending"],
        orderStatuses: ["pending_payment"],
        limit: 20,
      }),
    ).resolves.toEqual([]);
  });

  it("supports source lookup, row locks, admin filtering, and service-approved lifecycle writes", async () => {
    const fixture = await prepareConfirmedCheckout();
    const repository = new OrdersRepository();
    const orderId = randomUUID();
    const sellerOrderId = randomUUID();

    await repository.createOrder({
      id: orderId,
      orderNo: orderNumber(orderId),
      checkoutAttemptId: fixture.attempt.id,
      customerUserId: fixture.customer.id,
      currency: fixture.quote.currency,
      subtotal: fixture.quote.subtotal,
      discountTotal: fixture.quote.discountTotal,
      taxTotal: fixture.quote.taxTotal,
      shippingTotal: fixture.quote.shippingTotal,
      grandTotal: fixture.quote.grandTotal,
      paymentStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      orderStatus: "pending_payment",
    });
    await repository.createSellerOrders([
      {
        id: sellerOrderId,
        orderId,
        sellerId: fixture.product.seller.sellerId,
        storeId: fixture.product.seller.storeId,
        sellerOrderNo: sellerOrderNumber(sellerOrderId),
        subtotal: fixture.quote.subtotal,
        discountTotal: fixture.quote.discountTotal,
        taxTotal: fixture.quote.taxTotal,
        shippingTotal: fixture.quote.shippingTotal,
        grandTotal: fixture.quote.grandTotal,
        status: "pending_payment",
        shippingMethodId: fixture.shippingMethod.id,
        shippingMethodCodeSnapshot: fixture.shippingMethod.code,
        shippingMethodNameSnapshot: fixture.shippingMethod.name,
      },
    ]);
    const [item] = await repository.createOrderItems([
      {
        id: randomUUID(),
        orderId,
        sellerOrderId,
        productId: fixture.product.product.id,
        variantId: fixture.product.variant.id,
        inventoryReservationId: fixture.reservationId,
        skuSnapshot: fixture.product.variant.sku,
        nameSnapshot: fixture.product.product.name,
        variantTitleSnapshot: fixture.product.variant.title,
        qty: 2,
        unitPrice: fixture.quote.lines[0]?.unitPrice ?? "100.0000",
        discountAllocated: "0.0000",
        taxAllocated: "0.0000",
        lineTotal: "200.0000",
        status: "active",
      },
    ]);
    const sourceKey = `payments:${randomUUID()}`;
    await repository.createStatusHistory([
      {
        orderId,
        fromStatus: "pending_payment",
        toStatus: "confirmed",
        sourceType: "payment_confirmed",
        sourceKey,
      },
    ]);

    const locked = await db.transaction(async (transaction) => {
      const transactionalRepository = new OrdersRepository(transaction);
      const parent = await transactionalRepository.lockOrderById(orderId);
      const items = await transactionalRepository.lockOrderItemsByOrderId(orderId);
      const seller = await transactionalRepository.lockSellerOrderInScope(sellerOrderId, {
        sellerIds: [fixture.product.seller.sellerId],
        storeIds: [fixture.product.seller.storeId],
      });
      return { parent, items, seller };
    });
    expect(locked.parent?.id).toBe(orderId);
    expect(locked.items.map((row) => row.id)).toEqual([item?.id]);
    expect(locked.seller?.sellerOrder.id).toBe(sellerOrderId);

    await expect(repository.findStatusHistoryBySource("payment_confirmed", sourceKey)).resolves.toMatchObject({
      orderId,
      sourceKey,
    });

    const capturedAt = new Date();
    await expect(repository.markOrderPaymentCaptured(orderId, capturedAt)).resolves.toMatchObject({
      paymentStatus: "captured",
    });
    await expect(repository.updateDerivedOrderStatus(orderId, "confirmed")).resolves.toMatchObject({
      orderStatus: "confirmed",
    });
    await expect(repository.updateSellerOrderStatus(sellerOrderId, "pending_acceptance")).resolves.toMatchObject({
      status: "pending_acceptance",
    });
    await expect(repository.updateOrderItemCancellation(item?.id ?? "", 1, "partially_cancelled")).resolves.toMatchObject({
      cancelledQty: 1,
      status: "partially_cancelled",
    });

    const adminList = await repository.listAdminOrders({
      page: 1,
      pageSize: 20,
      sellerId: fixture.product.seller.sellerId,
      storeId: fixture.product.seller.storeId,
      paymentStatus: "captured",
      sort: "orderNo",
      order: "asc",
    });
    expect(adminList.items.map((row) => row.id)).toEqual([orderId]);

    const duplicateOrderId = randomUUID();
    await expect(
      repository.createOrder({
        id: duplicateOrderId,
        orderNo: orderNumber(duplicateOrderId),
        checkoutAttemptId: fixture.attempt.id,
        customerUserId: fixture.customer.id,
        currency: fixture.quote.currency,
        subtotal: fixture.quote.subtotal,
        discountTotal: fixture.quote.discountTotal,
        taxTotal: fixture.quote.taxTotal,
        shippingTotal: fixture.quote.shippingTotal,
        grandTotal: fixture.quote.grandTotal,
        paymentStatus: "pending",
        fulfillmentStatus: "unfulfilled",
        orderStatus: "pending_payment",
      }),
    ).rejects.toThrow();
  });
});

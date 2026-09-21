import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { CUSTOMER_ERROR_CODE } from "../../src/modules/customers/customers.constants.js";
import {
  SHIPPING_AUDIT_ACTION,
  SHIPPING_ERROR_CODE,
  SHIPPING_OUTBOX_EVENT,
} from "../../src/modules/shipping/shipping.constants.js";
import {
  prepareOrderFixture,
  getCustomerOrderViaHttp,
  readInventoryQuantities,
} from "../module11/module11.test-helpers.js";
import { prepareFulfillmentFixture } from "./module13.fulfillment-test-helpers.js";
import {
  addCartItemViaHttp,
  bearer,
  createAddressViaHttp,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  insertShippingMethod,
  loginUser,
  registerCustomer,
  resetModule13Tables,
  createShipmentViaHttp,
  updateShipmentTrackingViaHttp,
  markShipmentShippedViaHttp,
  markShipmentDeliveredViaHttp,
  getOrderShipmentsViaHttp,
  countShippingAuditEvents,
  countShippingOutboxEvents,
  countShipmentInventoryMovements,
  countShipmentHistory,
  readOrderFulfillmentStatus,
} from "./module13.test-helpers.js";

beforeEach(async () => {
  await resetModule13Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 13 Shipping Configuration Core API integration", () => {
  it("publishes exactly the authenticated grouped flat-rate lookup with seller isolation", async () => {
    const admin = await createPlatformAdmin(
      `module13-api-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const productA = await createPublishedCartWishlistFixture(
      adminToken,
      "ShippingApiA",
      { currency: "PKR", price: "100.00", onHandQty: 10 },
    );
    const productB = await createPublishedCartWishlistFixture(
      adminToken,
      "ShippingApiB",
      { currency: "PKR", price: "50.00", onHandQty: 10 },
    );
    const customer = await registerCustomer(
      `module13-api-customer-${randomUUID()}@example.com`,
    );
    const customerToken = await loginUser(customer);
    const address = await createAddressViaHttp(customerToken);
    const addressId = String(address.id);

    await addCartItemViaHttp(customerToken, productA.variant.id, 1);
    await addCartItemViaHttp(customerToken, productB.variant.id, 2);

    await insertShippingMethod({
      ownerType: "platform",
      sellerId: null,
      code: "PLATFORM-STANDARD",
      name: "Platform Standard",
      baseRate: "12.0000",
      currency: "PKR",
      status: "active",
    });
    await insertShippingMethod({
      ownerType: "seller",
      sellerId: productA.seller.sellerId,
      code: "SELLER-A",
      name: "Seller A Shipping",
      baseRate: "7.0000",
      currency: "PKR",
      status: "active",
    });
    await insertShippingMethod({
      ownerType: "seller",
      sellerId: productB.seller.sellerId,
      code: "SELLER-B",
      name: "Seller B Shipping",
      baseRate: "8.0000",
      currency: "PKR",
      status: "active",
    });
    await insertShippingMethod({
      ownerType: "seller",
      sellerId: productA.seller.sellerId,
      code: "SELLER-A-INACTIVE",
      currency: "PKR",
      status: "inactive",
    });
    await insertShippingMethod({
      ownerType: "platform",
      sellerId: null,
      code: "USD-ONLY",
      currency: "USD",
      status: "active",
    });

    const response = await request(createApp())
      .get("/api/v1/checkout/shipping-options")
      .query({ addressId })
      .set(bearer(customerToken))
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: { addressId, currency: "PKR" },
      requestId: expect.any(String),
    });
    expect(response.body.data.groups).toHaveLength(2);
    expect(
      response.body.data.groups.map((group: { storeId: string }) => group.storeId),
    ).toEqual(
      [productA.seller.storeId, productB.seller.storeId].sort((left, right) =>
        left.localeCompare(right),
      ),
    );

    for (const group of response.body.data.groups as Array<{
      sellerId: string;
      options: Array<{ code: string }>;
    }>) {
      expect(group.options.map((option) => option.code)).toContain("PLATFORM-STANDARD");
      expect(group.options.map((option) => option.code)).not.toContain("USD-ONLY");
      expect(group.options.map((option) => option.code)).not.toContain(
        "SELLER-A-INACTIVE",
      );

      if (group.sellerId === productA.seller.sellerId) {
        expect(group.options.map((option) => option.code)).toContain("SELLER-A");
        expect(group.options.map((option) => option.code)).not.toContain("SELLER-B");
      } else {
        expect(group.options.map((option) => option.code)).toContain("SELLER-B");
        expect(group.options.map((option) => option.code)).not.toContain("SELLER-A");
      }
    }
  });

  it("requires authentication and rejects extra client-owned scope fields", async () => {
    const app = createApp();
    await request(app)
      .get("/api/v1/checkout/shipping-options")
      .query({ addressId: randomUUID() })
      .expect(401)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
      });

    const customer = await registerCustomer(
      `module13-query-customer-${randomUUID()}@example.com`,
    );
    const customerToken = await loginUser(customer);
    const address = await createAddressViaHttp(customerToken);

    const invalid = await request(createApp())
      .get("/api/v1/checkout/shipping-options")
      .query({ addressId: String(address.id), sellerId: randomUUID() })
      .set(bearer(customerToken))
      .expect(422);
    expect(invalid.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("does not allow one customer to use another customer's address", async () => {
    const customerA = await registerCustomer(
      `module13-address-a-${randomUUID()}@example.com`,
    );
    const customerB = await registerCustomer(
      `module13-address-b-${randomUUID()}@example.com`,
    );
    const tokenA = await loginUser(customerA);
    const tokenB = await loginUser(customerB);
    const addressA = await createAddressViaHttp(tokenA);

    const response = await request(createApp())
      .get("/api/v1/checkout/shipping-options")
      .query({ addressId: String(addressA.id) })
      .set(bearer(tokenB))
      .expect(404);

    expect(response.body.error.code).toBe(CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND);
  });
});


describe("Module 13 Shipping fulfillment PostgreSQL regression", () => {
  it("runs create -> tracking -> shipped -> delivered exactly once with immutable evidence and customer tracking", async () => {
    const fixture = await prepareFulfillmentFixture(2);
    const createKey = `module13-create-${randomUUID()}`;
    const shipment = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 2 }],
      createKey,
    );
    const replay = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 2 }],
      createKey,
    );

    expect(replay).toEqual(shipment);
    expect(await countShipmentHistory(shipment.id, "created")).toBe(1);
    expect(await countShippingAuditEvents(SHIPPING_AUDIT_ACTION.CREATED, shipment.id)).toBe(1);
    expect(await countShippingOutboxEvents(SHIPPING_OUTBOX_EVENT.CREATED, shipment.id)).toBe(1);

    const tracked = await updateShipmentTrackingViaHttp(fixture.sellerToken, shipment.id, {
      carrier: "  Module 13 Carrier  ",
      trackingNo: "  TRACK-EXACT-1  ",
      serviceLevel: "  Express  ",
    });
    expect(tracked).toMatchObject({
      carrier: "Module 13 Carrier",
      trackingNo: "TRACK-EXACT-1",
      serviceLevel: "Express",
      status: "created",
    });

    const trackingAuditBeforeReplay = await countShippingAuditEvents(
      SHIPPING_AUDIT_ACTION.TRACKING_UPDATED,
      shipment.id,
    );
    const trackingOutboxBeforeReplay = await countShippingOutboxEvents(
      SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED,
      shipment.id,
    );
    const trackingReplay = await updateShipmentTrackingViaHttp(fixture.sellerToken, shipment.id, {
      carrier: "Module 13 Carrier",
      trackingNo: "TRACK-EXACT-1",
      serviceLevel: "Express",
    });
    expect(trackingReplay).toEqual(tracked);
    expect(
      await countShippingAuditEvents(SHIPPING_AUDIT_ACTION.TRACKING_UPDATED, shipment.id),
    ).toBe(trackingAuditBeforeReplay);
    expect(
      await countShippingOutboxEvents(SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED, shipment.id),
    ).toBe(trackingOutboxBeforeReplay);

    const shipKey = `module13-ship-${randomUUID()}`;
    const shipped = await markShipmentShippedViaHttp(
      fixture.sellerToken,
      shipment.id,
      shipKey,
    );
    const shippedReplay = await markShipmentShippedViaHttp(
      fixture.sellerToken,
      shipment.id,
      shipKey,
    );
    expect(shippedReplay).toEqual(shipped);
    expect(shipped.status).toBe("shipped");
    expect(await countShipmentInventoryMovements(shipment.id)).toBe(1);
    expect(await countShipmentHistory(shipment.id, "shipped")).toBe(1);
    expect(await countShippingAuditEvents(SHIPPING_AUDIT_ACTION.SHIPPED, shipment.id)).toBe(1);
    expect(await countShippingOutboxEvents(SHIPPING_OUTBOX_EVENT.SHIPPED, shipment.id)).toBe(1);
    expect(await readOrderFulfillmentStatus(fixture.orderId)).toBe("fulfilled");
    expect(await readInventoryQuantities(fixture.variantId)).toMatchObject({
      onHandQty: 18,
      reservedQty: 0,
      availableQty: 18,
    });

    const correctedTracking = await updateShipmentTrackingViaHttp(
      fixture.sellerToken,
      shipment.id,
      {
        carrier: "Module 13 Carrier",
        trackingNo: "TRACK-EXACT-2",
        serviceLevel: "Express",
      },
    );
    expect(correctedTracking).toMatchObject({
      status: "shipped",
      trackingNo: "TRACK-EXACT-2",
    });
    expect(
      await countShippingAuditEvents(SHIPPING_AUDIT_ACTION.TRACKING_UPDATED, shipment.id),
    ).toBe(2);

    const freshShipKey = await request(createApp())
      .post(`/api/v1/seller/shipments/${shipment.id}/mark-shipped`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-ship-fresh-${randomUUID()}`)
      .send({})
      .expect(409);
    expect(freshShipKey.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID);

    const deliverKey = `module13-deliver-${randomUUID()}`;
    const delivered = await markShipmentDeliveredViaHttp(
      fixture.sellerToken,
      shipment.id,
      deliverKey,
    );
    const deliveredReplay = await markShipmentDeliveredViaHttp(
      fixture.sellerToken,
      shipment.id,
      deliverKey,
    );
    expect(deliveredReplay).toEqual(delivered);
    expect(delivered.status).toBe("delivered");
    expect(await countShipmentHistory(shipment.id, "delivered")).toBe(1);
    expect(await countShippingAuditEvents(SHIPPING_AUDIT_ACTION.DELIVERED, shipment.id)).toBe(1);
    expect(await countShippingOutboxEvents(SHIPPING_OUTBOX_EVENT.DELIVERED, shipment.id)).toBe(1);

    const immutableTracking = await request(createApp())
      .patch(`/api/v1/seller/shipments/${shipment.id}/tracking`)
      .set(bearer(fixture.sellerToken))
      .send({ carrier: "Changed Carrier", trackingNo: "TRACK-AFTER-DELIVERY" })
      .expect(409);
    expect(immutableTracking.body.error.code).toBe(SHIPPING_ERROR_CODE.TRACKING_INVALID);

    const freshDeliverKey = await request(createApp())
      .post(`/api/v1/seller/shipments/${shipment.id}/mark-delivered`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-deliver-fresh-${randomUUID()}`)
      .send({})
      .expect(409);
    expect(freshDeliverKey.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID);

    const customerTracking = await getOrderShipmentsViaHttp(
      fixture.customerToken,
      fixture.orderId,
    );
    expect(customerTracking).toHaveLength(1);
    expect(customerTracking[0]).toMatchObject({
      id: shipment.id,
      status: "delivered",
      carrier: "Module 13 Carrier",
      trackingNo: "TRACK-EXACT-2",
    });
    const finalOrder = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    expect(finalOrder.paymentStatus).toBe("captured");
  });

  it("projects seller operational queues from authoritative Shipment allocation and lifecycle state", async () => {
    const fixture = await prepareFulfillmentFixture(2);

    const unfulfilled = await request(createApp())
      .get("/api/v1/seller/orders")
      .query({ queue: "unfulfilled" })
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(unfulfilled.body.data).toEqual([
      expect.objectContaining({
        id: fixture.sellerOrderId,
        fulfillmentStage: "unfulfilled",
      }),
    ]);

    const needsAction = await request(createApp())
      .get("/api/v1/seller/orders")
      .query({ queue: "needs_action" })
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(needsAction.body.data).toHaveLength(1);

    const shipment = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 2 }],
    );

    const ready = await request(createApp())
      .get("/api/v1/seller/orders")
      .query({ queue: "ready_to_ship" })
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(ready.body.data).toEqual([
      expect.objectContaining({
        id: fixture.sellerOrderId,
        fulfillmentStage: "ready_to_ship",
      }),
    ]);

    await updateShipmentTrackingViaHttp(fixture.sellerToken, shipment.id, {
      carrier: "Queue Carrier",
      trackingNo: "QUEUE-TRACK-1",
    });
    await markShipmentShippedViaHttp(fixture.sellerToken, shipment.id);

    const shipped = await request(createApp())
      .get("/api/v1/seller/orders")
      .query({ queue: "shipped" })
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(shipped.body.data).toEqual([
      expect.objectContaining({
        id: fixture.sellerOrderId,
        fulfillmentStage: "shipped",
      }),
    ]);

    await markShipmentDeliveredViaHttp(fixture.sellerToken, shipment.id);

    const delivered = await request(createApp())
      .get("/api/v1/seller/orders")
      .query({ queue: "delivered" })
      .set(bearer(fixture.sellerToken))
      .expect(200);
    expect(delivered.body.data).toEqual([
      expect.objectContaining({
        id: fixture.sellerOrderId,
        fulfillmentStage: "delivered",
      }),
    ]);
  });

  it("rejects pre-capture fulfillment, idempotency payload conflicts, and over-allocation", async () => {
    const unpaid = await prepareOrderFixture({ sellerCount: 1, quantities: [2] });
    const unpaidOrder = await getCustomerOrderViaHttp(unpaid.customerToken, unpaid.orderId);
    const unpaidSellerOrder = unpaidOrder.sellerOrders[0]!;
    const unpaidItem = unpaidSellerOrder.items[0]!;
    const unpaidSellerToken = unpaid.sellers[0]!.product.seller.ownerToken;

    const preCapture = await request(createApp())
      .post(`/api/v1/seller/orders/${unpaidSellerOrder.id}/shipments`)
      .set(bearer(unpaidSellerToken))
      .set("Idempotency-Key", `module13-pre-capture-${randomUUID()}`)
      .send({ items: [{ orderItemId: unpaidItem.id, quantity: 1 }] })
      .expect(409);
    expect(preCapture.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID);

    const fixture = await prepareFulfillmentFixture(2);
    const key = `module13-create-conflict-${randomUUID()}`;
    await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 1 }],
      key,
    );

    const idempotencyConflict = await request(createApp())
      .post(`/api/v1/seller/orders/${fixture.sellerOrderId}/shipments`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", key)
      .send({ items: [{ orderItemId: fixture.orderItemId, quantity: 2 }] })
      .expect(409);
    expect(idempotencyConflict.body.error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);

    const overAllocation = await request(createApp())
      .post(`/api/v1/seller/orders/${fixture.sellerOrderId}/shipments`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-over-allocate-${randomUUID()}`)
      .send({ items: [{ orderItemId: fixture.orderItemId, quantity: 2 }] })
      .expect(409);
    expect(overAllocation.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_QUANTITY_INVALID);
  });

  it("rolls back mark-shipped when the committed Inventory prerequisite becomes invalid", async () => {
    const fixture = await prepareFulfillmentFixture(1);
    const shipment = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    );
    await updateShipmentTrackingViaHttp(fixture.sellerToken, shipment.id, {
      carrier: "Rollback Carrier",
      trackingNo: "ROLLBACK-1",
    });

    await databasePool.query(
      `update stock_reservations
          set status = 'released'
        where id = (
          select inventory_reservation_id from order_items where id = $1
        )`,
      [fixture.orderItemId],
    );

    const failed = await request(createApp())
      .post(`/api/v1/seller/shipments/${shipment.id}/mark-shipped`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-inventory-fail-${randomUUID()}`)
      .send({})
      .expect(409);
    expect(failed.body.error.code).toBe(SHIPPING_ERROR_CODE.INVENTORY_ISSUE_FAILED);

    const persisted = await databasePool.query<{ status: string; shipped_at: Date | null }>(
      `select status, shipped_at from shipments where id = $1`,
      [shipment.id],
    );
    expect(persisted.rows[0]).toMatchObject({ status: "created", shipped_at: null });
    expect(await countShipmentInventoryMovements(shipment.id)).toBe(0);
    expect(await countShipmentHistory(shipment.id, "shipped")).toBe(0);
    expect(await countShippingOutboxEvents(SHIPPING_OUTBOX_EVENT.SHIPPED, shipment.id)).toBe(0);
  });

  it("serializes concurrent Shipment allocation so the same commercial quantity cannot be allocated twice", async () => {
    const fixture = await prepareFulfillmentFixture(1);

    // Builds one concurrent create request so the allocation race remains easy to read.
    const createRequest = (suffix: string) =>
      request(createApp())
        .post(`/api/v1/seller/orders/${fixture.sellerOrderId}/shipments`)
        .set(bearer(fixture.sellerToken))
        .set("Idempotency-Key", `module13-concurrent-create-${suffix}-${randomUUID()}`)
        .send({ items: [{ orderItemId: fixture.orderItemId, quantity: 1 }] });

    const [first, second] = await Promise.all([createRequest("a"), createRequest("b")]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_QUANTITY_INVALID);

    const rows = await databasePool.query<{ count: number }>(
      `select count(*)::int as count from shipments where seller_order_id = $1`,
      [fixture.sellerOrderId],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("serializes concurrent Shipment issue so two partial Shipments reconcile the parent Order to fulfilled", async () => {
    const fixture = await prepareFulfillmentFixture(2);
    const first = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    );
    const second = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    );
    await updateShipmentTrackingViaHttp(fixture.sellerToken, first.id, {
      carrier: "Concurrent Carrier",
      trackingNo: "CONCURRENT-1",
    });
    await updateShipmentTrackingViaHttp(fixture.sellerToken, second.id, {
      carrier: "Concurrent Carrier",
      trackingNo: "CONCURRENT-2",
    });

    const [firstResult, secondResult] = await Promise.all([
      markShipmentShippedViaHttp(
        fixture.sellerToken,
        first.id,
        `module13-concurrent-ship-a-${randomUUID()}`,
      ),
      markShipmentShippedViaHttp(
        fixture.sellerToken,
        second.id,
        `module13-concurrent-ship-b-${randomUUID()}`,
      ),
    ]);

    expect(firstResult.status).toBe("shipped");
    expect(secondResult.status).toBe("shipped");
    expect(await countShipmentInventoryMovements(first.id)).toBe(1);
    expect(await countShipmentInventoryMovements(second.id)).toBe(1);
    expect(await readOrderFulfillmentStatus(fixture.orderId)).toBe("fulfilled");
  });
});

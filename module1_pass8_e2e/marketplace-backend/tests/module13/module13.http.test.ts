import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import { SHIPPING_ERROR_CODE } from "../../src/modules/shipping/shipping.constants.js";
import { prepareFulfillmentFixture } from "./module13.fulfillment-test-helpers.js";
import {
  bearer,
  createShipmentViaHttp,
  getOrderShipmentsViaHttp,
  listSellerShipmentsViaHttp,
  markShipmentShippedViaHttp,
  registerCustomer,
  loginUser,
  resetModule13Tables,
  updateShipmentTrackingViaHttp,
} from "./module13.test-helpers.js";

beforeEach(async () => {
  await resetModule13Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 13 Shipping fulfillment HTTP contracts", () => {
  it("protects seller Shipment routes with authentication and seller permissions", async () => {
    const app = createApp();
    await request(app).get("/api/v1/seller/shipments").expect(401);

    const customer = await registerCustomer(`module13-http-customer-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const forbidden = await request(createApp())
      .get("/api/v1/seller/shipments")
      .set(bearer(customerToken))
      .expect(403);

    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
  });

  it("requires idempotency headers and strict request bodies before fulfillment service work", async () => {
    const fixture = await prepareFulfillmentFixture(2);

    const missingCreateKey = await request(createApp())
      .post(`/api/v1/seller/orders/${fixture.sellerOrderId}/shipments`)
      .set(bearer(fixture.sellerToken))
      .send({ items: [{ orderItemId: fixture.orderItemId, quantity: 1 }] })
      .expect(422);
    expect(missingCreateKey.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const extraCreateField = await request(createApp())
      .post(`/api/v1/seller/orders/${fixture.sellerOrderId}/shipments`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-http-${randomUUID()}`)
      .send({
        items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
        status: "shipped",
      })
      .expect(422);
    expect(extraCreateField.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const fakeShipmentId = randomUUID();
    const extraTrackingField = await request(createApp())
      .patch(`/api/v1/seller/shipments/${fakeShipmentId}/tracking`)
      .set(bearer(fixture.sellerToken))
      .send({ carrier: "Carrier", trackingNo: "TRACK-1", status: "delivered" })
      .expect(422);
    expect(extraTrackingField.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const extraLifecycleBody = await request(createApp())
      .post(`/api/v1/seller/shipments/${fakeShipmentId}/mark-shipped`)
      .set(bearer(fixture.sellerToken))
      .set("Idempotency-Key", `module13-http-${randomUUID()}`)
      .send({ deliveredAt: new Date().toISOString() })
      .expect(422);
    expect(extraLifecycleBody.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("does not reveal another seller Shipment or another customer Order tracking", async () => {
    const fixtureA = await prepareFulfillmentFixture(1);
    const fixtureB = await prepareFulfillmentFixture(1);
    const shipment = await createShipmentViaHttp(
      fixtureA.sellerToken,
      fixtureA.sellerOrderId,
      [{ orderItemId: fixtureA.orderItemId, quantity: 1 }],
    );

    const sellerBList = await listSellerShipmentsViaHttp(fixtureB.sellerToken);
    expect(sellerBList.map((item) => item.id)).not.toContain(shipment.id);

    const crossSeller = await request(createApp())
      .patch(`/api/v1/seller/shipments/${shipment.id}/tracking`)
      .set(bearer(fixtureB.sellerToken))
      .send({ carrier: "Carrier", trackingNo: "TRACK-CROSS" })
      .expect(404);
    expect(crossSeller.body.error.code).toBe(SHIPPING_ERROR_CODE.SHIPMENT_NOT_FOUND);

    const crossCustomer = await request(createApp())
      .get(`/api/v1/orders/${fixtureA.orderId}/shipments`)
      .set(bearer(fixtureB.customerToken))
      .expect(404);
    expect(crossCustomer.body.error.code).toBe(ERROR_CODE.RESOURCE_NOT_FOUND);
  });

  it("returns only shipped/delivered customer-safe tracking while admin read remains non-mutating", async () => {
    const fixture = await prepareFulfillmentFixture(1);
    const shipment = await createShipmentViaHttp(
      fixture.sellerToken,
      fixture.sellerOrderId,
      [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    );

    expect(await getOrderShipmentsViaHttp(fixture.customerToken, fixture.orderId)).toEqual([]);
    expect(await getOrderShipmentsViaHttp(fixture.adminToken, fixture.orderId)).toEqual([]);

    await updateShipmentTrackingViaHttp(fixture.sellerToken, shipment.id, {
      carrier: "  Module 13 Carrier  ",
      trackingNo: "  M13-TRACK-1  ",
      serviceLevel: "  Standard  ",
    });
    await markShipmentShippedViaHttp(fixture.sellerToken, shipment.id);

    const customerTracking = await getOrderShipmentsViaHttp(
      fixture.customerToken,
      fixture.orderId,
    );
    const adminTracking = await getOrderShipmentsViaHttp(fixture.adminToken, fixture.orderId);

    expect(customerTracking).toHaveLength(1);
    expect(customerTracking[0]).toMatchObject({
      id: shipment.id,
      carrier: "Module 13 Carrier",
      trackingNo: "M13-TRACK-1",
      serviceLevel: "Standard",
      status: "shipped",
    });
    expect(customerTracking[0]).not.toHaveProperty("sellerOrderId");
    expect(
      customerTracking[0]?.timeline.map((entry) => String(entry.status)),
    ).not.toContain("created");
    expect(adminTracking).toEqual(customerTracking);
  });
});

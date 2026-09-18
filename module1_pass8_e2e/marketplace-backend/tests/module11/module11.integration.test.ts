import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  ORDERS_ERROR_CODE,
  ORDERS_OUTBOX_EVENT,
} from "../../src/modules/orders/orders.constants.js";
import {
  bearer,
  confirmOrderPaymentViaHttp,
  countOrderOutboxEvents,
  countOrdersForAttempt,
  getCustomerOrderViaHttp,
  internalApiKey,
  prepareOrderFixture,
  readInventoryQuantities,
  readOrderItemReservations,
  resetModule11Tables,
  updateVariantViaHttp,
} from "./module11.test-helpers.js";
import {
  loginUser,
  registerCustomer,
} from "../module10/module10.test-helpers.js";

beforeEach(async () => {
  await resetModule11Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 11 Orders service/API integration", () => {
  it("materializes one immutable Customer Order with deterministic multi-seller split and exact money reconciliation", async () => {
    const fixture = await prepareOrderFixture({
      sellerCount: 2,
      quantities: [2, 1],
      prices: ["100.00", "50.00"],
      shippingRates: ["10.0000", "20.0000"],
    });

    const replay = await request(createApp())
      .post(`/api/v1/checkout/quote/${fixture.quote.id}/confirm`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `module11-second-key-${randomUUID()}`)
      .send({ stateHash: fixture.quote.stateHash })
      .expect(200);
    expect(replay.body.data.id).toBe(fixture.attempt.id);
    expect(replay.body.data.orderId).toBe(fixture.orderId);
    expect(await countOrdersForAttempt(fixture.attempt.id)).toBe(1);

    const detail = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    expect(detail.sellerOrders).toHaveLength(2);
    expect(detail.subtotal).toBe("250.0000");
    expect(detail.shippingTotal).toBe("30.0000");
    expect(detail.grandTotal).toBe("280.0000");
    expect(
      detail.sellerOrders.reduce((sum, sellerOrder) => sum + Number(sellerOrder.grandTotal), 0),
    ).toBe(Number(detail.grandTotal));

    const reconciliation = await databasePool.query<{ invalid_count: number }>(
      `select count(*)::int as invalid_count
         from orders parent
         left join lateral (
           select coalesce(sum(child.subtotal), 0)::numeric(18,4) as subtotal,
                  coalesce(sum(child.discount_total), 0)::numeric(18,4) as discount_total,
                  coalesce(sum(child.tax_total), 0)::numeric(18,4) as tax_total,
                  coalesce(sum(child.shipping_total), 0)::numeric(18,4) as shipping_total,
                  coalesce(sum(child.grand_total), 0)::numeric(18,4) as grand_total
             from seller_orders child
            where child.order_id = parent.id
         ) totals on true
        where parent.id = $1
          and (parent.subtotal <> totals.subtotal
            or parent.discount_total <> totals.discount_total
            or parent.tax_total <> totals.tax_total
            or parent.shipping_total <> totals.shipping_total
            or parent.grand_total <> totals.grand_total)`,
      [fixture.orderId],
    );
    expect(reconciliation.rows[0]?.invalid_count).toBe(0);

    const firstSeller = fixture.sellers[0]!;
    const originalItem = detail.sellerOrders
      .flatMap((sellerOrder) => sellerOrder.items)
      .find((item) => item.variantId === firstSeller.product.variant.id);
    expect(originalItem).toMatchObject({
      sku: firstSeller.product.variant.sku,
      name: firstSeller.product.product.name,
      unitPrice: "100.0000",
    });
    const originalCity = detail.shippingAddress.city;

    await updateVariantViaHttp(
      firstSeller.product.seller.ownerToken,
      firstSeller.product.product.id,
      firstSeller.product.variant.id,
      { price: "999.00" },
    );
    await request(createApp())
      .patch(`/api/v1/customers/me/addresses/${fixture.addressId}`)
      .set(bearer(fixture.customerToken))
      .send({ city: "Lahore" })
      .expect(200);

    const immutable = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    const immutableItem = immutable.sellerOrders
      .flatMap((sellerOrder) => sellerOrder.items)
      .find((item) => item.variantId === firstSeller.product.variant.id);
    expect(immutableItem?.unitPrice).toBe("100.0000");
    expect(immutable.shippingAddress.city).toBe(originalCity);
  });

  it("enforces customer and seller isolation plus admin scoped search", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2 });
    const detail = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    const otherCustomer = await registerCustomer(`module11-other-${randomUUID()}@example.com`);
    const otherCustomerToken = await loginUser(otherCustomer);

    const hiddenCustomerOrder = await request(createApp())
      .get(`/api/v1/orders/${fixture.orderId}`)
      .set(bearer(otherCustomerToken))
      .expect(404);
    expect(hiddenCustomerOrder.body.error.code).toBe(ORDERS_ERROR_CODE.NOT_FOUND);

    const customerSellerAccess = await request(createApp())
      .get("/api/v1/seller/orders")
      .set(bearer(fixture.customerToken))
      .expect(403);
    expect(customerSellerAccess.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const sellerA = fixture.sellers[0]!;
    const sellerB = fixture.sellers[1]!;
    const sellerAOrder = detail.sellerOrders.find(
      (sellerOrder) => sellerOrder.sellerId === sellerA.product.seller.sellerId,
    );
    expect(sellerAOrder).toBeTruthy();

    const sellerAList = await request(createApp())
      .get("/api/v1/seller/orders")
      .set(bearer(sellerA.product.seller.ownerToken))
      .expect(200);
    expect(sellerAList.body.data).toHaveLength(1);
    expect(sellerAList.body.data[0].sellerId).toBe(sellerA.product.seller.sellerId);

    const sellerBLeak = await request(createApp())
      .get(`/api/v1/seller/orders/${sellerAOrder!.id}`)
      .set(bearer(sellerB.product.seller.ownerToken))
      .expect(403);
    expect(sellerBLeak.body.error.code).toBe(ORDERS_ERROR_CODE.SELLER_SCOPE_FORBIDDEN);

    const adminSearch = await request(createApp())
      .get("/api/v1/admin/orders")
      .query({ orderNo: detail.orderNo })
      .set(bearer(fixture.adminToken))
      .expect(200);
    expect(adminSearch.body.data).toEqual([
      expect.objectContaining({ id: fixture.orderId, orderNo: detail.orderNo }),
    ]);
  });

  it("supports replay-safe pre-capture partial/full cancellation and Inventory reconciliation", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 1, quantities: [3] });
    const before = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    const item = before.sellerOrders[0]!.items[0]!;
    const variantId = fixture.sellers[0]!.product.variant.id;

    const missingHeader = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .send({ items: [{ orderItemId: item.id, quantity: 1 }] })
      .expect(422);
    expect(missingHeader.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const key = `module11-cancel-${randomUUID()}`;
    const body = { items: [{ orderItemId: item.id, quantity: 1 }], reason: "Need fewer items" };
    const first = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", key)
      .send(body)
      .expect(200);
    const replay = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", key)
      .send(body)
      .expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(first.body.data.sellerOrders[0].items[0]).toMatchObject({
      quantity: 3,
      cancelledQuantity: 1,
      remainingQuantity: 2,
      status: "partially_cancelled",
    });
    expect(await readInventoryQuantities(variantId)).toMatchObject({
      onHandQty: 20,
      reservedQty: 2,
      availableQty: 18,
    });

    const conflict = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", key)
      .send({ items: [{ orderItemId: item.id, quantity: 2 }] })
      .expect(409);
    expect(conflict.body.error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);

    const finalCancellation = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `module11-cancel-rest-${randomUUID()}`)
      .send({ reason: "Cancel the remainder" })
      .expect(200);
    expect(finalCancellation.body.data).toMatchObject({ orderStatus: "cancelled" });
    expect(finalCancellation.body.data.sellerOrders[0]).toMatchObject({ status: "cancelled" });
    expect(finalCancellation.body.data.sellerOrders[0].items[0]).toMatchObject({
      cancelledQuantity: 3,
      remainingQuantity: 0,
      status: "cancelled",
    });
    expect(await readInventoryQuantities(variantId)).toMatchObject({
      onHandQty: 20,
      reservedQty: 0,
      availableQty: 20,
    });
    expect(await countOrderOutboxEvents(ORDERS_OUTBOX_EVENT.CANCELLED)).toBe(1);
  });

  it("confirms payment exactly once, commits reservations, gates seller acceptance, and blocks post-capture cancellation", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 1, quantities: [2] });
    const before = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    const sellerOrder = before.sellerOrders[0]!;
    const sellerToken = fixture.sellers[0]!.product.seller.ownerToken;

    const earlyAccept = await request(createApp())
      .post(`/api/v1/seller/orders/${sellerOrder.id}/accept`)
      .set(bearer(sellerToken))
      .send({})
      .expect(409);
    expect(earlyAccept.body.error.code).toBe(ORDERS_ERROR_CODE.STATUS_INVALID);

    const untrusted = await request(createApp())
      .post(`/api/v1/internal/orders/${fixture.orderId}/payment-confirmed`)
      .set({ "x-internal-api-key": "wrong-key" })
      .send({})
      .expect(401);
    expect(untrusted.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const sourceKey = `module11-payment-${randomUUID()}`;
    const paymentIdentity = {
      paymentId: randomUUID(),
      paymentTransactionId: randomUUID(),
      capturedAt: new Date().toISOString(),
    };
    const paid = await confirmOrderPaymentViaHttp(
      fixture.orderId,
      before.currency,
      before.grandTotal,
      sourceKey,
      paymentIdentity,
    );
    const replay = await confirmOrderPaymentViaHttp(
      fixture.orderId,
      before.currency,
      before.grandTotal,
      sourceKey,
      paymentIdentity,
    );
    expect(replay).toEqual(paid);
    expect(paid).toMatchObject({ paymentStatus: "captured", orderStatus: "confirmed" });
    expect(paid.sellerOrders[0]).toMatchObject({ status: "pending_acceptance" });
    expect((await readOrderItemReservations(fixture.orderId)).every((row) => row.status === "committed")).toBe(true);
    expect(await countOrderOutboxEvents(ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED)).toBe(1);

    const accepted = await request(createApp())
      .post(`/api/v1/seller/orders/${sellerOrder.id}/accept`)
      .set(bearer(sellerToken))
      .send({})
      .expect(200);
    const acceptedReplay = await request(createApp())
      .post(`/api/v1/seller/orders/${sellerOrder.id}/accept`)
      .set(bearer(sellerToken))
      .send({})
      .expect(200);
    expect(acceptedReplay.body.data).toEqual(accepted.body.data);
    expect(accepted.body.data.status).toBe("processing");
    expect(await countOrderOutboxEvents(ORDERS_OUTBOX_EVENT.SELLER_ORDER_ACCEPTED)).toBe(1);

    const parent = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    expect(parent.orderStatus).toBe("processing");

    const lateCancellation = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/cancel`)
      .set(bearer(fixture.customerToken))
      .set("Idempotency-Key", `late-cancel-${randomUUID()}`)
      .send({})
      .expect(409);
    expect(lateCancellation.body.error.code).toBe(ORDERS_ERROR_CODE.CANCELLATION_NOT_ALLOWED);
  });

  it("rolls back partial reservation commits when payment confirmation hits a later invalid reservation", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2, quantities: [1, 1] });
    const before = await getCustomerOrderViaHttp(fixture.customerToken, fixture.orderId);
    const reservations = await readOrderItemReservations(fixture.orderId);
    expect(reservations).toHaveLength(2);
    const firstReservation = reservations[0]!;
    const invalidReservation = reservations[1]!;

    await request(createApp())
      .post("/api/v1/internal/inventory/release")
      .set(internalApiKey())
      .send({
        reservationId: invalidReservation.reservationId,
        sourceKey: `module11-pre-payment-release-${randomUUID()}`,
      })
      .expect(200);

    const failed = await request(createApp())
      .post(`/api/v1/internal/orders/${fixture.orderId}/payment-confirmed`)
      .set(internalApiKey())
      .send({
        paymentId: randomUUID(),
        paymentTransactionId: randomUUID(),
        sourceKey: `module11-rollback-${randomUUID()}`,
        currency: before.currency,
        capturedAmount: before.grandTotal,
        capturedAt: new Date().toISOString(),
      })
      .expect(409);
    expect(failed.body.error.code).toBe(ORDERS_ERROR_CODE.STATUS_INVALID);

    const reservationStates = await readOrderItemReservations(fixture.orderId);
    const firstAfter = reservationStates.find((row) => row.reservationId === firstReservation.reservationId);
    const invalidAfter = reservationStates.find((row) => row.reservationId === invalidReservation.reservationId);
    expect(firstAfter?.status).toBe("reserved");
    expect(invalidAfter?.status).toBe("released");

    const orderRow = await databasePool.query<{ payment_status: string; order_status: string }>(
      "select payment_status, order_status from orders where id = $1",
      [fixture.orderId],
    );
    expect(orderRow.rows[0]).toMatchObject({
      payment_status: "pending",
      order_status: "pending_payment",
    });
    expect(await countOrderOutboxEvents(ORDERS_OUTBOX_EVENT.PAYMENT_CONFIRMED)).toBe(0);
  });
});

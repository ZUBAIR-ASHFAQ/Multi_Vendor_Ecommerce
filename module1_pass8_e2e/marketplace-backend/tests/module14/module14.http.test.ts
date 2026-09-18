import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  RETURN_REQUEST_STATUS,
  RETURNS_ERROR_CODE,
} from "../../src/modules/returns-refunds/returns-refunds.constants.js";
import { bearer } from "../module13/module13.test-helpers.js";
import {
  approveReturnViaHttp,
  createReturnViaHttp,
  createSecondCustomer,
  createSecondSeller,
  prepareDeliveredReturnFixture,
  receiveReturnViaHttp,
  resetModule14Tables,
} from "./module14.test-helpers.js";

beforeEach(async () => {
  await resetModule14Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 14 Returns HTTP/RBAC regression", () => {
  it("requires authentication and rejects client-owned refund/scope fields at the HTTP boundary", async () => {
    const app = createApp();
    await request(app).get("/api/v1/returns").expect(401).expect((response) => {
      expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
    });

    const fixture = await prepareDeliveredReturnFixture(1);
    const invalid = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/returns`)
      .set(bearer(fixture.customerToken))
      .send({
        sellerOrderId: fixture.sellerOrderId,
        reasonCode: "damaged",
        items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
        refundAmount: "9999.0000",
        sellerId: fixture.sellerId,
      })
      .expect(422);

    expect(invalid.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("creates and lists only the authenticated customer's own Return Requests", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const created = await createReturnViaHttp(fixture.customerToken, fixture.orderId, {
      sellerOrderId: fixture.sellerOrderId,
      items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    });
    expect(created).toMatchObject({
      orderId: fixture.orderId,
      customerUserId: fixture.customerUserId,
      status: RETURN_REQUEST_STATUS.REQUESTED,
    });

    const ownList = await request(createApp())
      .get("/api/v1/returns")
      .set(bearer(fixture.customerToken))
      .expect(200);
    expect(ownList.body).toMatchObject({
      success: true,
      data: [expect.objectContaining({ id: created.id })],
      meta: expect.objectContaining({ totalItems: 1 }),
      requestId: expect.any(String),
    });

    const other = await createSecondCustomer();
    const otherList = await request(createApp())
      .get("/api/v1/returns")
      .set(bearer(other.token))
      .expect(200);
    expect(otherList.body.data).toEqual([]);
    expect(otherList.body.meta.totalItems).toBe(0);

    const forbidden = await request(createApp())
      .post(`/api/v1/orders/${fixture.orderId}/returns`)
      .set(bearer(other.token))
      .send({
        sellerOrderId: fixture.sellerOrderId,
        reasonCode: "damaged",
        items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
      })
      .expect(403);
    expect(forbidden.body.error.code).toBe(RETURNS_ERROR_CODE.SCOPE_FORBIDDEN);
  });

  it("keeps seller A Return queue and lifecycle writes invisible to seller B", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const created = await createReturnViaHttp(fixture.customerToken, fixture.orderId, {
      sellerOrderId: fixture.sellerOrderId,
      items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    });
    const sellerB = await createSecondSeller(fixture.captured.order.adminToken);

    const sellerBList = await request(createApp())
      .get("/api/v1/seller/returns")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBList.body.data).toEqual([]);

    const denied = await request(createApp())
      .post(`/api/v1/seller/returns/${created.id}/approve`)
      .set(bearer(sellerB.ownerToken))
      .send({ note: "Seller B should not see this" })
      .expect(403);
    expect(denied.body.error.code).toBe(RETURNS_ERROR_CODE.SCOPE_FORBIDDEN);

    const approved = await approveReturnViaHttp(fixture.sellerToken, created.id);
    expect(approved.status).toBe(RETURN_REQUEST_STATUS.APPROVED);
  });

  it("enforces explicit receive/inspection state and complete item identity", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const created = await createReturnViaHttp(fixture.customerToken, fixture.orderId, {
      sellerOrderId: fixture.sellerOrderId,
      items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    });
    await approveReturnViaHttp(fixture.sellerToken, created.id);

    const invalid = await request(createApp())
      .post(`/api/v1/seller/returns/${created.id}/receive`)
      .set(bearer(fixture.sellerToken))
      .send({
        items: [
          {
            returnItemId: randomUUID(),
            itemCondition: "opened",
            resolution: "refund_restock",
          },
        ],
      })
      .expect(409);
    expect(invalid.body.error.code).toBe(RETURNS_ERROR_CODE.STATUS_INVALID);

    const received = await receiveReturnViaHttp(fixture.sellerToken, created.id, [
      {
        returnItemId: created.items[0]!.id,
        itemCondition: "opened",
        resolution: "refund_restock",
      },
    ]);
    expect(received).toMatchObject({
      status: RETURN_REQUEST_STATUS.RECEIVED,
      items: [expect.objectContaining({ restockQty: 1, resolution: "refund_restock" })],
    });
  });

  it("keeps refund execution admin-only and requires Idempotency-Key before provider work", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const created = await createReturnViaHttp(fixture.customerToken, fixture.orderId, {
      sellerOrderId: fixture.sellerOrderId,
      items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    });
    await approveReturnViaHttp(fixture.sellerToken, created.id);

    const customerDenied = await request(createApp())
      .post(`/api/v1/returns/${created.id}/refund`)
      .set(bearer(fixture.customerToken))
      .send({})
      .expect(403);
    expect(customerDenied.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const missingKey = await request(createApp())
      .post(`/api/v1/returns/${created.id}/refund`)
      .set(bearer(fixture.captured.order.adminToken))
      .send({})
      .expect(422);
    expect(missingKey.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const adminList = await request(createApp())
      .get("/api/v1/admin/returns")
      .set(bearer(fixture.captured.order.adminToken))
      .expect(200);
    expect(adminList.body.data).toEqual([
      expect.objectContaining({ id: created.id, status: RETURN_REQUEST_STATUS.APPROVED }),
    ]);
  });
});

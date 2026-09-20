import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { COMMISSION_ENTRY_TYPE } from "../../src/modules/commissions/commissions.constants.js";
import { CommissionsRepository } from "../../src/modules/commissions/commissions.repository.js";
import {
  bearer,
  internalApiKey,
  prepareOrderFixture,
} from "../module11/module11.test-helpers.js";
import {
  createPlatformAdmin,
  loginUser,
  registerCustomer,
} from "../module10/module10.test-helpers.js";
import { resetModule16Tables } from "./module16.test-helpers.js";

beforeEach(async () => {
  await resetModule16Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Reads the immutable Order Item ownership needed to seed seller-isolation ledger rows. */
async function readOrderItems(orderId: string) {
  const result = await databasePool.query<{
    order_item_id: string;
    seller_order_id: string;
    seller_id: string;
  }>(
    `select item.id as order_item_id,
            item.seller_order_id,
            seller_order.seller_id
       from order_items item
       join seller_orders seller_order on seller_order.id = item.seller_order_id
      where item.order_id = $1
      order by seller_order.seller_id asc`,
    [orderId],
  );
  return result.rows;
}

describe("Module 16 Commissions HTTP contracts", () => {
  it("protects admin, seller, and trusted internal Commission routes with their approved authentication boundaries", async () => {
    const app = createApp();

    const admin = await request(app).get("/api/v1/admin/commissions/rules").expect(401);
    expect(admin.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const seller = await request(app).get("/api/v1/seller/commissions").expect(401);
    expect(seller.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);

    const internal = await request(app)
      .post("/api/v1/internal/commissions/order-settle")
      .set("x-internal-api-key", "wrong-internal-key")
      .send({ sourceKey: "commission:http:test", orderId: randomUUID() })
      .expect(401);
    expect(internal.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
  });

  it("enforces finance permissions while allowing an admin to create, list, and update only future-effective rules", async () => {
    const admin = await createPlatformAdmin(`module16-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const customer = await registerCustomer(`module16-customer-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const app = createApp();

    const forbidden = await request(app)
      .get("/api/v1/admin/commissions/rules")
      .set(bearer(customerToken))
      .expect(403);
    expect(forbidden.body.error.code).toBe(ERROR_CODE.FORBIDDEN);

    const created = await request(app)
      .post("/api/v1/admin/commissions/rules")
      .set(bearer(adminToken))
      .send({
        priority: 10,
        scopeType: "default",
        scopeId: null,
        ratePercent: "10.000000",
        fixedFee: "2.0000",
        fundingRulesJson: null,
        startAt: "2099-01-01T00:00:00.000Z",
        endAt: null,
        status: "active",
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      priority: 10,
      scopeType: "default",
      ratePercent: "10.000000",
      fixedFee: "2.0000",
    });

    const listed = await request(app)
      .get("/api/v1/admin/commissions/rules")
      .query({ scopeType: "default", status: "active" })
      .set(bearer(adminToken))
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: created.body.data.id, ratePercent: "10.000000" }),
    ]);

    const updated = await request(app)
      .patch(`/api/v1/admin/commissions/rules/${created.body.data.id}`)
      .set(bearer(adminToken))
      .send({ ratePercent: "12.500000" })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      id: created.body.data.id,
      ratePercent: "12.500000",
    });
  });

  it("rejects free-text Commission rule status at the HTTP boundary", async () => {
    const admin = await createPlatformAdmin(`module16-status-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const app = createApp();

    const response = await request(app)
      .post("/api/v1/admin/commissions/rules")
      .set(bearer(adminToken))
      .send({
        priority: 10,
        scopeType: "default",
        scopeId: null,
        ratePercent: "10.000000",
        fixedFee: null,
        fundingRulesJson: null,
        startAt: "2099-01-01T00:00:00.000Z",
        endAt: null,
        status: "enabled",
      })
      .expect(422);

    expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("keeps Seller A statement isolated from Seller B even when Seller A filters with Seller B order identity", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2 });
    const items = await readOrderItems(fixture.orderId);
    if (items.length !== 2) throw new Error("Expected two seller-owned Order Items.");

    const repository = new CommissionsRepository();
    for (const [index, item] of items.entries()) {
      const created = await repository.createEntryIfMissing({
        sellerId: item.seller_id,
        sellerOrderId: item.seller_order_id,
        orderItemId: item.order_item_id,
        type: COMMISSION_ENTRY_TYPE.SALE,
        grossAmount: index === 0 ? "100.0000" : "50.0000",
        commissionAmount: index === 0 ? "10.0000" : "5.0000",
        sellerNetAmount: index === 0 ? "90.0000" : "45.0000",
        currency: "PKR",
        sourceKey: `commission:http-isolation:${randomUUID()}`,
        occurredAt: new Date("2026-09-14T10:00:00.000Z"),
      });
      if (!created) throw new Error("Expected Commission HTTP isolation fixture entry.");
    }

    const sellerA = fixture.sellers[0]!.product.seller;
    const sellerB = fixture.sellers[1]!.product.seller;
    const itemA = items.find((item) => item.seller_id === sellerA.sellerId);
    const itemB = items.find((item) => item.seller_id === sellerB.sellerId);
    if (!itemA || !itemB) throw new Error("Expected seller-specific Order Item identities.");
    const app = createApp();

    const own = await request(app)
      .get("/api/v1/seller/commissions")
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(own.body.data.sellerId).toBe(sellerA.sellerId);
    expect(own.body.data.entries).toHaveLength(1);
    expect(own.body.data.entries[0].sellerId).toBe(sellerA.sellerId);
    expect(JSON.stringify(own.body)).not.toContain(sellerB.sellerId);

    const foreignOrderFilter = await request(app)
      .get("/api/v1/seller/commissions")
      .query({ sellerOrderId: itemB.seller_order_id })
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(foreignOrderFilter.body.data.sellerId).toBe(sellerA.sellerId);
    expect(foreignOrderFilter.body.data.entries).toEqual([]);

    const injectedSeller = await request(app)
      .get("/api/v1/seller/commissions")
      .query({ sellerId: sellerB.sellerId })
      .set(bearer(sellerA.ownerToken))
      .expect(422);
    expect(injectedSeller.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const adminLedger = await request(app)
      .get("/api/v1/admin/commissions/entries")
      .query({ sellerId: sellerB.sellerId })
      .set(bearer(fixture.adminToken))
      .expect(200);
    expect(adminLedger.body.data).toHaveLength(1);
    expect(adminLedger.body.data[0].sellerId).toBe(sellerB.sellerId);
  });

  it("validates trusted internal Commission bodies and never accepts client-supplied financial amounts", async () => {
    const app = createApp();

    const settlement = await request(app)
      .post("/api/v1/internal/commissions/order-settle")
      .set(internalApiKey())
      .send({
        sourceKey: "commission:http:invalid-settlement",
        orderId: randomUUID(),
        commissionAmount: "1.0000",
      })
      .expect(422);
    expect(settlement.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const refund = await request(app)
      .post("/api/v1/internal/commissions/refund-adjust")
      .set(internalApiKey())
      .send({
        sourceKey: "commission:http:invalid-refund",
        orderId: randomUUID(),
        refundPaymentTransactionId: randomUUID(),
        refundAmount: "1.0000",
      })
      .expect(422);
    expect(refund.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });
});

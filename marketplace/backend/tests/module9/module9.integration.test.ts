import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  PROMOTION_ERROR_CODE,
  PROMOTION_FUNDING_TYPE,
  PROMOTION_OUTBOX_EVENT,
  PROMOTION_OWNER_TYPE,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "../../src/modules/promotions/promotions.constants.js";
import { PromotionsService } from "../../src/modules/promotions/promotions.service.js";
import {
  activePromotionWindow,
  activatePromotionViaHttp,
  addCartItemViaHttp,
  bearer,
  countPromotionAuditActions,
  countPromotionOutboxEvents,
  createPlatformAdmin,
  createPlatformPromotionViaHttp,
  createProductSellerFixture,
  createPublishedCartWishlistFixture,
  createSellerPromotionViaHttp,
  loginUser,
  registerCustomer,
  resetModule9Tables,
  uniqueCouponCode,
} from "./module9.test-helpers.js";

beforeEach(async () => {
  await resetModule9Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 9 repository/service/API integration", () => {
  it("enforces authentication, permissions, and seller-to-seller promotion scope isolation", async () => {
    const admin = await createPlatformAdmin(`module9-scope-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "PromotionScopeA");
    const sellerB = await createProductSellerFixture(adminToken, "PromotionScopeB");
    const customer = await registerCustomer(`module9-scope-customer-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const app = createApp();
    const window = activePromotionWindow();

    const unauthenticated = await request(app).get("/api/v1/admin/promotions").expect(401);
    expect(unauthenticated.body).toMatchObject({
      success: false,
      error: { code: ERROR_CODE.UNAUTHENTICATED },
    });
    expect(unauthenticated.body.requestId).toEqual(expect.any(String));

    const forbiddenAdmin = await request(app)
      .get("/api/v1/admin/promotions")
      .set(bearer(customerToken))
      .expect(403);
    expect(forbiddenAdmin.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
    expect(forbiddenAdmin.body.requestId).toEqual(expect.any(String));

    await request(app)
      .post("/api/v1/seller/promotions")
      .set(bearer(customerToken))
      .send({
        name: "Customer Must Not Create",
        type: "percentage",
        value: "10.0000",
        ...window,
        scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.SELLER, scopeId: sellerA.sellerId }],
      })
      .expect(403);

    const owned = await createSellerPromotionViaHttp(sellerA.ownerToken, {
      name: "Seller A Promotion",
      type: "percentage",
      value: "10.0000",
      ...window,
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.STORE, scopeId: sellerA.storeId }],
    });
    expect(owned).toMatchObject({
      ownerType: PROMOTION_OWNER_TYPE.SELLER,
      sellerId: sellerA.sellerId,
      fundingType: PROMOTION_FUNDING_TYPE.SELLER,
      status: PROMOTION_STATUS.DRAFT,
    });

    const sellerAList = await request(app)
      .get("/api/v1/seller/promotions?page=1&pageSize=20")
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(sellerAList.body.data).toEqual([
      expect.objectContaining({ id: owned.id, sellerId: sellerA.sellerId }),
    ]);

    const sellerBList = await request(app)
      .get("/api/v1/seller/promotions?page=1&pageSize=20")
      .set(bearer(sellerB.ownerToken))
      .expect(200);
    expect(sellerBList.body.data).toEqual([]);

    const crossSeller = await request(app)
      .post("/api/v1/seller/promotions")
      .set(bearer(sellerA.ownerToken))
      .send({
        name: "Seller A Cannot Target Seller B",
        type: "percentage",
        value: "10.0000",
        ...window,
        scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.STORE, scopeId: sellerB.storeId }],
      })
      .expect(403);
    expect(crossSeller.body.error.code).toBe(
      PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
    );
    expect(crossSeller.body.requestId).toEqual(expect.any(String));

    const persisted = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from promotions where seller_id = $1",
      [sellerA.sellerId],
    );
    expect(persisted.rows[0]?.count).toBe(1);
  });

  it("creates, updates, lists, activates, and deactivates platform promotions with audit/outbox history", async () => {
    const admin = await createPlatformAdmin(`module9-lifecycle-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "PromotionLifecycle", {
      price: "100.00",
      onHandQty: 10,
    });
    const window = activePromotionWindow();
    const code = uniqueCouponCode("LIFE");
    const app = createApp();

    const created = await createPlatformPromotionViaHttp(adminToken, {
      name: "Lifecycle Promotion",
      type: "percentage",
      value: "10.0000",
      ...window,
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.id }],
      coupon: { code: code.toLowerCase(), maxUses: 20, maxUsesPerCustomer: 2 },
    });
    expect(created).toMatchObject({
      ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
      sellerId: null,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      status: PROMOTION_STATUS.DRAFT,
      coupon: { code, maxUses: 20, maxUsesPerCustomer: 2 },
    });

    const listed = await request(app)
      .get("/api/v1/admin/promotions?page=1&pageSize=20")
      .set(bearer(adminToken))
      .expect(200);
    expect(listed.body.success).toBe(true);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: created.id, name: "Lifecycle Promotion" }),
    ]);
    expect(listed.body.meta).toMatchObject({ page: 1, pageSize: 20, totalItems: 1 });
    expect(listed.body.requestId).toEqual(expect.any(String));

    const updated = await request(app)
      .patch(`/api/v1/admin/promotions/${created.id}`)
      .set(bearer(adminToken))
      .send({
        name: "Lifecycle Promotion Updated",
        coupon: { maxUsesPerCustomer: 1 },
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: "Lifecycle Promotion Updated",
      coupon: { code, maxUsesPerCustomer: 1 },
    });

    const activated = await activatePromotionViaHttp(adminToken, created.id);
    expect(activated.status).toBe(PROMOTION_STATUS.ACTIVE);

    const editActive = await request(app)
      .patch(`/api/v1/admin/promotions/${created.id}`)
      .set(bearer(adminToken))
      .send({ name: "Must Not Rewrite Active Rule" })
      .expect(409);
    expect(editActive.body.error.code).toBe(ERROR_CODE.CONFLICT);

    const deactivated = await request(app)
      .post(`/api/v1/admin/promotions/${created.id}/deactivate`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(deactivated.body.data.status).toBe(PROMOTION_STATUS.INACTIVE);

    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.CREATED)).resolves.toBe(1);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.ACTIVATED)).resolves.toBe(1);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.DEACTIVATED)).resolves.toBe(1);
    await expect(countPromotionAuditActions("promotion.created")).resolves.toBe(1);
    await expect(countPromotionAuditActions("promotion.updated")).resolves.toBe(1);
    await expect(countPromotionAuditActions("promotion.activated")).resolves.toBe(1);
    await expect(countPromotionAuditActions("promotion.deactivated")).resolves.toBe(1);
  });

  it("rolls promotion creation back when normalized coupon uniqueness conflicts", async () => {
    const admin = await createPlatformAdmin(`module9-coupon-conflict-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "PromotionCouponConflict", {
      price: "75.00",
      onHandQty: 10,
    });
    const code = uniqueCouponCode("UNIQUE");
    const input = {
      type: "percentage",
      value: "10.0000",
      ...activePromotionWindow(),
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.id }],
      coupon: { code },
    };

    await createPlatformPromotionViaHttp(adminToken, {
      ...input,
      name: "Original Coupon Owner",
    });
    const beforeEvents = await countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.CREATED);
    const beforeAudits = await countPromotionAuditActions("promotion.created");

    const duplicate = await request(createApp())
      .post("/api/v1/admin/promotions")
      .set(bearer(adminToken))
      .send({
        ...input,
        name: "Duplicate Coupon Owner",
        coupon: { code: `  ${code.toLowerCase()}  ` },
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe(PROMOTION_ERROR_CODE.COUPON_INVALID);

    const persisted = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from promotions",
    );
    expect(persisted.rows[0]?.count).toBe(1);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.CREATED)).resolves.toBe(
      beforeEvents,
    );
    await expect(countPromotionAuditActions("promotion.created")).resolves.toBe(beforeAudits);
  });

  it("validates coupon eligibility from the authenticated Cart and never trusts a client discount amount", async () => {
    const admin = await createPlatformAdmin(`module9-cart-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const eligible = await createPublishedCartWishlistFixture(adminToken, "PromotionEligible", {
      price: "100.00",
      onHandQty: 10,
    });
    const other = await createPublishedCartWishlistFixture(adminToken, "PromotionOther", {
      price: "50.00",
      onHandQty: 10,
    });
    const customer = await registerCustomer(`module9-cart-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const code = uniqueCouponCode("CART");
    const promotion = await createPlatformPromotionViaHttp(adminToken, {
      name: "Cart Promotion",
      type: "percentage",
      value: "10.0000",
      ...activePromotionWindow(),
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: eligible.product.id }],
      coupon: { code, maxUses: 10, maxUsesPerCustomer: 2 },
    });
    await activatePromotionViaHttp(adminToken, promotion.id);
    const eligibleCart = await addCartItemViaHttp(customerToken, eligible.variant.id, 2);
    await addCartItemViaHttp(customerToken, other.variant.id, 1);
    const eligibleItemId = String(
      (eligibleCart.items as Array<Record<string, unknown>>)[0]?.id,
    );
    const app = createApp();

    const preview = await request(app)
      .get("/api/v1/promotions/validate")
      .query({ code: code.toLowerCase() })
      .set(bearer(customerToken))
      .expect(200);
    expect(preview.body.data).toMatchObject({
      valid: true,
      promotionId: promotion.id,
      code,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      currency: "PKR",
      discountTotal: "20.00",
    });
    expect(preview.body.data.allocations).toEqual([
      expect.objectContaining({ cartItemId: eligibleItemId, discountAmount: "20.00" }),
    ]);

    const tampered = await request(app)
      .get("/api/v1/promotions/validate")
      .query({ code, discountAmount: "999999.99", sellerId: other.seller.sellerId })
      .set(bearer(customerToken))
      .expect(422);
    expect(tampered.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const otherCustomer = await registerCustomer(`module9-cart-other-${randomUUID()}@example.com`);
    const otherToken = await loginUser(otherCustomer);
    await addCartItemViaHttp(otherToken, other.variant.id, 1);
    const scopeMismatch = await request(app)
      .get("/api/v1/promotions/validate")
      .query({ code })
      .set(bearer(otherToken))
      .expect(409);
    expect(scopeMismatch.body.error.code).toBe(
      PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
    );
  });

  it("keeps coupon redemption idempotent and enforces concurrent global usage limits transactionally", async () => {
    const admin = await createPlatformAdmin(`module9-redeem-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "PromotionRedeem", {
      price: "25.00",
      onHandQty: 10,
    });
    const customerA = await registerCustomer(`module9-redeem-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module9-redeem-b-${randomUUID()}@example.com`);
    const code = uniqueCouponCode("ONE");
    const promotion = await createPlatformPromotionViaHttp(adminToken, {
      name: "Single Use Promotion",
      type: "percentage",
      value: "10.0000",
      ...activePromotionWindow(),
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.id }],
      coupon: { code, maxUses: 1, maxUsesPerCustomer: 1 },
    });
    await activatePromotionViaHttp(adminToken, promotion.id);
    const service = new PromotionsService();
    const orderA = randomUUID();

    const first = await service.recordCouponRedemption({
      code: code.toLowerCase(),
      customerUserId: customerA.id,
      orderId: orderA,
    });
    const replay = await service.recordCouponRedemption({
      code,
      customerUserId: customerA.id,
      orderId: orderA,
    });
    expect(replay).toEqual(first);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.COUPON_REDEEMED)).resolves.toBe(1);

    await expect(
      service.recordCouponRedemption({
        code,
        customerUserId: customerB.id,
        orderId: orderA,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODE.IDEMPOTENCY_CONFLICT, statusCode: 409 });

    const secondAttempt = await Promise.allSettled([
      service.recordCouponRedemption({
        code,
        customerUserId: customerA.id,
        orderId: randomUUID(),
      }),
      service.recordCouponRedemption({
        code,
        customerUserId: customerB.id,
        orderId: randomUUID(),
      }),
    ]);
    expect(secondAttempt.every((result) => result.status === "rejected")).toBe(true);
    for (const result of secondAttempt) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          code: PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
          statusCode: 409,
        });
      }
    }

    const rows = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from coupon_redemptions where coupon_id = $1",
      [first.couponId],
    );
    expect(rows.rows[0]?.count).toBe(1);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.COUPON_REDEEMED)).resolves.toBe(1);
  });

  it("enforces a per-customer redemption limit without consuming another customer allowance", async () => {
    const admin = await createPlatformAdmin(`module9-customer-limit-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "PromotionCustomerLimit", {
      price: "40.00",
      onHandQty: 10,
    });
    const customerA = await registerCustomer(`module9-limit-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module9-limit-b-${randomUUID()}@example.com`);
    const code = uniqueCouponCode("PER-CUSTOMER");
    const promotion = await createPlatformPromotionViaHttp(adminToken, {
      name: "Per Customer Limit",
      type: "percentage",
      value: "5.0000",
      ...activePromotionWindow(),
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.id }],
      coupon: { code, maxUses: 10, maxUsesPerCustomer: 1 },
    });
    await activatePromotionViaHttp(adminToken, promotion.id);
    const service = new PromotionsService();

    await service.recordCouponRedemption({
      code,
      customerUserId: customerA.id,
      orderId: randomUUID(),
    });
    await expect(
      service.recordCouponRedemption({
        code,
        customerUserId: customerA.id,
        orderId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
      statusCode: 409,
    });
    await expect(
      service.recordCouponRedemption({
        code,
        customerUserId: customerB.id,
        orderId: randomUUID(),
      }),
    ).resolves.toMatchObject({ customerUserId: customerB.id });

    const rows = await databasePool.query<{ count: number }>(
      `select count(*)::int as count
         from coupon_redemptions cr
         join coupons c on c.id = cr.coupon_id
        where c.code = $1`,
      [code],
    );
    expect(rows.rows[0]?.count).toBe(2);
  });

  it("serializes two competing first redemptions so maxUses one can succeed only once", async () => {
    const admin = await createPlatformAdmin(`module9-race-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "PromotionRace", {
      price: "30.00",
      onHandQty: 10,
    });
    const customerA = await registerCustomer(`module9-race-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module9-race-b-${randomUUID()}@example.com`);
    const code = uniqueCouponCode("RACE");
    const promotion = await createPlatformPromotionViaHttp(adminToken, {
      name: "Concurrent One Use",
      type: "percentage",
      value: "5.0000",
      ...activePromotionWindow(),
      scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: fixture.product.id }],
      coupon: { code, maxUses: 1 },
    });
    await activatePromotionViaHttp(adminToken, promotion.id);
    const service = new PromotionsService();

    const results = await Promise.allSettled([
      service.recordCouponRedemption({
        code,
        customerUserId: customerA.id,
        orderId: randomUUID(),
      }),
      service.recordCouponRedemption({
        code,
        customerUserId: customerB.id,
        orderId: randomUUID(),
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected one rejected redemption.");
    expect(rejected.reason).toMatchObject({
      code: PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
      statusCode: 409,
    });

    const rows = await databasePool.query<{ count: number }>(
      `select count(*)::int as count
         from coupon_redemptions cr
         join coupons c on c.id = cr.coupon_id
        where c.code = $1`,
      [code],
    );
    expect(rows.rows[0]?.count).toBe(1);
    await expect(countPromotionOutboxEvents(PROMOTION_OUTBOX_EVENT.COUPON_REDEEMED)).resolves.toBe(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import {
  PROMOTION_FUNDING_TYPE,
  PROMOTION_OWNER_TYPE,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "../../src/modules/promotions/promotions.constants.js";
import { PromotionsRepository } from "../../src/modules/promotions/promotions.repository.js";
import {
  createPlatformAdmin,
  createProductSellerFixture,
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

describe("Module 9 repository persistence boundaries", () => {
  it("keeps platform listing scoped and coupon redemption identity constrained in persistence", async () => {
    const admin = await createPlatformAdmin(`module9-repo-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "PromotionRepo");
    const customerA = await registerCustomer(`module9-repo-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module9-repo-b-${randomUUID()}@example.com`);
    const repository = new PromotionsRepository();
    const now = Date.now();

    const platformPromotion = await repository.createPromotion({
      ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
      sellerId: null,
      name: "Platform Repository Promotion",
      type: "percentage",
      value: "10.0000",
      startAt: new Date(now - 60_000),
      endAt: new Date(now + 60 * 60_000),
      status: PROMOTION_STATUS.DRAFT,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
    });
    const sellerPromotion = await repository.createPromotion({
      ownerType: PROMOTION_OWNER_TYPE.SELLER,
      sellerId: seller.sellerId,
      name: "Seller Repository Promotion",
      type: "percentage",
      value: "5.0000",
      startAt: new Date(now - 60_000),
      endAt: new Date(now + 60 * 60_000),
      status: PROMOTION_STATUS.DRAFT,
      fundingType: PROMOTION_FUNDING_TYPE.SELLER,
    });

    const listed = await repository.listPlatformPromotions({ page: 1, pageSize: 20 });
    expect(listed.items.map((promotion) => promotion.id)).toEqual([platformPromotion.id]);
    const sellerListed = await repository.listSellerPromotions(
      [seller.sellerId],
      { page: 1, pageSize: 20 },
    );
    expect(sellerListed.items.map((promotion) => promotion.id)).toEqual([sellerPromotion.id]);
    await expect(
      repository.listSellerPromotions([seller.sellerId], {
        page: 1,
        pageSize: 20,
        status: PROMOTION_STATUS.ACTIVE,
      }),
    ).resolves.toMatchObject({ items: [], totalItems: 0 });
    await expect(
      repository.findPlatformPromotionByIdForUpdate(sellerPromotion.id),
    ).resolves.toBeNull();

    const scopes = await repository.replacePromotionScopes(platformPromotion.id, [
      { scopeType: PROMOTION_SCOPE_TYPE.SELLER, scopeId: seller.sellerId },
    ]);
    expect(scopes).toEqual([
      expect.objectContaining({
        promotionId: platformPromotion.id,
        scopeType: PROMOTION_SCOPE_TYPE.SELLER,
        scopeId: seller.sellerId,
      }),
    ]);

    const couponCode = uniqueCouponCode("REPO");
    const coupon = await repository.createCoupon({
      promotionId: platformPromotion.id,
      code: couponCode,
      maxUses: 3,
      maxUsesPerCustomer: 1,
    });
    await expect(repository.findCouponByCode(couponCode)).resolves.toMatchObject({
      id: coupon.id,
      code: couponCode,
    });

    const orderId = randomUUID();
    const first = await repository.createCouponRedemptionIfMissing({
      couponId: coupon.id,
      customerUserId: customerA.id,
      orderId,
    });
    expect(first).toMatchObject({ couponId: coupon.id, customerUserId: customerA.id, orderId });
    await expect(
      repository.createCouponRedemptionIfMissing({
        couponId: coupon.id,
        customerUserId: customerA.id,
        orderId,
      }),
    ).resolves.toBeNull();

    await repository.createCouponRedemptionIfMissing({
      couponId: coupon.id,
      customerUserId: customerB.id,
      orderId: randomUUID(),
    });

    await expect(repository.countCouponRedemptions(coupon.id)).resolves.toBe(2);
    await expect(
      repository.countCouponRedemptionsForCustomer(coupon.id, customerA.id),
    ).resolves.toBe(1);
    await expect(
      repository.countCouponRedemptionsForCustomer(coupon.id, customerB.id),
    ).resolves.toBe(1);
  });

  it("replaces promotion scopes atomically instead of leaving stale targets", async () => {
    const repository = new PromotionsRepository();
    const now = Date.now();
    const promotion = await repository.createPromotion({
      ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
      sellerId: null,
      name: "Scope Replacement",
      type: "percentage",
      value: "15.0000",
      startAt: new Date(now - 60_000),
      endAt: new Date(now + 60 * 60_000),
      status: PROMOTION_STATUS.DRAFT,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
    });
    const oldTarget = randomUUID();
    const nextTarget = randomUUID();

    await repository.replacePromotionScopes(promotion.id, [
      { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: oldTarget },
    ]);
    await repository.replacePromotionScopes(promotion.id, [
      { scopeType: PROMOTION_SCOPE_TYPE.PRODUCT, scopeId: nextTarget },
    ]);

    await expect(repository.listScopesByPromotionId(promotion.id)).resolves.toEqual([
      expect.objectContaining({
        promotionId: promotion.id,
        scopeType: PROMOTION_SCOPE_TYPE.PRODUCT,
        scopeId: nextTarget,
      }),
    ]);
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { CartResponse } from "../../src/modules/cart-wishlist/cart-wishlist.schema.js";
import {
  COUPON_STATUS,
  PROMOTION_ERROR_CODE,
  PROMOTION_FUNDING_TYPE,
  PROMOTION_OWNER_TYPE,
  PROMOTION_PERMISSION,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "../../src/modules/promotions/promotions.constants.js";
import { PromotionsRepository } from "../../src/modules/promotions/promotions.repository.js";
import {
  PromotionsService,
  type PromotionCartIntegration,
  type PromotionProductIntegration,
  type PromotionSellerIntegration,
} from "../../src/modules/promotions/promotions.service.js";

/** Builds one customer request context with the permission required for coupon validation. */
function customerContext(actorId = randomUUID()): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set([PROMOTION_PERMISSION.READ]),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one seller request context scoped to exactly one seller and Module 9 permission. */
function sellerContext(sellerId: string): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([sellerId]),
    storeIds: new Set(),
    sellerPermissions: new Map([
      [sellerId, new Set([PROMOTION_PERMISSION.SELLER_MANAGE])],
    ]),
    sessionId: randomUUID(),
  };
}

/** Creates a minimal Module 9 repository double for read-only coupon evaluation tests. */
function repositoryStub(overrides: Partial<Record<keyof PromotionsRepository, unknown>>) {
  return {
    findCouponByCode: vi.fn(),
    findPromotionById: vi.fn(),
    countCouponRedemptions: vi.fn().mockResolvedValue(0),
    countCouponRedemptionsForCustomer: vi.fn().mockResolvedValue(0),
    listScopesByPromotionId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PromotionsRepository;
}

/** Creates one cart response with exact prices for deterministic allocation tests. */
function cartResponse(lines: Array<{ id: string; productId: string; variantId: string; price: string }>): CartResponse {
  const now = "2026-09-09T12:00:00.000Z";
  const subtotal = lines.reduce((total, line) => total + Number(line.price), 0).toFixed(2);
  return {
    id: randomUUID(),
    currency: "USD",
    previewSubtotal: subtotal,
    hasUnavailableItems: false,
    updatedAt: now,
    items: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      variantId: line.variantId,
      productName: "Promotion Product",
      productSlug: `promotion-${line.productId}`,
      variantTitle: "Default",
      sku: `SKU-${line.variantId}`,
      currentUnitPrice: line.price,
      currency: "USD",
      quantity: 1,
      previewLineSubtotal: line.price,
      inStock: true,
      isPurchasable: true,
      addedAt: now,
      updatedAt: now,
    })),
  } as CartResponse;
}

describe("Module 9 promotion service rules", () => {
  it("rejects seller-to-seller promotion scope before any persistence transaction", async () => {
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const transactionRunner = vi.fn();
    const sellers: PromotionSellerIntegration = {
      assertSellerCommerceEligible: vi.fn(),
      resolveCommerceStoreById: vi.fn(),
    };
    const service = new PromotionsService({
      sellers,
      transactionRunner,
    });

    await expect(
      service.createSellerPromotion(sellerContext(sellerA), {
        name: "Cross Seller",
        type: "percentage",
        value: "10.0000",
        startAt: "2026-09-09T10:00:00.000Z",
        endAt: "2026-09-10T10:00:00.000Z",
        scopes: [{ scopeType: PROMOTION_SCOPE_TYPE.SELLER, scopeId: sellerB }],
      }),
    ).rejects.toMatchObject({
      code: PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
      statusCode: 403,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
    expect(sellers.assertSellerCommerceEligible).not.toHaveBeenCalled();
  });

  it("allocates a percentage discount deterministically in stable Cart-item order", async () => {
    const customer = customerContext();
    const promotionId = randomUUID();
    const couponId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const categoryId = randomUUID();
    const itemIds = [
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    const productIds = [randomUUID(), randomUUID(), randomUUID()];
    const variantIds = [randomUUID(), randomUUID(), randomUUID()];
    const now = new Date("2026-09-09T12:00:00.000Z");
    const repository = repositoryStub({
      findCouponByCode: vi.fn().mockResolvedValue({
        id: couponId,
        promotionId,
        code: "ROUNDING",
        maxUses: null,
        maxUsesPerCustomer: null,
        status: COUPON_STATUS.ACTIVE,
      }),
      findPromotionById: vi.fn().mockResolvedValue({
        id: promotionId,
        ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
        sellerId: null,
        name: "Rounding",
        type: "percentage",
        value: "33.3300",
        startAt: new Date("2026-09-09T11:00:00.000Z"),
        endAt: new Date("2026-09-09T13:00:00.000Z"),
        status: PROMOTION_STATUS.ACTIVE,
        fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      }),
      listScopesByPromotionId: vi.fn().mockResolvedValue([
        { promotionId, scopeType: PROMOTION_SCOPE_TYPE.SELLER, scopeId: sellerId },
      ]),
    });
    const cart: PromotionCartIntegration = {
      getCart: vi.fn().mockResolvedValue(
        cartResponse([
          { id: itemIds[0]!, productId: productIds[0]!, variantId: variantIds[0]!, price: "0.04" },
          { id: itemIds[1]!, productId: productIds[1]!, variantId: variantIds[1]!, price: "0.03" },
          { id: itemIds[2]!, productId: productIds[2]!, variantId: variantIds[2]!, price: "0.03" },
        ]),
      ),
    };
    const products: PromotionProductIntegration = {
      resolveProductPromotionScope: vi.fn(),
      resolvePublicProductPromotionScope: vi.fn().mockImplementation(async (productId: string) => ({
        productId,
        sellerId,
        storeId,
        categoryId,
      })),
    };
    const service = new PromotionsService({ repository, cart, products, now: () => now });

    const result = await service.validateCoupon(customer, { code: "rounding" });

    expect(result.discountTotal).toBe("0.03");
    expect(result.allocations).toEqual([
      expect.objectContaining({ cartItemId: itemIds[1], discountAmount: "0.01" }),
      expect.objectContaining({ cartItemId: itemIds[2], discountAmount: "0.01" }),
      expect.objectContaining({ cartItemId: itemIds[0], discountAmount: "0.01" }),
    ]);
  });

  it("rejects a coupon before Cart loading when the customer usage limit is already reached", async () => {
    const customer = customerContext();
    const promotionId = randomUUID();
    const couponId = randomUUID();
    const now = new Date("2026-09-09T12:00:00.000Z");
    const cart: PromotionCartIntegration = { getCart: vi.fn() };
    const repository = repositoryStub({
      findCouponByCode: vi.fn().mockResolvedValue({
        id: couponId,
        promotionId,
        code: "ONCE",
        maxUses: 10,
        maxUsesPerCustomer: 1,
        status: COUPON_STATUS.ACTIVE,
      }),
      findPromotionById: vi.fn().mockResolvedValue({
        id: promotionId,
        ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
        sellerId: null,
        name: "Once",
        type: "percentage",
        value: "10.0000",
        startAt: new Date("2026-09-09T11:00:00.000Z"),
        endAt: new Date("2026-09-09T13:00:00.000Z"),
        status: PROMOTION_STATUS.ACTIVE,
        fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      }),
      countCouponRedemptions: vi.fn().mockResolvedValue(1),
      countCouponRedemptionsForCustomer: vi.fn().mockResolvedValue(1),
    });
    const service = new PromotionsService({ repository, cart, now: () => now });

    await expect(service.validateCoupon(customer, { code: "ONCE" })).rejects.toMatchObject({
      code: PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
      statusCode: 409,
    });
    expect(cart.getCart).not.toHaveBeenCalled();
  });
});

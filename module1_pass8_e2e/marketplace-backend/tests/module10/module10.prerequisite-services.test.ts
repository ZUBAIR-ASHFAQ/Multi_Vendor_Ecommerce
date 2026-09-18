import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { AdministrationRepository } from "../../src/modules/administration/administration.repository.js";
import { AdministrationService } from "../../src/modules/administration/administration.service.js";
import {
  CUSTOMER_ADDRESS_STATUS,
  CUSTOMER_PROFILE_STATUS,
} from "../../src/modules/customers/customers.constants.js";
import { CustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { CustomersService } from "../../src/modules/customers/customers.service.js";
import { InventoryRepository } from "../../src/modules/inventory/inventory.repository.js";
import { InventoryService } from "../../src/modules/inventory/inventory.service.js";
import {
  COUPON_STATUS,
  PROMOTION_FUNDING_TYPE,
  PROMOTION_OWNER_TYPE,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "../../src/modules/promotions/promotions.constants.js";
import { PromotionsRepository } from "../../src/modules/promotions/promotions.repository.js";
import { PromotionsService } from "../../src/modules/promotions/promotions.service.js";
import { PRODUCT_STATUS } from "../../src/modules/products/products.constants.js";
import { ProductsRepository } from "../../src/modules/products/products.repository.js";
import { ProductsService } from "../../src/modules/products/products.service.js";

/** Builds the minimal authenticated customer context used by trusted Checkout prerequisite reads. */
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

/** Creates a narrow customer repository double for owned-address resolution tests. */
function customerRepositoryStub(
  overrides: Partial<Record<keyof CustomersRepository, unknown>>,
): CustomersRepository {
  return {
    findProfileByUserId: vi.fn(),
    findAddressByIdForCustomer: vi.fn(),
    ...overrides,
  } as unknown as CustomersRepository;
}

/** Creates a narrow Product repository double for Checkout variant-resolution tests. */
function productRepositoryStub(
  overrides: Partial<Record<keyof ProductsRepository, unknown>>,
): ProductsRepository {
  return {
    findVariantSellerStoreScope: vi.fn(),
    findPublicProductById: vi.fn(),
    findVariantByIdInProduct: vi.fn(),
    ...overrides,
  } as unknown as ProductsRepository;
}

/** Creates a narrow Inventory repository double for quantity-aware Checkout stock reads. */
function inventoryRepositoryStub(
  overrides: Partial<Record<keyof InventoryRepository, unknown>>,
): InventoryRepository {
  return {
    listAvailabilityByVariantIds: vi.fn(),
    ...overrides,
  } as unknown as InventoryRepository;
}

/** Creates a narrow Promotion repository double for authoritative Checkout discount evaluation. */
function promotionRepositoryStub(
  overrides: Partial<Record<keyof PromotionsRepository, unknown>>,
): PromotionsRepository {
  return {
    findCouponByCode: vi.fn(),
    findPromotionById: vi.fn(),
    countCouponRedemptions: vi.fn().mockResolvedValue(0),
    countCouponRedemptionsForCustomer: vi.fn().mockResolvedValue(0),
    listScopesByPromotionId: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PromotionsRepository;
}

/** Creates a narrow Administration repository double for Checkout tax-setting reads. */
function administrationRepositoryStub(valueJson: unknown): AdministrationRepository {
  return {
    findPlatformSettingsByKeys: vi.fn().mockResolvedValue([
      {
        key: "commerce.default_tax_rate_percent",
        valueJson,
        updatedBy: randomUUID(),
        updatedAt: new Date("2026-09-12T08:00:00.000Z"),
      },
    ]),
  } as unknown as AdministrationRepository;
}

describe("Module 10 Pass 2 prerequisite service boundaries", () => {
  it("returns the full active address owned by the authenticated customer", async () => {
    const customerUserId = randomUUID();
    const addressId = randomUUID();
    const now = new Date("2026-09-12T08:00:00.000Z");
    const repository = customerRepositoryStub({
      findProfileByUserId: vi.fn().mockResolvedValue({
        userId: customerUserId,
        displayName: "Checkout Customer",
        phone: null,
        status: CUSTOMER_PROFILE_STATUS.ACTIVE,
        marketingOptIn: false,
        createdAt: now,
        updatedAt: now,
      }),
      findAddressByIdForCustomer: vi.fn().mockResolvedValue({
        id: addressId,
        customerUserId,
        label: "Home",
        recipientName: "Checkout Customer",
        phone: "+92 300 1234567",
        line1: "1 Market Road",
        line2: null,
        city: "Karachi",
        region: "Sindh",
        postalCode: "74000",
        countryCode: "PK",
        isDefaultShipping: true,
        isDefaultBilling: true,
        status: CUSTOMER_ADDRESS_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      }),
    });
    const service = new CustomersService({ repository });

    const result = await service.resolveActiveOwnedAddress(
      customerContext(customerUserId),
      addressId,
    );

    expect(result).toMatchObject({
      id: addressId,
      customerUserId,
      city: "Karachi",
      countryCode: "PK",
      status: CUSTOMER_ADDRESS_STATUS.ACTIVE,
    });
  });

  it("resolves only a current active public Product variant for Checkout", async () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const categoryId = randomUUID();
    const repository = productRepositoryStub({
      findVariantSellerStoreScope: vi.fn().mockResolvedValue({
        variantId,
        productId,
        sellerId,
        storeId,
      }),
      findPublicProductById: vi.fn().mockResolvedValue({
        id: productId,
        sellerId,
        storeId,
        categoryId,
        name: "Snapshot Product",
      }),
      findVariantByIdInProduct: vi.fn().mockResolvedValue({
        id: variantId,
        status: PRODUCT_STATUS.ACTIVE,
        sku: "SNAP-SKU",
        title: "Snapshot Variant",
        price: "123.4500",
        currency: "PKR",
      }),
    });
    const service = new ProductsService({ repository });

    await expect(service.resolveVariantForCheckout(variantId)).resolves.toEqual({
      productId,
      variantId,
      sellerId,
      storeId,
      categoryId,
      skuSnapshot: "SNAP-SKU",
      nameSnapshot: "Snapshot Product",
      variantTitleSnapshot: "Snapshot Variant",
      unitPrice: "123.4500",
      currency: "PKR",
    });
  });

  it("checks exact requested Inventory quantities instead of only positive stock", async () => {
    const enoughVariant = randomUUID();
    const shortVariant = randomUUID();
    const missingVariant = randomUUID();
    const repository = inventoryRepositoryStub({
      listAvailabilityByVariantIds: vi.fn().mockResolvedValue([
        { variantId: enoughVariant, onHandQty: 10, reservedQty: 2 },
        { variantId: shortVariant, onHandQty: 5, reservedQty: 4 },
      ]),
    });
    const service = new InventoryService({ repository });

    const result = await service.getCheckoutAvailability([
      { variantId: enoughVariant, quantity: 3 },
      { variantId: shortVariant, quantity: 2 },
      { variantId: missingVariant, quantity: 1 },
      { variantId: enoughVariant, quantity: 2 },
    ]);

    expect(result).toEqual(
      expect.arrayContaining([
        {
          variantId: enoughVariant,
          requestedQuantity: 5,
          availableQuantity: 8,
          sufficient: true,
        },
        {
          variantId: shortVariant,
          requestedQuantity: 2,
          availableQuantity: 1,
          sufficient: false,
        },
        {
          variantId: missingVariant,
          requestedQuantity: 1,
          availableQuantity: 0,
          sufficient: false,
        },
      ]),
    );
  });

  it("returns zero authoritative discounts without querying Promotion persistence when no coupon is selected", async () => {
    const variantId = randomUUID();
    const repository = promotionRepositoryStub({});
    const service = new PromotionsService({ repository });

    const result = await service.calculateCheckoutDiscounts({
      customerUserId: randomUUID(),
      currency: "PKR",
      couponCode: null,
      lines: [
        {
          productId: randomUUID(),
          variantId,
          sellerId: randomUUID(),
          storeId: randomUUID(),
          categoryId: randomUUID(),
          quantity: 2,
          unitPrice: "10.0000",
          currency: "PKR",
        },
      ],
    });

    expect(result).toEqual({
      couponCode: null,
      promotionId: null,
      couponId: null,
      fundingType: null,
      discountTotal: "0.0000",
      allocations: [{ variantId, discountAmount: "0.0000" }],
    });
    expect(repository.findCouponByCode).not.toHaveBeenCalled();
  });

  it("calculates authoritative Checkout coupon allocation with exact scale-4 half-up rounding", async () => {
    const customerUserId = randomUUID();
    const promotionId = randomUUID();
    const couponId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const categoryId = randomUUID();
    const now = new Date("2026-09-12T08:00:00.000Z");
    const repository = promotionRepositoryStub({
      findCouponByCode: vi.fn().mockResolvedValue({
        id: couponId,
        promotionId,
        code: "TENOFF",
        maxUses: null,
        maxUsesPerCustomer: null,
        status: COUPON_STATUS.ACTIVE,
      }),
      findPromotionById: vi.fn().mockResolvedValue({
        id: promotionId,
        ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
        sellerId: null,
        name: "Ten percent",
        type: "percentage",
        value: "10.0000",
        startAt: new Date("2026-09-12T07:00:00.000Z"),
        endAt: new Date("2026-09-12T09:00:00.000Z"),
        status: PROMOTION_STATUS.ACTIVE,
        fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      }),
      listScopesByPromotionId: vi.fn().mockResolvedValue([
        {
          promotionId,
          scopeType: PROMOTION_SCOPE_TYPE.PRODUCT,
          scopeId: productId,
        },
      ]),
    });
    const cart = { getCart: vi.fn() };
    const service = new PromotionsService({ repository, cart, now: () => now });

    const result = await service.calculateCheckoutDiscounts({
      customerUserId,
      currency: "PKR",
      couponCode: " tenoff ",
      lines: [
        {
          productId,
          variantId,
          sellerId,
          storeId,
          categoryId,
          quantity: 1,
          unitPrice: "12.3456",
          currency: "PKR",
        },
      ],
    });

    expect(result).toEqual({
      couponCode: "TENOFF",
      promotionId,
      couponId,
      fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
      discountTotal: "1.2346",
      allocations: [{ variantId, discountAmount: "1.2346" }],
    });
    expect(cart.getCart).not.toHaveBeenCalled();
  });

  it("returns Administration tax rate as the canonical Checkout percentage string", async () => {
    const service = new AdministrationService(administrationRepositoryStub(7.5));

    await expect(service.getDefaultTaxRatePercent()).resolves.toBe("7.5");
  });
});

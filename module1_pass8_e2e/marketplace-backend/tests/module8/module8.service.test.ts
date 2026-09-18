import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  CART_WISHLIST_ERROR_CODE,
  CART_WISHLIST_LIMITS,
  CART_WISHLIST_PERMISSION,
} from "../../src/modules/cart-wishlist/cart-wishlist.constants.js";
import { CartWishlistRepository } from "../../src/modules/cart-wishlist/cart-wishlist.repository.js";
import {
  CartWishlistService,
  type CartWishlistInventoryIntegration,
  type CartWishlistProductIntegration,
} from "../../src/modules/cart-wishlist/cart-wishlist.service.js";
import type { PublicProductDetailResponse } from "../../src/modules/products/products.schema.js";

/** Builds one authenticated customer context with the supplied Module 8 permissions. */
function customerContext(permissions: string[]): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds a non-customer context to prove service methods do not rely only on route middleware. */
function sellerContext(permissions: string[]): RequestContext {
  return {
    ...customerContext(permissions),
    actorType: ACTOR_TYPE.SELLER,
  };
}

/** Creates a minimal repository double for read-only Cart/Wishlist service tests. */
function repositoryStub(overrides: Partial<Record<keyof CartWishlistRepository, unknown>>) {
  return {
    findCartByCustomerUserId: vi.fn().mockResolvedValue(null),
    listCartItemsForCustomer: vi.fn().mockResolvedValue([]),
    findDefaultWishlistByCustomerUserId: vi.fn().mockResolvedValue(null),
    listWishlistItemsForCustomer: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CartWishlistRepository;
}

/** Creates the public Product shape needed by Cart/Wishlist preview mapping. */
function publicProduct(
  productId: string,
  variantId: string,
  price: string,
): PublicProductDetailResponse {
  return {
    id: productId,
    name: "Readable Product",
    slug: "readable-product",
    variants: [
      {
        id: variantId,
        title: "Default Variant",
        sku: "READ-001",
        price,
        currency: "USD",
      },
    ],
  } as unknown as PublicProductDetailResponse;
}

/** Creates Product and Inventory read doubles without exposing persistence to Module 8. */
function commerceReads(
  product: PublicProductDetailResponse | null,
  inStock: boolean,
): {
  products: CartWishlistProductIntegration;
  inventory: CartWishlistInventoryIntegration;
} {
  return {
    products: {
      findProductIdByVariantId: vi.fn().mockResolvedValue(product?.id ?? randomUUID()),
      findPublicProductById: vi.fn().mockResolvedValue(product),
    },
    inventory: {
      hasAvailableStockForVariants: vi.fn().mockResolvedValue(inStock),
    },
  };
}

describe("Module 8 Cart/Wishlist service rules", () => {
  it("builds an exact decimal Cart preview without reserving Inventory", async () => {
    const context = customerContext([CART_WISHLIST_PERMISSION.CART_MANAGE_OWN]);
    const customerUserId = context.actorId!;
    const cartId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const now = new Date("2026-09-08T12:00:00.000Z");
    const repository = repositoryStub({
      findCartByCustomerUserId: vi.fn().mockResolvedValue({
        id: cartId,
        customerUserId,
        currency: "USD",
        updatedAt: now,
      }),
      listCartItemsForCustomer: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          cartId,
          variantId,
          quantity: 3,
          addedAt: now,
          updatedAt: now,
        },
      ]),
    });
    const reads = commerceReads(publicProduct(productId, variantId, "19.95"), true);
    const service = new CartWishlistService({ repository, ...reads });

    const result = await service.getCart(context);

    expect(result.previewSubtotal).toBe("59.85");
    expect(result.hasUnavailableItems).toBe(false);
    expect(result.items[0]).toMatchObject({
      productId,
      variantId,
      currentUnitPrice: "19.95",
      previewLineSubtotal: "59.85",
      inStock: true,
      isPurchasable: true,
    });
    expect(reads.inventory.hasAvailableStockForVariants).toHaveBeenCalledWith([variantId]);
  });

  it("keeps an unavailable persisted Cart line visible without inventing a stale price", async () => {
    const context = customerContext([CART_WISHLIST_PERMISSION.CART_MANAGE_OWN]);
    const customerUserId = context.actorId!;
    const cartId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const now = new Date("2026-09-08T12:00:00.000Z");
    const repository = repositoryStub({
      findCartByCustomerUserId: vi.fn().mockResolvedValue({
        id: cartId,
        customerUserId,
        currency: "USD",
        updatedAt: now,
      }),
      listCartItemsForCustomer: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          cartId,
          variantId,
          quantity: 1,
          addedAt: now,
          updatedAt: now,
        },
      ]),
    });
    const reads = commerceReads(null, false);
    reads.products.findProductIdByVariantId = vi.fn().mockResolvedValue(productId);
    const service = new CartWishlistService({ repository, ...reads });

    const result = await service.getCart(context);

    expect(result.previewSubtotal).toBe("0.00");
    expect(result.hasUnavailableItems).toBe(true);
    expect(result.items[0]).toMatchObject({
      productId,
      variantId,
      currentUnitPrice: null,
      previewLineSubtotal: null,
      inStock: false,
      isPurchasable: false,
    });
  });

  it("keeps an unavailable saved Wishlist item visible instead of failing the whole list", async () => {
    const context = customerContext([CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN]);
    const customerUserId = context.actorId!;
    const wishlistId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const now = new Date("2026-09-08T12:00:00.000Z");
    const repository = repositoryStub({
      findDefaultWishlistByCustomerUserId: vi.fn().mockResolvedValue({
        id: wishlistId,
        customerUserId,
        name: "My Wishlist",
        isDefault: true,
        createdAt: now,
      }),
      listWishlistItemsForCustomer: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          wishlistId,
          productId,
          variantId,
          createdAt: now,
        },
      ]),
    });
    const reads = commerceReads(null, false);
    const service = new CartWishlistService({ repository, ...reads });

    const result = await service.getWishlist(context);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      productId,
      variantId,
      currentUnitPrice: null,
      currency: null,
      inStock: false,
      isPurchasable: false,
    });
    expect(reads.inventory.hasAvailableStockForVariants).not.toHaveBeenCalled();
  });

  it("enforces quantity rules again inside the service before any Product lookup", async () => {
    const context = customerContext([CART_WISHLIST_PERMISSION.CART_MANAGE_OWN]);
    const products = commerceReads(null, false).products;
    products.findProductIdByVariantId = vi.fn();
    const service = new CartWishlistService({ products });

    for (const quantity of [0, CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY + 1, 1.5]) {
      await expect(
        service.addCartItem(context, {
          variantId: randomUUID(),
          quantity,
        }),
      ).rejects.toMatchObject({
        code: CART_WISHLIST_ERROR_CODE.CART_QUANTITY_INVALID,
        statusCode: 400,
      });
    }
    expect(products.findProductIdByVariantId).not.toHaveBeenCalled();
  });

  it("maps an unknown or private variant to the safe Cart Product unavailable error", async () => {
    const context = customerContext([CART_WISHLIST_PERMISSION.CART_MANAGE_OWN]);
    const products: CartWishlistProductIntegration = {
      findProductIdByVariantId: vi.fn().mockResolvedValue(null),
      findPublicProductById: vi.fn(),
    };
    const service = new CartWishlistService({ products });

    await expect(
      service.addCartItem(context, { variantId: randomUUID(), quantity: 1 }),
    ).rejects.toMatchObject({
      code: CART_WISHLIST_ERROR_CODE.CART_PRODUCT_UNAVAILABLE,
      statusCode: 409,
    });
    expect(products.findPublicProductById).not.toHaveBeenCalled();
  });

  it("repeats customer actor and permission checks inside the service boundary", async () => {
    const repository = repositoryStub({});
    const service = new CartWishlistService({ repository });

    await expect(service.getCart(customerContext([]))).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    await expect(
      service.getWishlist(sellerContext([CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN])),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    expect(repository.findCartByCustomerUserId).not.toHaveBeenCalled();
    expect(repository.findDefaultWishlistByCustomerUserId).not.toHaveBeenCalled();
  });
});

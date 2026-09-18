import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CART_WISHLIST_LIMITS,
} from "../../src/modules/cart-wishlist/cart-wishlist.constants.js";
import { cartWishlistOpenApiPaths } from "../../src/modules/cart-wishlist/cart-wishlist.routes.js";
import {
  addCartItemBodySchema,
  addWishlistItemBodySchema,
  cartQuantitySchema,
  cartResponseSchema,
  updateCartItemBodySchema,
} from "../../src/modules/cart-wishlist/cart-wishlist.schema.js";

/** Returns one Module 8 OpenAPI operation object for focused contract assertions. */
function operation(path: string, method: string): Record<string, unknown> {
  const pathItem = cartWishlistOpenApiPaths[
    path as keyof typeof cartWishlistOpenApiPaths
  ] as unknown as Record<string, Record<string, unknown>>;
  return pathItem[method] ?? {};
}

describe("Module 8 Zod and OpenAPI contracts", () => {
  it("bounds Cart quantity and rejects implicit-delete quantity zero", () => {
    expect(cartQuantitySchema.parse(1)).toBe(1);
    expect(cartQuantitySchema.parse(CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY)).toBe(
      CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY,
    );
    expect(() => cartQuantitySchema.parse(0)).toThrow();
    expect(() => cartQuantitySchema.parse(CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY + 1)).toThrow();
    expect(() => cartQuantitySchema.parse(1.5)).toThrow();
  });

  it("keeps actor ownership, authoritative price, currency, and stock out of Cart write bodies", () => {
    const variantId = randomUUID();
    expect(addCartItemBodySchema.parse({ variantId, quantity: 2 })).toEqual({
      variantId,
      quantity: 2,
    });

    for (const forbidden of [
      { customerUserId: randomUUID() },
      { sellerId: randomUUID() },
      { unitPrice: "1.00" },
      { currency: "USD" },
      { availableStock: 100 },
    ]) {
      expect(() => addCartItemBodySchema.parse({ variantId, quantity: 2, ...forbidden })).toThrow();
    }
    expect(() => updateCartItemBodySchema.parse({ quantity: 2, cartId: randomUUID() })).toThrow();
  });

  it("keeps Wishlist writes strict and does not accept ownership or display fields", () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    expect(addWishlistItemBodySchema.parse({ productId, variantId })).toEqual({
      productId,
      variantId,
    });
    expect(() => addWishlistItemBodySchema.parse({
      productId,
      customerUserId: randomUUID(),
    })).toThrow();
    expect(() => addWishlistItemBodySchema.parse({
      productId,
      productName: "Client supplied",
    })).toThrow();
  });

  it("keeps Cart response money as decimal strings and labels the total as preview state", () => {
    const now = new Date().toISOString();
    const response = {
      id: randomUUID(),
      currency: "PKR",
      items: [],
      previewSubtotal: "0.00",
      hasUnavailableItems: false,
      updatedAt: now,
    };

    expect(cartResponseSchema.parse(response)).toEqual(response);
    expect(() => cartResponseSchema.parse({ ...response, previewSubtotal: 0 })).toThrow();
  });

  it("documents exactly the eight approved operations with bearer authentication", () => {
    const expected: Record<string, string[]> = {
      "/api/v1/cart": ["get", "delete"],
      "/api/v1/cart/items": ["post"],
      "/api/v1/cart/items/{id}": ["patch", "delete"],
      "/api/v1/wishlist": ["get"],
      "/api/v1/wishlist/items": ["post"],
      "/api/v1/wishlist/items/{id}": ["delete"],
    };

    for (const [path, methods] of Object.entries(expected)) {
      const pathItem = cartWishlistOpenApiPaths[
        path as keyof typeof cartWishlistOpenApiPaths
      ] as unknown as Record<string, unknown>;
      expect(Object.keys(pathItem).sort()).toEqual(methods.sort());

      for (const method of methods) {
        const current = operation(path, method) as { security?: Array<Record<string, unknown>> };
        expect(current.security).toEqual([{ bearerAuth: [] }]);
      }
    }

    expect(cartWishlistOpenApiPaths).not.toHaveProperty("/api/v1/cart/reserve");
    expect(cartWishlistOpenApiPaths).not.toHaveProperty("/api/v1/cart/checkout");
    expect(cartWishlistOpenApiPaths).not.toHaveProperty(
      "/api/v1/wishlist/items/{id}/move-to-cart",
    );
  });
});

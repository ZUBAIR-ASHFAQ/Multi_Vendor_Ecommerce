import { describe, expect, it } from "vitest";
import { administrationOpenApiPaths } from "../../src/modules/administration/administration.routes.js";
import { authOpenApiPaths } from "../../src/modules/administration/auth.routes.js";
import { catalogTaxonomyOpenApiPaths } from "../../src/modules/catalog-taxonomy/catalog-taxonomy.routes.js";
import { customersOpenApiPaths } from "../../src/modules/customers/customers.routes.js";
import { documentsAuditOpenApiPaths } from "../../src/modules/documents-audit/documents-audit.routes.js";
import { inventoryOpenApiPaths } from "../../src/modules/inventory/inventory.routes.js";
import { productsOpenApiPaths } from "../../src/modules/products/products.routes.js";
import { searchDiscoveryOpenApiPaths } from "../../src/modules/search-discovery/search-discovery.routes.js";
import { cartWishlistOpenApiPaths } from "../../src/modules/cart-wishlist/cart-wishlist.routes.js";
import { sellersOpenApiPaths } from "../../src/modules/sellers/sellers.routes.js";
import { promotionsOpenApiPaths } from "../../src/modules/promotions/promotions.routes.js";
import { shippingOpenApiPaths } from "../../src/modules/shipping/shipping.routes.js";
import { ordersOpenApiPaths } from "../../src/modules/orders/orders.routes.js";
import { returnsRefundsOpenApiPaths } from "../../src/modules/returns-refunds/returns-refunds.routes.js";
import { reviewsOpenApiPaths } from "../../src/modules/reviews/reviews.routes.js";
import { notificationsOpenApiPaths } from "../../src/modules/notifications/notifications.routes.js";
import {
  sellerWalletPayoutsOpenApiPaths,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.routes.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type OpenApiPathRegistry = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

/** Returns only real HTTP operation keys from one OpenAPI path item. */
function documentedMethods(pathItem: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(pathItem)
    .filter((key) => HTTP_METHODS.has(key))
    .sort();
}

/** Proves one module exposes exactly the approved paths and methods, with no accidental CRUD routes. */
function expectExactOpenApiSurface(
  paths: OpenApiPathRegistry,
  expected: Readonly<Record<string, readonly string[]>>,
): void {
  expect(Object.keys(paths).sort()).toEqual(Object.keys(expected).sort());

  for (const [path, methods] of Object.entries(expected)) {
    const pathItem = paths[path];
    expect(pathItem, `Missing OpenAPI path: ${path}`).toBeTruthy();
    expect(documentedMethods(pathItem ?? {})).toEqual([...methods].sort());
  }
}

describe("Implemented marketplace API regression contracts", () => {
  it("locks every implemented Module 2 Authentication route to its approved method set", () => {
    expectExactOpenApiSurface(authOpenApiPaths, {
      "/api/v1/auth/register": ["post"],
      "/api/v1/auth/login": ["post"],
      "/api/v1/auth/refresh": ["post"],
      "/api/v1/auth/logout": ["post"],
      "/api/v1/auth/me": ["get"],
    });
  });

  it("locks every implemented Module 2 Administration route to its approved method set", () => {
    expectExactOpenApiSurface(administrationOpenApiPaths, {
      "/api/v1/admin/users": ["get"],
      "/api/v1/admin/users/{id}/status": ["patch"],
      "/api/v1/admin/users/{id}/roles": ["put"],
      "/api/v1/admin/roles": ["get", "post"],
      "/api/v1/admin/roles/{id}/permissions": ["put"],
      "/api/v1/admin/settings": ["get", "patch"],
    });
  });

  it("locks every implemented Module 21 Documents and Audit route to its approved method set", () => {
    expectExactOpenApiSurface(documentsAuditOpenApiPaths, {
      "/api/v1/documents/uploads/sign": ["post"],
      "/api/v1/documents/uploads/{id}/confirm": ["post"],
      "/api/v1/documents/{id}/link": ["post"],
      "/api/v1/documents/{id}/download": ["get"],
      "/api/v1/documents/{id}/link/{linkId}": ["delete"],
      "/api/v1/audit": ["get"],
      "/api/v1/audit/{id}": ["get"],
    });
  });

  it("locks every implemented Module 3 Customer route to its approved method set", () => {
    expectExactOpenApiSurface(customersOpenApiPaths, {
      "/api/v1/customers/me": ["get", "patch"],
      "/api/v1/customers/me/addresses": ["get", "post"],
      "/api/v1/customers/me/addresses/{id}": ["patch", "delete"],
      "/api/v1/admin/customers": ["get"],
      "/api/v1/admin/customers/{id}": ["get"],
    });
  });

  it("locks every implemented Module 4 Seller and Store route to its approved method set", () => {
    expectExactOpenApiSurface(sellersOpenApiPaths, {
      "/api/v1/sellers/applications": ["post"],
      "/api/v1/admin/seller-applications": ["get"],
      "/api/v1/admin/seller-applications/{id}/approve": ["post"],
      "/api/v1/admin/seller-applications/{id}/reject": ["post"],
      "/api/v1/sellers/me": ["get", "patch"],
      "/api/v1/sellers/me/stores": ["post"],
      "/api/v1/stores/{slug}": ["get"],
      "/api/v1/sellers/me/stores/{id}": ["patch"],
      "/api/v1/admin/sellers/{id}/suspend": ["post"],
    });
  });

  it("locks every implemented Module 5 Catalog route, including the approved read-only extension", () => {
    expectExactOpenApiSurface(catalogTaxonomyOpenApiPaths, {
      "/api/v1/catalog/categories": ["get"],
      "/api/v1/catalog/categories/{id}/attributes": ["get"],
      "/api/v1/admin/catalog/categories": ["post"],
      "/api/v1/admin/catalog/categories/{id}": ["patch"],
      "/api/v1/catalog/brands": ["get"],
      "/api/v1/admin/catalog/brands": ["post"],
      "/api/v1/catalog/attributes": ["get"],
      "/api/v1/admin/catalog/attributes": ["post"],
      "/api/v1/admin/catalog/categories/{id}/attributes": ["put"],
    });
  });

  it("locks every implemented Module 6 Product route, including the approved seller-detail read", () => {
    expectExactOpenApiSurface(productsOpenApiPaths, {
      "/api/v1/products": ["get"],
      "/api/v1/products/{slug}": ["get"],
      "/api/v1/seller/products": ["get", "post"],
      "/api/v1/seller/products/{id}": ["get", "patch"],
      "/api/v1/seller/products/{id}/variants": ["post"],
      "/api/v1/seller/products/{id}/variants/{variantId}": ["patch"],
      "/api/v1/seller/products/{id}/media": ["post"],
      "/api/v1/seller/products/{id}/publish": ["post"],
      "/api/v1/seller/products/{id}/unpublish": ["post"],
      "/api/v1/admin/products": ["get"],
      "/api/v1/admin/products/{id}": ["get"],
      "/api/v1/admin/products/{id}/approve": ["post"],
      "/api/v1/admin/products/{id}/reject": ["post"],
    });
  });

  it("locks every implemented Module 7 Inventory route and keeps reservation commit internal-only", () => {
    expectExactOpenApiSurface(inventoryOpenApiPaths, {
      "/api/v1/seller/inventory": ["get"],
      "/api/v1/seller/inventory/{variantId}/movements": ["get"],
      "/api/v1/seller/inventory/{variantId}/adjust": ["post"],
      "/api/v1/seller/inventory/{variantId}/reorder-level": ["patch"],
      "/api/v1/internal/inventory/reserve": ["post"],
      "/api/v1/internal/inventory/release": ["post"],
      "/api/v1/internal/inventory/ship": ["post"],
    });

    expect(inventoryOpenApiPaths).not.toHaveProperty(
      "/api/v1/internal/inventory/commit",
    );
  });

  it("locks every implemented Module 19 Search route to its approved method set", () => {
    expectExactOpenApiSurface(searchDiscoveryOpenApiPaths, {
      "/api/v1/search/products": ["get"],
      "/api/v1/search/suggestions": ["get"],
      "/api/v1/search/stores": ["get"],
      "/api/v1/admin/search/reindex": ["post"],
      "/api/v1/admin/search/reindex/{id}": ["get"],
    });
  });

  it("locks Module 8 Cart and Wishlist to exactly the eight approved operations", () => {
    expectExactOpenApiSurface(cartWishlistOpenApiPaths, {
      "/api/v1/cart": ["get", "delete"],
      "/api/v1/cart/items": ["post"],
      "/api/v1/cart/items/{id}": ["patch", "delete"],
      "/api/v1/wishlist": ["get"],
      "/api/v1/wishlist/items": ["post"],
      "/api/v1/wishlist/items/{id}": ["delete"],
    });

    expect(cartWishlistOpenApiPaths).not.toHaveProperty("/api/v1/cart/reserve");
    expect(cartWishlistOpenApiPaths).not.toHaveProperty("/api/v1/cart/checkout");
    expect(cartWishlistOpenApiPaths).not.toHaveProperty(
      "/api/v1/wishlist/items/{id}/move-to-cart",
    );
  });

  it("locks Module 9 Promotions and Coupons to exactly the seven approved operations", () => {
    expectExactOpenApiSurface(promotionsOpenApiPaths, {
      "/api/v1/admin/promotions": ["get", "post"],
      "/api/v1/admin/promotions/{id}": ["patch"],
      "/api/v1/seller/promotions": ["post"],
      "/api/v1/promotions/validate": ["get"],
      "/api/v1/admin/promotions/{id}/activate": ["post"],
      "/api/v1/admin/promotions/{id}/deactivate": ["post"],
    });

    expect(promotionsOpenApiPaths).not.toHaveProperty("/api/v1/coupons");
    expect(promotionsOpenApiPaths).not.toHaveProperty("/api/v1/admin/promotions/{id}/delete");
  });

  it("locks Module 13 Shipping to exactly the seven approved Configuration and Fulfillment operations", () => {
    expectExactOpenApiSurface(shippingOpenApiPaths, {
      "/api/v1/checkout/shipping-options": ["get"],
      "/api/v1/seller/shipments": ["get"],
      "/api/v1/seller/orders/{sellerOrderId}/shipments": ["post"],
      "/api/v1/seller/shipments/{id}/tracking": ["patch"],
      "/api/v1/seller/shipments/{id}/mark-shipped": ["post"],
      "/api/v1/seller/shipments/{id}/mark-delivered": ["post"],
      "/api/v1/orders/{orderId}/shipments": ["get"],
    });

    const operation = shippingOpenApiPaths["/api/v1/checkout/shipping-options"].get;
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "addressId", in: "query", required: true }),
      ]),
    );

    for (const path of [
      "/api/v1/seller/orders/{sellerOrderId}/shipments",
      "/api/v1/seller/shipments/{id}/mark-shipped",
      "/api/v1/seller/shipments/{id}/mark-delivered",
    ] as const) {
      expect(shippingOpenApiPaths[path].post.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        ]),
      );
    }
  });

  it("locks Module 11 Orders to exactly the nine approved business operations", () => {
    expectExactOpenApiSurface(ordersOpenApiPaths, {
      "/api/v1/orders": ["get"],
      "/api/v1/orders/{id}": ["get"],
      "/api/v1/seller/orders": ["get"],
      "/api/v1/seller/orders/{id}": ["get"],
      "/api/v1/seller/orders/{id}/accept": ["post"],
      "/api/v1/orders/{id}/cancel": ["post"],
      "/api/v1/admin/orders/{id}/cancel": ["post"],
      "/api/v1/admin/orders": ["get"],
      "/api/v1/internal/orders/{id}/payment-confirmed": ["post"],
    });

    expect(ordersOpenApiPaths).not.toHaveProperty("/api/v1/orders/{id}/status");
    expect(ordersOpenApiPaths).not.toHaveProperty("/api/v1/seller/orders/{id}/delete");
  });

  it("locks Module 14 Returns, Refunds & Disputes to exactly the eight approved operations", () => {
    expectExactOpenApiSurface(returnsRefundsOpenApiPaths, {
      "/api/v1/orders/{orderId}/returns": ["post"],
      "/api/v1/returns": ["get"],
      "/api/v1/seller/returns": ["get"],
      "/api/v1/seller/returns/{id}/approve": ["post"],
      "/api/v1/seller/returns/{id}/reject": ["post"],
      "/api/v1/seller/returns/{id}/receive": ["post"],
      "/api/v1/returns/{id}/refund": ["post"],
      "/api/v1/admin/returns": ["get"],
    });

    expect(returnsRefundsOpenApiPaths["/api/v1/returns/{id}/refund"].post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
      ]),
    );

    const module14OpenApi = JSON.stringify(returnsRefundsOpenApiPaths);
    expect(module14OpenApi).toContain('"history"');
    expect(module14OpenApi).toContain('"toStatus"');
    expect(module14OpenApi).toContain('"changedAt"');

    for (const path of Object.keys(returnsRefundsOpenApiPaths)) {
      expect(path).not.toContain("/delete");
      expect(path).not.toContain("/status");
      expect(path).not.toContain("/dispute-notes");
      expect(path).not.toContain("/restock");
    }
  });


  it("locks Module 15 Reviews & Ratings to exactly the eight approved operations", () => {
    expectExactOpenApiSurface(reviewsOpenApiPaths, {
      "/api/v1/reviews": ["post"],
      "/api/v1/reviews/{id}": ["patch"],
      "/api/v1/products/{productId}/reviews": ["get"],
      "/api/v1/stores/{storeId}/reviews": ["get"],
      "/api/v1/reviews/{id}/helpful": ["post"],
      "/api/v1/admin/reviews": ["get"],
      "/api/v1/admin/reviews/{id}/hide": ["post"],
      "/api/v1/admin/reviews/{id}/publish": ["post"],
    });

    expect(reviewsOpenApiPaths).not.toHaveProperty("/api/v1/reviews/{id}/delete");
  });

  it("locks Module 18 Notifications to exactly the seven documented operations", () => {
    expectExactOpenApiSurface(notificationsOpenApiPaths, {
      "/api/v1/notifications": ["get"],
      "/api/v1/notifications/{id}/read": ["post"],
      "/api/v1/notifications/read-all": ["post"],
      "/api/v1/notifications/preferences": ["get", "put"],
      "/api/v1/admin/notification-deliveries": ["get"],
      "/api/v1/admin/notification-deliveries/{id}/retry": ["post"],
    });

    const module18OpenApi = JSON.stringify(notificationsOpenApiPaths);
    expect(module18OpenApi).toContain('"destinationMasked"');
    expect(module18OpenApi).not.toContain('"destination"');
  });

  it("locks Module 17 Seller Wallet & Payouts to exactly the nine approved operations", () => {
    expectExactOpenApiSurface(sellerWalletPayoutsOpenApiPaths, {
      "/api/v1/seller/wallet": ["get"],
      "/api/v1/seller/payouts": ["get", "post"],
      "/api/v1/seller/payout-accounts": ["post"],
      "/api/v1/admin/payouts": ["get"],
      "/api/v1/admin/payouts/{id}/approve": ["post"],
      "/api/v1/admin/payouts/{id}/send": ["post"],
      "/api/v1/internal/wallet/settle": ["post"],
      "/api/v1/internal/wallet/adjust": ["post"],
    });

    for (const path of [
      "/api/v1/seller/payouts",
      "/api/v1/admin/payouts/{id}/approve",
      "/api/v1/admin/payouts/{id}/send",
      "/api/v1/internal/wallet/settle",
      "/api/v1/internal/wallet/adjust",
    ] as const) {
      const method = sellerWalletPayoutsOpenApiPaths[path].post;
      expect(method.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        ]),
      );
    }

    expect(sellerWalletPayoutsOpenApiPaths["/api/v1/internal/wallet/settle"].post.security).toEqual([
      { internalApiKey: [] },
    ]);
    expect(sellerWalletPayoutsOpenApiPaths["/api/v1/internal/wallet/adjust"].post.security).toEqual([
      { internalApiKey: [] },
    ]);

    for (const path of Object.keys(sellerWalletPayoutsOpenApiPaths)) {
      expect(path).not.toContain("/delete");
      expect(path).not.toContain("/status");
      expect(path).not.toContain("/entries/create");
    }
  });

  it("keeps every Module 8 operation authenticated and every write body closed to extra client fields", () => {
    const operations = [
      ["/api/v1/cart", "get"],
      ["/api/v1/cart", "delete"],
      ["/api/v1/cart/items", "post"],
      ["/api/v1/cart/items/{id}", "patch"],
      ["/api/v1/cart/items/{id}", "delete"],
      ["/api/v1/wishlist", "get"],
      ["/api/v1/wishlist/items", "post"],
      ["/api/v1/wishlist/items/{id}", "delete"],
    ] as const;

    for (const [path, method] of operations) {
      const pathItem = cartWishlistOpenApiPaths[path as keyof typeof cartWishlistOpenApiPaths];
      const current = (pathItem as unknown as Record<string, Record<string, unknown>>)[method];
      expect(current?.security).toEqual([{ bearerAuth: [] }]);

      const responses = current?.responses as Record<string, unknown> | undefined;
      expect(responses?.["200"]).toBeTruthy();
      expect(responses?.["401"]).toBeTruthy();
      expect(responses?.["403"]).toBeTruthy();
    }

    for (const [path, method] of [
      ["/api/v1/cart/items", "post"],
      ["/api/v1/cart/items/{id}", "patch"],
      ["/api/v1/wishlist/items", "post"],
    ] as const) {
      const pathItem = cartWishlistOpenApiPaths[path as keyof typeof cartWishlistOpenApiPaths];
      const current = (pathItem as unknown as Record<string, Record<string, unknown>>)[method];
      const requestBody = current?.requestBody as
        | { content?: { "application/json"?: { schema?: { additionalProperties?: boolean } } } }
        | undefined;
      expect(
        requestBody?.content?.["application/json"]?.schema?.additionalProperties,
      ).toBe(false);
    }
  });
});

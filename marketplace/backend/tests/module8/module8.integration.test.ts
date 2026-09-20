import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import {
  CART_WISHLIST_ERROR_CODE,
  CART_WISHLIST_LIMITS,
  CART_WISHLIST_OUTBOX_EVENT,
} from "../../src/modules/cart-wishlist/cart-wishlist.constants.js";
import { PRODUCT_STATUS } from "../../src/modules/products/products.constants.js";
import {
  bearer,
  countCartWishlistOutboxEvents,
  createCartWishlistVariantFixture,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  loginUser,
  readInventoryQuantities,
  registerCustomer,
  resetModule8Tables,
  unpublishProductViaHttp,
  updateVariantViaHttp,
} from "./module8.test-helpers.js";

beforeEach(async () => {
  await resetModule8Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 8 repository/service/API integration", () => {
  it("enforces authentication and keeps Cart/Wishlist reads and writes inside the exact customer owner scope", async () => {
    const admin = await createPlatformAdmin(`module8-scope-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "Scope", {
      onHandQty: 10,
    });
    const customerA = await registerCustomer(`module8-scope-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module8-scope-b-${randomUUID()}@example.com`);
    const tokenA = await loginUser(customerA);
    const tokenB = await loginUser(customerB);
    const app = createApp();

    await request(app).get("/api/v1/cart").expect(401);
    await request(app).get("/api/v1/wishlist").expect(401);

    const cartA = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(tokenA))
      .send({ variantId: fixture.variant.id, quantity: 2 })
      .expect(200);
    const itemAId = String(cartA.body.data.items[0]?.id);

    const cartB = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(tokenB))
      .send({ variantId: fixture.variant.id, quantity: 5 })
      .expect(200);
    expect(cartB.body.data.items).toHaveLength(1);
    expect(cartB.body.data.items[0]).toMatchObject({ quantity: 5 });

    const hiddenUpdate = await request(app)
      .patch(`/api/v1/cart/items/${itemAId}`)
      .set(bearer(tokenB))
      .send({ quantity: 9 })
      .expect(404);
    expect(hiddenUpdate.body.error.code).toBe(CART_WISHLIST_ERROR_CODE.CART_ITEM_NOT_FOUND);

    const hiddenDelete = await request(app)
      .delete(`/api/v1/cart/items/${itemAId}`)
      .set(bearer(tokenB))
      .expect(404);
    expect(hiddenDelete.body.error.code).toBe(CART_WISHLIST_ERROR_CODE.CART_ITEM_NOT_FOUND);

    const ownedUpdate = await request(app)
      .patch(`/api/v1/cart/items/${itemAId}`)
      .set(bearer(tokenA))
      .send({ quantity: 3 })
      .expect(200);
    expect(ownedUpdate.body.data.items[0]).toMatchObject({ id: itemAId, quantity: 3 });

    const wishlistA = await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(tokenA))
      .send({ productId: fixture.product.id, variantId: fixture.variant.id })
      .expect(200);
    const wishlistItemAId = String(wishlistA.body.data.items[0]?.id);

    const hiddenWishlistDelete = await request(app)
      .delete(`/api/v1/wishlist/items/${wishlistItemAId}`)
      .set(bearer(tokenB))
      .expect(404);
    expect(hiddenWishlistDelete.body.error.code).toBe(ERROR_CODE.RESOURCE_NOT_FOUND);

    const ownedWishlistDelete = await request(app)
      .delete(`/api/v1/wishlist/items/${wishlistItemAId}`)
      .set(bearer(tokenA))
      .expect(200);
    expect(ownedWishlistDelete.body.data.items).toEqual([]);

    const customerACart = await request(app)
      .get("/api/v1/cart")
      .set(bearer(tokenA))
      .expect(200);
    expect(customerACart.body.data.items).toHaveLength(1);
    expect(customerACart.body.data.items[0]).toMatchObject({ id: itemAId, quantity: 3 });

    const customerBWishlist = await request(app)
      .get("/api/v1/wishlist")
      .set(bearer(tokenB))
      .expect(200);
    expect(customerBWishlist.body.data.items).toEqual([]);
  });

  it("merges duplicate variants and rejects invalid quantity, currency mismatch, unpublished Products, and inactive variants", async () => {
    const admin = await createPlatformAdmin(`module8-rules-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const pkr = await createPublishedCartWishlistFixture(adminToken, "RulesPkr", {
      currency: "PKR",
      onHandQty: 10,
    });
    const usd = await createPublishedCartWishlistFixture(adminToken, "RulesUsd", {
      currency: "USD",
      onHandQty: 10,
    });
    const draft = await createCartWishlistVariantFixture(adminToken, "Draft");
    const inactive = await createPublishedCartWishlistFixture(adminToken, "Inactive", {
      onHandQty: 10,
    });
    await updateVariantViaHttp(
      inactive.seller.ownerToken,
      inactive.product.id,
      inactive.variant.id,
      { status: PRODUCT_STATUS.INACTIVE },
    );

    const customer = await registerCustomer(`module8-rules-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const app = createApp();

    await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: pkr.variant.id, quantity: 2 })
      .expect(200);
    const merged = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: pkr.variant.id, quantity: 3 })
      .expect(200);
    expect(merged.body.data.items).toHaveLength(1);
    expect(merged.body.data.items[0]).toMatchObject({ quantity: 5 });

    const persistedLines = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from cart_items where variant_id = $1",
      [pkr.variant.id],
    );
    expect(persistedLines.rows[0]?.count).toBe(1);

    const schemaRejected = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: pkr.variant.id, quantity: 0 })
      .expect(422);
    expect(schemaRejected.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    const mergedQuantityRejected = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({
        variantId: pkr.variant.id,
        quantity: CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY,
      })
      .expect(400);
    expect(mergedQuantityRejected.body.error.code).toBe(
      CART_WISHLIST_ERROR_CODE.CART_QUANTITY_INVALID,
    );

    const currencyMismatch = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: usd.variant.id, quantity: 1 })
      .expect(409);
    expect(currencyMismatch.body.error.code).toBe(
      CART_WISHLIST_ERROR_CODE.CART_CURRENCY_MISMATCH,
    );

    const unpublished = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: draft.variant.id, quantity: 1 })
      .expect(409);
    expect(unpublished.body.error.code).toBe(
      CART_WISHLIST_ERROR_CODE.CART_PRODUCT_UNAVAILABLE,
    );

    const inactiveVariant = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: inactive.variant.id, quantity: 1 })
      .expect(409);
    expect(inactiveVariant.body.error.code).toBe(
      CART_WISHLIST_ERROR_CODE.CART_PRODUCT_UNAVAILABLE,
    );
  });

  it("proves Cart mutation does not reserve Inventory and always reflects current Product price and availability", async () => {
    const admin = await createPlatformAdmin(`module8-inventory-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createPublishedCartWishlistFixture(adminToken, "InventoryProof", {
      price: "100.00",
      onHandQty: 8,
    });
    const customer = await registerCustomer(`module8-inventory-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const app = createApp();

    const before = await readInventoryQuantities(fixture.variant.id);
    expect(before).toEqual({ onHandQty: 8, reservedQty: 0, availableQty: 8 });

    const added = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: fixture.variant.id, quantity: 3 })
      .expect(200);
    expect(added.body.data.items[0]).toMatchObject({
      storeId: fixture.seller.storeId,
      storeName: expect.any(String),
      storeSlug: expect.any(String),
      thumbnailFileId: null,
      currentUnitPrice: "100.00",
      previewLineSubtotal: "300.00",
      inStock: true,
    });

    const afterAdd = await readInventoryQuantities(fixture.variant.id);
    expect(afterAdd).toEqual(before);

    const reservationCount = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from stock_reservations where variant_id = $1",
      [fixture.variant.id],
    );
    expect(reservationCount.rows[0]?.count).toBe(0);

    await updateVariantViaHttp(
      fixture.seller.ownerToken,
      fixture.product.id,
      fixture.variant.id,
      { price: "125.50" },
    );

    const repriced = await request(app)
      .get("/api/v1/cart")
      .set(bearer(token))
      .expect(200);
    expect(repriced.body.data).toMatchObject({
      previewSubtotal: "376.50",
      hasUnavailableItems: false,
    });
    expect(repriced.body.data.items[0]).toMatchObject({
      currentUnitPrice: "125.50",
      previewLineSubtotal: "376.50",
      inStock: true,
    });

    await request(createApp())
      .post(`/api/v1/seller/inventory/${fixture.variant.id}/adjust`)
      .set(bearer(fixture.seller.ownerToken))
      .send({ quantityDelta: -8 })
      .expect(200);

    const unavailable = await request(app)
      .get("/api/v1/cart")
      .set(bearer(token))
      .expect(200);
    expect(unavailable.body.data.hasUnavailableItems).toBe(true);
    expect(unavailable.body.data.items[0]).toMatchObject({
      quantity: 3,
      currentUnitPrice: "125.50",
      inStock: false,
    });

    const afterStockChange = await readInventoryQuantities(fixture.variant.id);
    expect(afterStockChange).toEqual({ onHandQty: 0, reservedQty: 0, availableQty: 0 });
  });

  it("keeps Wishlist additions deterministic, validates Product/variant pairing, and never removes a saved item when Cart add fails", async () => {
    const admin = await createPlatformAdmin(`module8-wishlist-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const first = await createPublishedCartWishlistFixture(adminToken, "WishlistFirst", {
      onHandQty: 5,
    });
    const second = await createPublishedCartWishlistFixture(adminToken, "WishlistSecond", {
      onHandQty: 5,
    });
    const customer = await registerCustomer(`module8-wishlist-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const app = createApp();

    const firstAdd = await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(token))
      .send({ productId: first.product.id, variantId: first.variant.id })
      .expect(200);
    expect(firstAdd.body.data.items).toHaveLength(1);
    expect(firstAdd.body.data.items[0]).toMatchObject({
      storeId: first.seller.storeId,
      storeName: expect.any(String),
      storeSlug: expect.any(String),
      thumbnailFileId: null,
    });

    const duplicateAdd = await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(token))
      .send({ productId: first.product.id, variantId: first.variant.id })
      .expect(200);
    expect(duplicateAdd.body.data.items).toHaveLength(1);

    const invalidPair = await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(token))
      .send({ productId: first.product.id, variantId: second.variant.id })
      .expect(404);
    expect(invalidPair.body.error.code).toBe(ERROR_CODE.RESOURCE_NOT_FOUND);

    await unpublishProductViaHttp(first.seller.ownerToken, first.product.id);

    const cartRejected = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: first.variant.id, quantity: 1 })
      .expect(409);
    expect(cartRejected.body.error.code).toBe(
      CART_WISHLIST_ERROR_CODE.CART_PRODUCT_UNAVAILABLE,
    );

    const savedAfterFailure = await request(app)
      .get("/api/v1/wishlist")
      .set(bearer(token))
      .expect(200);
    expect(savedAfterFailure.body.data.items).toHaveLength(1);
    expect(savedAfterFailure.body.data.items[0]).toMatchObject({
      productId: first.product.id,
      variantId: first.variant.id,
      isPurchasable: false,
      inStock: false,
    });
  });

  it("writes only the required durable Cart/Wishlist events and keeps duplicate Wishlist adds event-idempotent", async () => {
    const admin = await createPlatformAdmin(`module8-events-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const first = await createPublishedCartWishlistFixture(adminToken, "EventsFirst", {
      onHandQty: 5,
    });
    const second = await createPublishedCartWishlistFixture(adminToken, "EventsSecond", {
      onHandQty: 5,
    });
    const customer = await registerCustomer(`module8-events-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const app = createApp();

    const firstCartAdd = await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: first.variant.id, quantity: 1 })
      .expect(200);
    const firstItemId = String(firstCartAdd.body.data.items[0]?.id);

    await request(app)
      .post("/api/v1/cart/items")
      .set(bearer(token))
      .send({ variantId: second.variant.id, quantity: 1 })
      .expect(200);
    expect(await countCartWishlistOutboxEvents(CART_WISHLIST_OUTBOX_EVENT.CART_ITEM_ADDED)).toBe(2);

    await request(app)
      .delete(`/api/v1/cart/items/${firstItemId}`)
      .set(bearer(token))
      .expect(200);
    expect(await countCartWishlistOutboxEvents(CART_WISHLIST_OUTBOX_EVENT.CART_ITEM_REMOVED)).toBe(1);

    const cleared = await request(app)
      .delete("/api/v1/cart")
      .set(bearer(token))
      .expect(200);
    expect(cleared.body.data.items).toEqual([]);
    expect(cleared.body.data.previewSubtotal).toBe("0.00");
    expect(await countCartWishlistOutboxEvents(CART_WISHLIST_OUTBOX_EVENT.CART_ITEM_REMOVED)).toBe(2);

    await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(token))
      .send({ productId: first.product.id })
      .expect(200);
    await request(app)
      .post("/api/v1/wishlist/items")
      .set(bearer(token))
      .send({ productId: first.product.id })
      .expect(200);
    expect(
      await countCartWishlistOutboxEvents(CART_WISHLIST_OUTBOX_EVENT.WISHLIST_ITEM_ADDED),
    ).toBe(1);
  });
});

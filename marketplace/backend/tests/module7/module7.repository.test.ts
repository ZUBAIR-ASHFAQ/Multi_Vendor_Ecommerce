import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { STOCK_RESERVATION_STATUS } from "../../src/modules/inventory/inventory.constants.js";
import { InventoryRepository } from "../../src/modules/inventory/inventory.repository.js";
import {
  adjustInventoryViaHttp,
  bearer,
  createCategoryViaHttp,
  createInventoryVariantFixture,
  createPlatformAdmin,
  createProductSellerFixture,
  loginUser,
  registerCustomer,
  reserveInventoryViaHttp,
  resetModule7Tables,
} from "./module7.test-helpers.js";

beforeEach(async () => {
  await resetModule7Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 7 repository persistence and scope", () => {
  it("keeps private Inventory reads inside the exact seller/store scope", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "InventoryRepoA");
    const sellerB = await createProductSellerFixture(adminToken, "InventoryRepoB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-repo-scope-${randomUUID()}`,
      name: "Module 7 Repository Scope",
    });
    const fixture = await createInventoryVariantFixture(
      sellerA.ownerToken,
      sellerA.storeId,
      String(category.id),
      "RepoScope",
    );
    await adjustInventoryViaHttp(sellerA.ownerToken, fixture.variant.id, 10);
    const repository = new InventoryRepository();

    await expect(
      repository.findInventoryItemByVariantInSellerScope(fixture.variant.id, {
        sellerIds: [sellerA.sellerId],
        storeIds: [sellerA.storeId],
      }),
    ).resolves.toMatchObject({
      sellerId: sellerA.sellerId,
      storeId: sellerA.storeId,
      variantId: fixture.variant.id,
      onHandQty: 10,
      reservedQty: 0,
    });
    await expect(
      repository.findInventoryItemByVariantInSellerScope(fixture.variant.id, {
        sellerIds: [sellerB.sellerId],
        storeIds: [sellerB.storeId],
      }),
    ).resolves.toBeNull();
  });

  it("keeps conditional quantity updates inside persisted stock invariants", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryRepoQty");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-repo-qty-${randomUUID()}`,
      name: "Module 7 Repository Quantity",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "RepoQty",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 5);
    const repository = new InventoryRepository();
    const scope = { sellerIds: [seller.sellerId], storeIds: [seller.storeId] };
    const item = await repository.findInventoryItemByVariantInSellerScope(
      fixture.variant.id,
      scope,
    );
    if (!item) throw new Error("Inventory repository fixture was not created.");

    await expect(repository.increaseReservedQuantity(item.id, 4)).resolves.toMatchObject({
      onHandQty: 5,
      reservedQty: 4,
    });
    await expect(
      repository.applyOnHandAdjustmentInSellerScope(fixture.variant.id, scope, -2),
    ).resolves.toBeNull();
    await expect(repository.increaseReservedQuantity(item.id, 2)).resolves.toBeNull();
    await expect(repository.decreaseReservedQuantity(item.id, 4)).resolves.toMatchObject({
      onHandQty: 5,
      reservedQty: 0,
    });
  });

  it("finds only expired uncommitted reservations in a bounded oldest-first batch", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryExpiryRepo");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-expiry-repo-${randomUUID()}`,
      name: "Module 7 Expiry Repository",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "ExpiryRepo",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 10);
    const customer = await registerCustomer(`module7-expiry-${randomUUID()}@example.com`);
    const now = Date.now();

    const firstExpired = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 1,
      sourceKey: `expiry-first-${randomUUID()}`,
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
    });
    const committed = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 1,
      sourceKey: `expiry-committed-${randomUUID()}`,
      expiresAt: new Date(now + 6 * 60_000).toISOString(),
    });
    const secondExpired = await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 1,
      sourceKey: `expiry-second-${randomUUID()}`,
      expiresAt: new Date(now + 7 * 60_000).toISOString(),
    });
    await reserveInventoryViaHttp({
      variantId: fixture.variant.id,
      customerUserId: customer.id,
      quantity: 1,
      sourceKey: `expiry-active-${randomUUID()}`,
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    });

    const repository = new InventoryRepository();
    await repository.updateReservationStatus(
      String(committed.id),
      STOCK_RESERVATION_STATUS.COMMITTED,
    );
    const sweepTime = new Date(now + 10 * 60_000);

    const firstBatch = await repository.findExpiredReservedReservations(sweepTime, 1);
    expect(firstBatch.map((reservation) => reservation.id)).toEqual([String(firstExpired.id)]);

    const allExpired = await repository.findExpiredReservedReservations(sweepTime, 10);
    expect(allExpired.map((reservation) => reservation.id)).toEqual([
      String(firstExpired.id),
      String(secondExpired.id),
    ]);
    expect(
      allExpired.every(
        (reservation) => reservation.status === STOCK_RESERVATION_STATUS.RESERVED,
      ),
    ).toBe(true);
  });

  it("enforces Product variant seller/store ownership at the database boundary", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "InventoryTriggerA");
    const sellerB = await createProductSellerFixture(adminToken, "InventoryTriggerB");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-trigger-${randomUUID()}`,
      name: "Module 7 Trigger Scope",
    });
    const fixture = await createInventoryVariantFixture(
      sellerA.ownerToken,
      sellerA.storeId,
      String(category.id),
      "Trigger",
    );
    const repository = new InventoryRepository();

    await expect(
      repository.createInventoryItemIfMissing({
        sellerId: sellerB.sellerId,
        storeId: sellerB.storeId,
        variantId: fixture.variant.id,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps stock movement history append-only and seller-scoped", async () => {
    const admin = await createPlatformAdmin();
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "InventoryLedger");
    const category = await createCategoryViaHttp(adminToken, {
      slug: `module7-ledger-${randomUUID()}`,
      name: "Module 7 Ledger",
    });
    const fixture = await createInventoryVariantFixture(
      seller.ownerToken,
      seller.storeId,
      String(category.id),
      "Ledger",
    );
    await adjustInventoryViaHttp(seller.ownerToken, fixture.variant.id, 8);
    const repository = new InventoryRepository();

    const history = await repository.listMovementsByVariantInSellerScope(
      fixture.variant.id,
      { sellerIds: [seller.sellerId], storeIds: [seller.storeId] },
      { page: 1, pageSize: 20 },
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ movementType: "adjustment", quantityDelta: 8 });

    const movementId = history.items[0]?.id;
    if (!movementId) throw new Error("Movement history did not return an id.");
    await expect(
      databasePool.query("update stock_movements set quantity_delta = 99 where id = $1", [
        movementId,
      ]),
    ).rejects.toThrow();
    await expect(
      databasePool.query("delete from stock_movements where id = $1", [movementId]),
    ).rejects.toThrow();

    const response = await request(createApp())
      .get(`/api/v1/seller/inventory/${fixture.variant.id}/movements`)
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(response.body.data).toHaveLength(1);
  });
});

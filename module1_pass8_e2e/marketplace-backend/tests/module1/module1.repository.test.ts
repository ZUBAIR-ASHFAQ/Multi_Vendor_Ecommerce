import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { SELLER_ORDER_STATUS } from "../../src/modules/orders/orders.constants.js";
import { DashboardRepository } from "../../src/modules/dashboard/dashboard.repository.js";
import { prepareCapturedCommissionFixture, resetModule16Tables } from "../module16/module16.test-helpers.js";

/** Clears Dashboard-owned rows after prerequisite cleanup so repository tests always start empty. */
async function resetDashboardTables(): Promise<void> {
  await resetModule16Tables();
  await databasePool.query(`
    TRUNCATE TABLE
      dashboard_saved_filters,
      dashboard_preferences
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await resetDashboardTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 1 Dashboard repository boundaries", () => {
  it("persists preferences and saved filters only for the requested user", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Dashboard repository fixture is missing its seller.");
    const repository = new DashboardRepository();
    const updatedAt = new Date("2026-09-17T08:00:00.000Z");

    const preference = await repository.upsertPreferences(
      fixture.order.customer.id,
      {
        layoutJson: {
          widgets: [{ widgetCode: "executive_kpis", order: 0, visible: true }],
        },
        defaultDateRange: "last_30_days",
        defaultStoreId: seller.storeId,
      },
      updatedAt,
    );
    expect(preference).toMatchObject({
      userId: fixture.order.customer.id,
      defaultDateRange: "last_30_days",
      defaultStoreId: seller.storeId,
      updatedAt,
    });

    const savedFilters = await repository.replaceSavedFilters(
      fixture.order.customer.id,
      [
        {
          name: "Primary store",
          filterJson: { sellerId: seller.sellerId, storeId: seller.storeId },
        },
      ],
      updatedAt,
    );
    expect(savedFilters).toHaveLength(1);
    expect(savedFilters[0]).toMatchObject({
      userId: fixture.order.customer.id,
      name: "Primary store",
    });

    expect(await repository.findPreferencesByUserId(fixture.order.customer.id)).not.toBeNull();
    expect(await repository.listSavedFiltersByUserId(fixture.order.customer.id)).toHaveLength(1);
    expect(await repository.findPreferencesByUserId(seller.owner.id)).toBeNull();
    expect(await repository.listSavedFiltersByUserId(seller.owner.id)).toEqual([]);
  });

  it("enforces seller and store scope for current low-stock reads", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const seller = fixture.order.sellers[0]?.product.seller;
    const variant = fixture.order.sellers[0]?.product.variant;
    if (!seller || !variant) throw new Error("Dashboard low-stock fixture is incomplete.");
    const repository = new DashboardRepository();

    await databasePool.query(
      `update inventory_items set reorder_level = 100 where variant_id = $1`,
      [variant.id],
    );

    const ownScope = { sellerIds: [seller.sellerId], storeIds: [seller.storeId] };
    expect(await repository.countLowStockVariants({}, ownScope)).toBe(1);
    const ownRows = await repository.listLowStockSources({}, ownScope, 10);
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]).toMatchObject({
      sellerId: seller.sellerId,
      storeId: seller.storeId,
      variantId: variant.id,
      sku: variant.sku,
    });

    const foreignSellerScope = { sellerIds: [randomUUID()], storeIds: [seller.storeId] };
    expect(await repository.countLowStockVariants({}, foreignSellerScope)).toBe(0);
    expect(await repository.listLowStockSources({}, foreignSellerScope, 10)).toEqual([]);

    const foreignStoreScope = { sellerIds: [seller.sellerId], storeIds: [randomUUID()] };
    expect(await repository.countLowStockVariants({}, foreignStoreScope)).toBe(0);
    expect(await repository.listLowStockSources({}, foreignStoreScope, 10)).toEqual([]);
  });

  it("enforces seller/store scope before surfacing fulfillment attention rows", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Dashboard fulfillment fixture is missing its seller.");
    const repository = new DashboardRepository();

    const own = await repository.listFulfillmentSources(
      {},
      { sellerIds: [seller.sellerId], storeIds: [seller.storeId] },
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE],
      [],
      10,
    );
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      sellerId: seller.sellerId,
      storeId: seller.storeId,
      status: SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
    });

    const foreign = await repository.listFulfillmentSources(
      {},
      { sellerIds: [randomUUID()], storeIds: [randomUUID()] },
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE],
      [],
      10,
    );
    expect(foreign).toEqual([]);
  });
});

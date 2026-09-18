import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import {
  SHIPMENT_STATUS,
} from "../../src/modules/shipping/shipping.constants.js";
import {
  ShippingRepository,
  type ShippingSellerScope,
} from "../../src/modules/shipping/shipping.repository.js";
import { sellerShipmentListQuerySchema } from "../../src/modules/shipping/shipping.schema.js";
import { prepareOrderFixture } from "../module11/module11.test-helpers.js";
import {
  createPlatformAdmin,
  createProductSellerFixture,
  insertShippingMethod,
  loginUser,
  resetModule13Tables,
} from "./module13.test-helpers.js";

interface FulfillmentOrderItemRow {
  sellerOrderId: string;
  sellerId: string;
  storeId: string;
  orderItemId: string;
}

/** Creates the immutable human-readable Shipment number required by the persistence contract. */
function shipmentNumber(shipmentId: string): string {
  return `SHP-${shipmentId.replaceAll("-", "").toUpperCase()}`;
}

/** Converts one prepared seller fixture into the exact server-derived repository scope shape. */
function sellerScope(sellerId: string, storeId: string): ShippingSellerScope {
  return { sellerIds: [sellerId], storeIds: [storeId] };
}

/** Reads Seller Order and Order Item identities created by the real Module 11 Checkout/Orders fixture. */
async function readFulfillmentOrderItems(orderId: string): Promise<FulfillmentOrderItemRow[]> {
  const result = await databasePool.query<{
    seller_order_id: string;
    seller_id: string;
    store_id: string;
    order_item_id: string;
  }>(
    `select seller_order.id as seller_order_id,
            seller_order.seller_id,
            seller_order.store_id,
            item.id as order_item_id
       from seller_orders seller_order
       join order_items item on item.seller_order_id = seller_order.id
      where seller_order.order_id = $1
      order by seller_order.id asc, item.id asc`,
    [orderId],
  );

  return result.rows.map((row) => ({
    sellerOrderId: row.seller_order_id,
    sellerId: row.seller_id,
    storeId: row.store_id,
    orderItemId: row.order_item_id,
  }));
}

beforeEach(async () => {
  await resetModule13Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 13 Shipping Core repository boundaries", () => {
  it("returns only active flat methods for the requested currency and server-derived sellers", async () => {
    const admin = await createPlatformAdmin(
      `module13-repo-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const sellerA = await createProductSellerFixture(adminToken, "ShippingRepoA");
    const sellerB = await createProductSellerFixture(adminToken, "ShippingRepoB");

    const platformMethod = await insertShippingMethod({
      ownerType: "platform",
      sellerId: null,
      code: "PLATFORM-CORE",
      baseRate: "12.3400",
      currency: "PKR",
      status: "active",
    });
    const sellerAMethod = await insertShippingMethod({
      ownerType: "seller",
      sellerId: sellerA.sellerId,
      code: "SELLER-A-CORE",
      baseRate: "7.5000",
      currency: "PKR",
      status: "active",
    });
    await insertShippingMethod({
      ownerType: "seller",
      sellerId: sellerA.sellerId,
      code: "SELLER-A-PAUSED",
      currency: "PKR",
      status: "inactive",
    });
    await insertShippingMethod({
      ownerType: "seller",
      sellerId: sellerB.sellerId,
      code: "SELLER-B-CORE",
      currency: "PKR",
      status: "active",
    });
    await insertShippingMethod({
      ownerType: "platform",
      sellerId: null,
      code: "USD-PLATFORM",
      currency: "USD",
      status: "active",
    });

    const repository = new ShippingRepository();
    const methods = await repository.listCheckoutEligibleMethods("PKR", [
      sellerA.sellerId,
    ]);

    expect(methods).toEqual([
      expect.objectContaining({
        id: platformMethod.id,
        ownerType: "platform",
        currency: "PKR",
        status: "active",
      }),
      expect.objectContaining({
        id: sellerAMethod.id,
        ownerType: "seller",
        sellerId: sellerA.sellerId,
        currency: "PKR",
        status: "active",
      }),
    ]);
    expect(methods.some((method) => method.sellerId === sellerB.sellerId)).toBe(false);
  });

  it("keeps owner, flat pricing, lifecycle, currency, and non-negative rate integrity in PostgreSQL", async () => {
    const admin = await createPlatformAdmin(
      `module13-constraints-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const seller = await createProductSellerFixture(adminToken, "ShippingConstraints");

    await expect(
      insertShippingMethod({
        ownerType: "platform",
        sellerId: seller.sellerId,
        code: "INVALID-PLATFORM-OWNER",
      }),
    ).rejects.toThrow();

    await expect(
      insertShippingMethod({
        ownerType: "seller",
        sellerId: null,
        code: "INVALID-SELLER-OWNER",
      }),
    ).rejects.toThrow();

    await expect(
      insertShippingMethod({
        ownerType: "seller",
        sellerId: seller.sellerId,
        code: "INVALID-NEGATIVE-RATE",
        baseRate: "-0.0001",
      }),
    ).rejects.toThrow();

    await expect(
      databasePool.query(
        `insert into shipping_methods
          (owner_type, code, name, pricing_type, base_rate, currency, status)
         values ('platform', 'BAD-PRICE', 'Bad Pricing', 'weight', 1.0000, 'PKR', 'active')`,
      ),
    ).rejects.toThrow();

    await expect(
      databasePool.query(
        `insert into shipping_methods
          (owner_type, code, name, pricing_type, base_rate, currency, status)
         values ('platform', 'BAD-CURRENCY', 'Bad Currency', 'flat', 1.0000, 'pkr', 'active')`,
      ),
    ).rejects.toThrow();

    await expect(
      databasePool.query(
        `insert into shipping_methods
          (owner_type, code, name, pricing_type, base_rate, currency, status)
         values ('platform', 'BAD-STATUS', 'Bad Status', 'flat', 1.0000, 'PKR', 'paused')`,
      ),
    ).rejects.toThrow();

    const count = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from shipping_methods",
    );
    expect(count.rows[0]?.count).toBe(0);
  });
});

describe("Module 13 fulfillment repository boundaries", () => {
  it("keeps seller Shipment headers, items, history, and writes inside exact seller/store scope", async () => {
    const fixture = await prepareOrderFixture({ sellerCount: 2, quantities: [2, 1] });
    const rows = await readFulfillmentOrderItems(fixture.orderId);
    expect(rows).toHaveLength(2);

    const sellerARow = rows.find(
      (row) => row.sellerId === fixture.sellers[0]?.product.seller.sellerId,
    );
    const sellerBRow = rows.find(
      (row) => row.sellerId === fixture.sellers[1]?.product.seller.sellerId,
    );
    if (!sellerARow || !sellerBRow) throw new Error("Expected two Seller Order rows.");

    const repository = new ShippingRepository();
    const scopeA = sellerScope(sellerARow.sellerId, sellerARow.storeId);
    const scopeB = sellerScope(sellerBRow.sellerId, sellerBRow.storeId);
    const shipmentAId = randomUUID();
    const shipmentBId = randomUUID();

    const shipmentA = await repository.createShipmentInScope(
      {
        id: shipmentAId,
        sellerOrderId: sellerARow.sellerOrderId,
        shipmentNo: shipmentNumber(shipmentAId),
        status: SHIPMENT_STATUS.CREATED,
      },
      scopeA,
    );
    expect(shipmentA).toMatchObject({ id: shipmentAId, sellerOrderId: sellerARow.sellerOrderId });

    await expect(
      repository.createShipmentInScope(
        {
          id: randomUUID(),
          sellerOrderId: sellerBRow.sellerOrderId,
          shipmentNo: shipmentNumber(randomUUID()),
          status: SHIPMENT_STATUS.CREATED,
        },
        scopeA,
      ),
    ).resolves.toBeNull();

    const shipmentB = await repository.createShipmentInScope(
      {
        id: shipmentBId,
        sellerOrderId: sellerBRow.sellerOrderId,
        shipmentNo: shipmentNumber(shipmentBId),
        status: SHIPMENT_STATUS.CREATED,
      },
      scopeB,
    );
    expect(shipmentB).toMatchObject({ id: shipmentBId, sellerOrderId: sellerBRow.sellerOrderId });

    await repository.createShipmentItemsInScope(
      shipmentAId,
      [{ orderItemId: sellerARow.orderItemId, quantity: 1 }],
      scopeA,
    );
    await repository.createShipmentItemsInScope(
      shipmentBId,
      [{ orderItemId: sellerBRow.orderItemId, quantity: 1 }],
      scopeB,
    );
    await repository.appendStatusHistoryInScope(
      shipmentAId,
      {
        status: SHIPMENT_STATUS.CREATED,
        source: "repository-test",
        occurredAt: new Date("2026-09-15T00:00:00.000Z"),
      },
      scopeA,
    );
    await repository.appendStatusHistoryInScope(
      shipmentBId,
      {
        status: SHIPMENT_STATUS.CREATED,
        source: "repository-test",
        occurredAt: new Date("2026-09-15T00:00:01.000Z"),
      },
      scopeB,
    );

    const query = sellerShipmentListQuerySchema.parse({ page: 1, pageSize: 20 });
    const sellerAList = await repository.listSellerShipments(scopeA, query);
    expect(sellerAList.totalItems).toBe(1);
    expect(sellerAList.items.map((row) => row.id)).toEqual([shipmentAId]);

    await expect(repository.findShipmentInScope(shipmentBId, scopeA)).resolves.toBeNull();
    await expect(repository.findShipmentInScope(shipmentAId, scopeA)).resolves.toMatchObject({
      id: shipmentAId,
    });

    const sellerAItems = await repository.listSellerShipmentItems(
      [shipmentAId, shipmentBId],
      scopeA,
    );
    expect(sellerAItems).toEqual([
      expect.objectContaining({ shipmentId: shipmentAId, orderItemId: sellerARow.orderItemId }),
    ]);

    const sellerAHistory = await repository.listSellerShipmentHistory(
      [shipmentAId, shipmentBId],
      scopeA,
    );
    expect(sellerAHistory).toEqual([
      expect.objectContaining({ shipmentId: shipmentAId, status: SHIPMENT_STATUS.CREATED }),
    ]);

    await expect(
      repository.updateTrackingInScope(
        shipmentBId,
        { carrier: "Carrier", trackingNo: "TRACK-B", serviceLevel: null },
        scopeA,
      ),
    ).resolves.toBeNull();
  });

  it("serializes and sums immutable allocation rows without deciding fulfillment eligibility", async () => {
    const fixture = await prepareOrderFixture({ quantities: [3] });
    const [row] = await readFulfillmentOrderItems(fixture.orderId);
    if (!row) throw new Error("Expected one fulfillment Order Item row.");

    const scope = sellerScope(row.sellerId, row.storeId);
    const shipmentId = randomUUID();

    await db.transaction(async (transaction) => {
      const repository = new ShippingRepository().using(transaction);
      await repository.lockShipmentAllocations([row.orderItemId, row.orderItemId]);
      const shipment = await repository.createShipmentInScope(
        {
          id: shipmentId,
          sellerOrderId: row.sellerOrderId,
          shipmentNo: shipmentNumber(shipmentId),
          status: SHIPMENT_STATUS.CREATED,
        },
        scope,
      );
      expect(shipment?.id).toBe(shipmentId);

      await repository.createShipmentItemsInScope(
        shipmentId,
        [{ orderItemId: row.orderItemId, quantity: 2 }],
        scope,
      );

      const totals = await repository.sumAllocatedQuantitiesInScope(
        row.sellerOrderId,
        [row.orderItemId],
        scope,
      );
      expect(totals).toEqual([
        { orderItemId: row.orderItemId, allocatedQuantity: 2 },
      ]);
    });
  });

  it("returns only shipped/delivered customer-safe persistence rows for an already-authorized Order", async () => {
    const fixture = await prepareOrderFixture({ quantities: [2] });
    const [row] = await readFulfillmentOrderItems(fixture.orderId);
    if (!row) throw new Error("Expected one fulfillment Order Item row.");

    const repository = new ShippingRepository();
    const scope = sellerScope(row.sellerId, row.storeId);
    const shipmentId = randomUUID();
    const createdAt = new Date("2026-09-15T01:00:00.000Z");
    const shippedAt = new Date("2026-09-15T02:00:00.000Z");

    await repository.createShipmentInScope(
      {
        id: shipmentId,
        sellerOrderId: row.sellerOrderId,
        shipmentNo: shipmentNumber(shipmentId),
        status: SHIPMENT_STATUS.CREATED,
      },
      scope,
    );
    await repository.createShipmentItemsInScope(
      shipmentId,
      [{ orderItemId: row.orderItemId, quantity: 1 }],
      scope,
    );
    await repository.appendStatusHistoryInScope(
      shipmentId,
      { status: SHIPMENT_STATUS.CREATED, source: "repository-test", occurredAt: createdAt },
      scope,
    );

    await expect(repository.listCustomerVisibleShipmentsForOrder(fixture.orderId)).resolves.toEqual([]);

    await repository.updateTrackingInScope(
      shipmentId,
      { carrier: " Test Carrier ".trim(), trackingNo: " TRACK-1 ".trim(), serviceLevel: "Express" },
      scope,
    );
    await repository.updateLifecycleInScope(
      shipmentId,
      { status: SHIPMENT_STATUS.SHIPPED, shippedAt },
      scope,
    );
    await repository.appendStatusHistoryInScope(
      shipmentId,
      { status: SHIPMENT_STATUS.SHIPPED, source: "repository-test", occurredAt: shippedAt },
      scope,
    );

    const visibleShipments = await repository.listCustomerVisibleShipmentsForOrder(
      fixture.orderId,
    );
    expect(visibleShipments).toEqual([
      expect.objectContaining({ id: shipmentId, status: SHIPMENT_STATUS.SHIPPED }),
    ]);

    const visibleItems = await repository.listCustomerVisibleShipmentItemsForOrder(
      fixture.orderId,
      [shipmentId],
    );
    expect(visibleItems).toEqual([
      expect.objectContaining({ shipmentId, orderItemId: row.orderItemId, quantity: 1 }),
    ]);

    const visibleHistory = await repository.listCustomerVisibleShipmentHistoryForOrder(
      fixture.orderId,
      [shipmentId],
    );
    expect(visibleHistory).toEqual([
      expect.objectContaining({ shipmentId, status: SHIPMENT_STATUS.SHIPPED }),
    ]);
    expect(visibleHistory.some((entry) => entry.status === SHIPMENT_STATUS.CREATED)).toBe(false);
  });
});

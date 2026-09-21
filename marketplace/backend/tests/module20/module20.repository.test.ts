import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { SELLER_ORDER_STATUS } from "../../src/modules/orders/orders.constants.js";
import { PAYMENT_STATUS } from "../../src/modules/payments/payments.constants.js";
import {
  REPORT_CODE,
  REPORT_OUTPUT_FORMAT,
} from "../../src/modules/reports/reports.constants.js";
import { ReportsRepository } from "../../src/modules/reports/reports.repository.js";
import {
  inventoryReportQuerySchema,
  salesReportQuerySchema,
} from "../../src/modules/reports/reports.schema.js";
import {
  prepareCapturedCommissionFixture,
  resetModule16Tables,
} from "../module16/module16.test-helpers.js";
import { resetModule20ReportTables } from "./module20.test-helpers.js";

/** Reads a scalar table count so report reads can prove they never mutate transactional sources. */
async function tableCount(tableName: "orders" | "seller_orders" | "payments" | "inventory_items"): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count from ${tableName}`,
  );
  return result.rows[0]?.count ?? 0;
}

beforeEach(async () => {
  await resetModule16Tables();
  await resetModule20ReportTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 20 Reports repository boundaries", () => {
  it("enforces seller/store scope in SQL while keeping GMV and captured seller-order value exact and read-only", async () => {
    const fixture = await prepareCapturedCommissionFixture({
      sellerCount: 1,
      quantities: [2],
      prices: ["100.00"],
      shippingRates: ["10.0000"],
    });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Module 20 repository fixture is missing its seller.");
    const repository = new ReportsRepository();
    const query = salesReportQuerySchema.parse({ page: 1, pageSize: 20, currency: "PKR" });
    const allowedScope = { sellerIds: [seller.sellerId], storeIds: [seller.storeId] };
    const foreignScope = { sellerIds: [randomUUID()], storeIds: [randomUUID()] };
    const sourceCountsBefore = {
      orders: await tableCount("orders"),
      sellerOrders: await tableCount("seller_orders"),
      payments: await tableCount("payments"),
      inventory: await tableCount("inventory_items"),
    };

    const page = await repository.listSalesRows(
      query,
      allowedScope,
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE, SELLER_ORDER_STATUS.PROCESSING],
    );
    expect(page.totalItems).toBe(1);
    expect(page.items[0]).toMatchObject({
      sellerId: seller.sellerId,
      storeId: seller.storeId,
      currency: "PKR",
      sellerOrderStatus: SELLER_ORDER_STATUS.PENDING_ACCEPTANCE,
    });

    const gmv = await repository.sumSalesGmv(
      query,
      allowedScope,
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE, SELLER_ORDER_STATUS.PROCESSING],
    );
    const captured = await repository.sumCapturedSellerOrderValue(
      query,
      allowedScope,
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE, SELLER_ORDER_STATUS.PROCESSING],
      [PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.PARTIALLY_REFUNDED, PAYMENT_STATUS.REFUNDED],
    );
    expect(gmv).toEqual([{ currency: "PKR", amount: page.items[0]?.grandTotal }]);
    expect(captured).toEqual(gmv);

    const foreignPage = await repository.listSalesRows(
      query,
      foreignScope,
      [SELLER_ORDER_STATUS.PENDING_ACCEPTANCE, SELLER_ORDER_STATUS.PROCESSING],
    );
    expect(foreignPage).toEqual({ items: [], totalItems: 0 });

    expect({
      orders: await tableCount("orders"),
      sellerOrders: await tableCount("seller_orders"),
      payments: await tableCount("payments"),
      inventory: await tableCount("inventory_items"),
    }).toEqual(sourceCountsBefore);
  });

  it("keeps current Inventory rows inside both seller and store scope and never invents aging data", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Module 20 inventory fixture is missing its seller.");
    const repository = new ReportsRepository();
    const query = inventoryReportQuerySchema.parse({ page: 1, pageSize: 20 });

    const own = await repository.listInventoryRows(query, {
      sellerIds: [seller.sellerId],
      storeIds: [seller.storeId],
    });
    expect(own.totalItems).toBeGreaterThan(0);
    expect(own.items.every((row) => row.sellerId === seller.sellerId && row.storeId === seller.storeId)).toBe(true);
    expect(own.items.every((row) => !("ageDays" in row) && !("inventoryAge" in row))).toBe(true);

    const foreignStore = await repository.listInventoryRows(query, {
      sellerIds: [seller.sellerId],
      storeIds: [randomUUID()],
    });
    expect(foreignStore).toEqual({ items: [], totalItems: 0 });
  });

  it("persists asynchronous run transitions monotonically and refuses terminal replay transitions", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const repository = new ReportsRepository();
    const created = await repository.createReportRun({
      reportCode: REPORT_CODE.SALES,
      requestedBy: fixture.order.customer.id,
      filtersJson: { request: {}, scope: { sellerIds: null, storeIds: null } },
      outputFormat: REPORT_OUTPUT_FORMAT.CSV,
    });
    expect(created.status).toBe("queued");

    const history = await repository.listReportRunsByRequester(fixture.order.customer.id, {
      page: 1,
      pageSize: 6,
    });
    expect(history.totalItems).toBe(1);
    expect(history.items[0]?.id).toBe(created.id);

    const startedAt = new Date(created.createdAt.getTime() + 1_000);
    const processing = await repository.markReportRunProcessing(created.id, startedAt);
    expect(processing?.status).toBe("processing");
    await expect(repository.markReportRunProcessing(created.id, startedAt)).resolves.toBeNull();

    const fileResult = await databasePool.query<{ id: string }>(
      `insert into files
        (object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
       values ($1, 'report_export', 'sales.csv', 'text/csv', 1, $2, 'confirmed')
       returning id`,
      [`module20-repository/${randomUUID()}`, fixture.order.customer.id],
    );
    const fileId = fileResult.rows[0]?.id;
    if (!fileId) throw new Error("Module 20 repository fixture did not create a generated file.");

    const finishedAt = new Date(startedAt.getTime() + 1_000);
    const completed = await repository.markReportRunCompleted(created.id, fileId, finishedAt);
    expect(completed).toMatchObject({ status: "completed", fileId, errorCode: null });
    await expect(repository.markReportRunFailed(created.id, "REPORT_EXPORT_FAILED", finishedAt)).resolves.toBeNull();
    expect((await repository.findReportRunById(created.id))?.status).toBe("completed");
  });
});

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closeDatabase } from "../../src/database/db.js";
import { DASHBOARD_PATH } from "../../src/modules/dashboard/dashboard.constants.js";
import { REPORTS_PATH } from "../../src/modules/reports/reports.constants.js";
import { bearer } from "../module4/module4.test-helpers.js";
import { prepareCapturedCommissionFixture } from "../module16/module16.test-helpers.js";
import { resetModule1HttpTables } from "./module1.test-helpers.js";

beforeEach(async () => {
  await resetModule1HttpTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 1 Dashboard cross-module integration", () => {
  it("matches Dashboard seller GMV/order KPIs to the stable Module 20 Sales source", async () => {
    const fixture = await prepareCapturedCommissionFixture({
      sellerCount: 1,
      quantities: [2],
      prices: ["125.00"],
      shippingRates: ["10.0000"],
    });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Dashboard integration fixture is missing its seller.");
    const app = createApp();
    const scope = `sellerId=${seller.sellerId}&storeId=${seller.storeId}`;

    const reports = await request(app)
      .get(`${REPORTS_PATH.SALES}?${scope}`)
      .set(bearer(seller.ownerToken))
      .expect(200);
    const dashboard = await request(app)
      .get(`${DASHBOARD_PATH.SUMMARY}?${scope}`)
      .set(bearer(seller.ownerToken))
      .expect(200);

    expect(dashboard.body.data.orderCount).toBe(reports.body.data.summary.orderCount);
    expect(dashboard.body.data.gmvByCurrency).toEqual(reports.body.data.summary.gmvByCurrency);
    expect(dashboard.body.data.finance).toBeNull();
  });

  it("keeps one parent Order count while its seller-order GMV is aggregated exactly once in the Dashboard trend", async () => {
    const fixture = await prepareCapturedCommissionFixture({
      sellerCount: 2,
      quantities: [1, 1],
      prices: ["100.00", "50.00"],
      shippingRates: ["10.0000", "20.0000"],
    });
    const app = createApp();

    const response = await request(app)
      .get(DASHBOARD_PATH.ORDERS)
      .set(bearer(fixture.order.adminToken))
      .expect(200);

    const totalOrders = response.body.data.statusCounts.reduce(
      (sum: number, item: { count: number }) => sum + item.count,
      0,
    );
    expect(totalOrders).toBe(1);

    const trendOrderCount = response.body.data.trend.reduce(
      (sum: number, item: { orderCount: number }) => sum + item.orderCount,
      0,
    );
    expect(trendOrderCount).toBe(1);

    const expectedGmv = fixture.order.quote.grandTotal;
    expect(response.body.data.trend).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: fixture.order.quote.currency, gmv: expectedGmv }),
      ]),
    );
  });

  it("returns finance fields only to the platform actor while preserving separate money concepts", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 1 });
    const seller = fixture.order.sellers[0]?.product.seller;
    if (!seller) throw new Error("Dashboard finance fixture is missing its seller.");
    const app = createApp();

    const sellerSummary = await request(app)
      .get(`${DASHBOARD_PATH.SUMMARY}?sellerId=${seller.sellerId}`)
      .set(bearer(seller.ownerToken))
      .expect(200);
    expect(sellerSummary.body.data.finance).toBeNull();

    const adminSummary = await request(app)
      .get(DASHBOARD_PATH.SUMMARY)
      .set(bearer(fixture.order.adminToken))
      .expect(200);
    expect(adminSummary.body.data.finance).not.toBeNull();
    expect(adminSummary.body.data.finance).toHaveProperty("capturedCashByCurrency");
    expect(adminSummary.body.data.finance).toHaveProperty("refundedPaymentsByCurrency");
    expect(adminSummary.body.data.finance).toHaveProperty("marketplaceCommissionRevenueByCurrency");
    expect(adminSummary.body.data.finance).toHaveProperty("sellerPayableByCurrency");
    expect(adminSummary.body.data.finance).toHaveProperty("sellerPayoutsPaidByCurrency");
  });
});

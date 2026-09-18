import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  DASHBOARD_ERROR_CODE,
  DASHBOARD_PATH,
} from "../../src/modules/dashboard/dashboard.constants.js";
import {
  dashboardAlertsResponseSchema,
  dashboardOrdersResponseSchema,
  dashboardPreferencesResponseSchema,
  dashboardSellersResponseSchema,
  dashboardSummaryResponseSchema,
} from "../../src/modules/dashboard/dashboard.schema.js";
import { openApiDocument } from "../../src/http/openapi/openapi.document.js";
import {
  bearer,
  createApprovedSeller,
  createPlatformAdmin,
  createStoreViaHttp,
  loginUser,
  registerCustomer,
} from "../module4/module4.test-helpers.js";
import {
  countDashboardAuditActions,
  countDashboardOutboxEvents,
  countDashboardSavedFilters,
  readDashboardPreference,
  resetModule1HttpTables,
} from "./module1.test-helpers.js";

/** Creates an administrator plus two sellers with one isolated store each. */
async function createDashboardHttpActors() {
  const admin = await createPlatformAdmin(`module1-http-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const sellerA = await createApprovedSeller(adminToken, `DashboardA${randomUUID().slice(0, 8)}`);
  const sellerB = await createApprovedSeller(adminToken, `DashboardB${randomUUID().slice(0, 8)}`);
  const storeA = await createStoreViaHttp(
    sellerA.ownerToken,
    `dashboard-a-${randomUUID().slice(0, 8)}`,
  );
  const storeB = await createStoreViaHttp(
    sellerB.ownerToken,
    `dashboard-b-${randomUUID().slice(0, 8)}`,
  );
  return {
    sellerA,
    sellerB,
    storeAId: String(storeA.id),
    storeBId: String(storeB.id),
  };
}

beforeEach(async () => {
  await resetModule1HttpTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 1 Dashboard HTTP/RBAC integration", () => {
  it("requires authentication and Dashboard permission before private reads", async () => {
    const app = createApp();

    await request(app).get(DASHBOARD_PATH.SUMMARY).expect(401);

    const customer = await registerCustomer(`module1-http-customer-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    await request(app)
      .get(DASHBOARD_PATH.SUMMARY)
      .set(bearer(customerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
      });
  });

  it("exposes exactly the five documented Dashboard operations to an authorized seller", async () => {
    const { sellerA, storeAId } = await createDashboardHttpActors();
    const app = createApp();
    const scopeQuery = `sellerId=${sellerA.sellerId}&storeId=${storeAId}`;

    const summary = await request(app)
      .get(`${DASHBOARD_PATH.SUMMARY}?${scopeQuery}`)
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(dashboardSummaryResponseSchema.parse(summary.body.data).finance).toBeNull();

    const orders = await request(app)
      .get(`${DASHBOARD_PATH.ORDERS}?${scopeQuery}`)
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    dashboardOrdersResponseSchema.parse(orders.body.data);

    const sellers = await request(app)
      .get(`${DASHBOARD_PATH.SELLERS}?sellerId=${sellerA.sellerId}`)
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    dashboardSellersResponseSchema.parse(sellers.body.data);
    expect(sellers.body.meta).toMatchObject({ page: 1, pageSize: 20 });

    const alerts = await request(app)
      .get(`${DASHBOARD_PATH.ALERTS}?${scopeQuery}`)
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    dashboardAlertsResponseSchema.parse(alerts.body.data);
    expect(alerts.body.meta).toMatchObject({ page: 1, pageSize: 20 });

    const preferences = await request(app)
      .patch(DASHBOARD_PATH.PREFERENCES)
      .set(bearer(sellerA.ownerToken))
      .send({ defaultDateRange: "last_30_days", defaultStoreId: storeAId })
      .expect(200);
    dashboardPreferencesResponseSchema.parse(preferences.body.data);
  });

  it("rejects Seller B reads and preference writes against Seller A scope", async () => {
    const { sellerA, sellerB, storeAId } = await createDashboardHttpActors();
    const app = createApp();

    await request(app)
      .get(`${DASHBOARD_PATH.SUMMARY}?sellerId=${sellerA.sellerId}`)
      .set(bearer(sellerB.ownerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN);
      });

    await request(app)
      .patch(DASHBOARD_PATH.PREFERENCES)
      .set(bearer(sellerB.ownerToken))
      .send({ defaultStoreId: storeAId })
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN);
      });
  });

  it("returns the stable Dashboard error codes for malformed and unsupported filters", async () => {
    const { sellerA } = await createDashboardHttpActors();
    const app = createApp();

    await request(app)
      .get(
        `${DASHBOARD_PATH.SUMMARY}?from=2026-09-17T00:00:00.000Z&to=2026-09-01T00:00:00.000Z`,
      )
      .set(bearer(sellerA.ownerToken))
      .expect(422)
      .expect((response) => {
        expect(response.body.error.code).toBe(DASHBOARD_ERROR_CODE.FILTER_INVALID);
      });

    await request(app)
      .get(`${DASHBOARD_PATH.ORDERS}?categoryId=${randomUUID()}`)
      .set(bearer(sellerA.ownerToken))
      .expect(503)
      .expect((response) => {
        expect(response.body.error.code).toBe(DASHBOARD_ERROR_CODE.WIDGET_UNAVAILABLE);
      });
  });

  it("persists only the current user's preferences and commits audit/outbox in the same successful command", async () => {
    const { sellerA, storeAId } = await createDashboardHttpActors();
    const app = createApp();

    const response = await request(app)
      .patch(DASHBOARD_PATH.PREFERENCES)
      .set(bearer(sellerA.ownerToken))
      .send({
        defaultDateRange: "last_30_days",
        defaultStoreId: storeAId,
        layout: {
          widgets: [
            { widgetCode: "executive_kpis", order: 0, visible: true },
            { widgetCode: "orders_trend", order: 1, visible: true },
          ],
        },
        savedFilters: [
          {
            name: "My primary store",
            filters: { sellerId: sellerA.sellerId, storeId: storeAId },
          },
        ],
      })
      .expect(200);

    expect(dashboardPreferencesResponseSchema.parse(response.body.data)).toMatchObject({
      defaultDateRange: "last_30_days",
      defaultStoreId: storeAId,
    });
    expect(await readDashboardPreference(sellerA.owner.id)).toMatchObject({
      userId: sellerA.owner.id,
      defaultDateRange: "last_30_days",
      defaultStoreId: storeAId,
    });
    expect(await countDashboardSavedFilters(sellerA.owner.id)).toBe(1);
    expect(await countDashboardAuditActions("dashboard.preferences_updated")).toBe(1);
    expect(await countDashboardOutboxEvents("dashboard.preferences_updated")).toBe(1);
  });

  it("rejects a mixed-scope preference payload before any Dashboard write is committed", async () => {
    const { sellerA, sellerB, storeAId, storeBId } = await createDashboardHttpActors();
    const app = createApp();

    await request(app)
      .patch(DASHBOARD_PATH.PREFERENCES)
      .set(bearer(sellerA.ownerToken))
      .send({
        defaultStoreId: storeAId,
        savedFilters: [
          {
            name: "Foreign store",
            filters: { sellerId: sellerB.sellerId, storeId: storeBId },
          },
        ],
      })
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(DASHBOARD_ERROR_CODE.SCOPE_FORBIDDEN);
      });

    expect(await readDashboardPreference(sellerA.owner.id)).toBeNull();
    expect(await countDashboardSavedFilters(sellerA.owner.id)).toBe(0);
    expect(await countDashboardAuditActions("dashboard.preferences_updated")).toBe(0);
    expect(await countDashboardOutboxEvents("dashboard.preferences_updated")).toBe(0);
  });

  it("keeps OpenAPI parity with exactly the documented Dashboard paths and methods", () => {
    const expectedMethods = new Map<string, string>([
      [DASHBOARD_PATH.SUMMARY, "get"],
      [DASHBOARD_PATH.ORDERS, "get"],
      [DASHBOARD_PATH.SELLERS, "get"],
      [DASHBOARD_PATH.ALERTS, "get"],
      [DASHBOARD_PATH.PREFERENCES, "patch"],
    ]);

    const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;
    for (const [path, method] of expectedMethods) {
      const pathItem = paths[path];
      expect(pathItem, `OpenAPI path ${path} must exist`).toBeDefined();
      expect(pathItem?.[method], `OpenAPI method ${method.toUpperCase()} ${path} must exist`).toBeDefined();
      const exposedMethods = Object.keys(pathItem ?? {}).filter((key) =>
        ["get", "post", "put", "patch", "delete"].includes(key),
      );
      expect(exposedMethods).toEqual([method]);
    }
  });
});

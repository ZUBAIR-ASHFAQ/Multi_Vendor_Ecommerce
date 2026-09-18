import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  REPORT_CODE,
  REPORT_OUTPUT_FORMAT,
  REPORT_RUN_STATUS,
  REPORTS_ERROR_CODE,
} from "../../src/modules/reports/reports.constants.js";
import {
  bearer,
  createApprovedSeller,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
  resetModule4Tables,
} from "../module4/module4.test-helpers.js";
import { resetModule20ReportTables } from "./module20.test-helpers.js";

/** Creates one administrator plus two isolated seller accounts for HTTP/RBAC proof. */
async function createReportsHttpActors() {
  const admin = await createPlatformAdmin(`module20-http-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const sellerA = await createApprovedSeller(adminToken, `ReportsHttpA${randomUUID().slice(0, 8)}`);
  const sellerB = await createApprovedSeller(adminToken, `ReportsHttpB${randomUUID().slice(0, 8)}`);
  return { admin, adminToken, sellerA, sellerB };
}

beforeEach(async () => {
  await resetModule4Tables();
  await resetModule20ReportTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 20 Reports HTTP/RBAC integration", () => {
  it("exposes exactly the catalog plus six synchronous reads to an authorized seller and keeps audit export out of the seller catalog", async () => {
    const { sellerA } = await createReportsHttpActors();
    const app = createApp();

    const catalog = await request(app)
      .get("/api/v1/reports/catalog")
      .set(bearer(sellerA.ownerToken))
      .expect(200);
    expect(catalog.body.data.map((item: { code: string }) => item.code).sort()).toEqual(
      [
        REPORT_CODE.SALES,
        REPORT_CODE.SELLERS,
        REPORT_CODE.INVENTORY,
        REPORT_CODE.REFUNDS,
        REPORT_CODE.COMMISSIONS,
        REPORT_CODE.PAYOUTS,
      ].sort(),
    );
    expect(catalog.body.data.some((item: { code: string }) => item.code === REPORT_CODE.AUDIT_LOG)).toBe(false);

    for (const path of [
      "/api/v1/reports/sales",
      "/api/v1/reports/sellers",
      "/api/v1/reports/inventory",
      "/api/v1/reports/refunds",
      "/api/v1/reports/commissions",
      "/api/v1/reports/payouts",
    ]) {
      const response = await request(app).get(path).set(bearer(sellerA.ownerToken)).expect(200);
      expect(response.body.success).toBe(true);
      expect(response.body.meta).toMatchObject({ page: 1, pageSize: 20 });
    }
  });

  it("denies missing report permission and rejects Seller B access to Seller A report scope", async () => {
    const { sellerA, sellerB } = await createReportsHttpActors();
    const customer = await registerCustomer(`module20-http-customer-${randomUUID()}@example.com`);
    const customerToken = await loginUser(customer);
    const app = createApp();

    await request(app)
      .get("/api/v1/reports/sales")
      .set(bearer(customerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.FORBIDDEN);
      });

    await request(app)
      .get(`/api/v1/reports/sales?sellerId=${sellerA.sellerId}`)
      .set(bearer(sellerB.ownerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(REPORTS_ERROR_CODE.SCOPE_FORBIDDEN);
      });
  });

  it("creates and reads a requester-owned export run while hiding it from another seller", async () => {
    const { sellerA, sellerB } = await createReportsHttpActors();
    const app = createApp();

    const created = await request(app)
      .post("/api/v1/reports/runs")
      .set(bearer(sellerA.ownerToken))
      .send({
        reportCode: REPORT_CODE.SALES,
        filters: {},
        outputFormat: REPORT_OUTPUT_FORMAT.CSV,
      })
      .expect(202);
    expect(created.body.data).toMatchObject({
      reportCode: REPORT_CODE.SALES,
      status: REPORT_RUN_STATUS.QUEUED,
      outputFormat: REPORT_OUTPUT_FORMAT.CSV,
      download: null,
    });

    const reportRunId = String(created.body.data.id);
    await request(app)
      .get(`/api/v1/reports/runs/${reportRunId}`)
      .set(bearer(sellerA.ownerToken))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.id).toBe(reportRunId);
      });

    await request(app)
      .get(`/api/v1/reports/runs/${reportRunId}`)
      .set(bearer(sellerB.ownerToken))
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(REPORTS_ERROR_CODE.SCOPE_FORBIDDEN);
      });
  });

  it("allows the approved audit export only to the platform actor with the audit permissions declared by its report definition", async () => {
    const { adminToken, sellerA } = await createReportsHttpActors();
    const app = createApp();

    await request(app)
      .post("/api/v1/reports/runs")
      .set(bearer(sellerA.ownerToken))
      .send({
        reportCode: REPORT_CODE.AUDIT_LOG,
        filters: {},
        outputFormat: REPORT_OUTPUT_FORMAT.CSV,
      })
      .expect(403)
      .expect((response) => {
        expect(response.body.error.code).toBe(REPORTS_ERROR_CODE.SCOPE_FORBIDDEN);
      });

    await request(app)
      .post("/api/v1/reports/runs")
      .set(bearer(adminToken))
      .send({
        reportCode: REPORT_CODE.AUDIT_LOG,
        filters: {},
        outputFormat: REPORT_OUTPUT_FORMAT.CSV,
      })
      .expect(202)
      .expect((response) => {
        expect(response.body.data.reportCode).toBe(REPORT_CODE.AUDIT_LOG);
      });
  });

  it("rejects an over-wide export date range before persisting a report run", async () => {
    const { adminToken } = await createReportsHttpActors();
    await request(createApp())
      .post("/api/v1/reports/runs")
      .set(bearer(adminToken))
      .send({
        reportCode: REPORT_CODE.SALES,
        filters: {
          from: "2025-01-01T00:00:00.000Z",
          to: "2026-12-31T00:00:00.000Z",
        },
        outputFormat: REPORT_OUTPUT_FORMAT.PDF,
      })
      .expect(422)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
      });
  });
});

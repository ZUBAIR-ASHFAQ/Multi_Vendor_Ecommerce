import { describe, expect, it } from "vitest";
import { DOCUMENT_AUDIT_PERMISSION } from "../../src/modules/documents-audit/documents-audit.constants.js";
import {
  REPORT_CODE,
  REPORT_DEFINITION_CATALOG,
  REPORT_OUTPUT_FORMAT,
  REPORT_RUN_STATUS,
  REPORTS_ERROR_CODE,
  REPORTS_OUTBOX_EVENT,
  REPORTS_PATH,
  REPORTS_PERMISSION,
} from "../../src/modules/reports/reports.constants.js";
import {
  auditLogReportFilterSchema,
  createReportRunBodySchema,
  inventoryReportQuerySchema,
  reportRunResponseSchema,
  salesReportQuerySchema,
  salesReportResponseSchema,
} from "../../src/modules/reports/reports.schema.js";

const ID = "00000000-0000-4000-8000-000000000001";
const SECOND_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-09-16T00:00:00.000Z";

describe("Module 20 fixed contract values", () => {
  it("freezes the representative permissions, required errors, lifecycle values, and events", () => {
    expect(Object.values(REPORTS_PERMISSION)).toEqual([
      "reports.sales.read",
      "reports.inventory.read",
      "reports.finance.read",
      "reports.seller.read",
      "reports.export",
    ]);
    expect(Object.values(REPORTS_ERROR_CODE)).toEqual([
      "REPORT_NOT_FOUND",
      "REPORT_SCOPE_FORBIDDEN",
      "REPORT_FILTER_INVALID",
      "REPORT_EXPORT_FAILED",
    ]);
    expect(Object.values(REPORT_OUTPUT_FORMAT)).toEqual(["csv", "pdf"]);
    expect(Object.values(REPORT_RUN_STATUS)).toEqual([
      "queued",
      "processing",
      "completed",
      "failed",
    ]);
    expect(Object.values(REPORTS_OUTBOX_EVENT)).toEqual([
      "report.run_requested",
      "report.generated",
      "report.failed",
    ]);
  });

  it("freezes exactly the nine source-defined Module 20 paths", () => {
    expect(Object.values(REPORTS_PATH)).toEqual([
      "/api/v1/reports/catalog",
      "/api/v1/reports/sales",
      "/api/v1/reports/sellers",
      "/api/v1/reports/inventory",
      "/api/v1/reports/refunds",
      "/api/v1/reports/commissions",
      "/api/v1/reports/payouts",
      "/api/v1/reports/runs",
      "/api/v1/reports/runs/:id",
    ]);
    expect(Object.keys(REPORTS_PATH)).toHaveLength(9);
  });

  it("seeds six source reports plus the approved audit-log export definition", () => {
    expect(REPORT_DEFINITION_CATALOG.map((definition) => definition.code)).toEqual([
      "sales",
      "sellers",
      "inventory",
      "refunds",
      "commissions",
      "payouts",
      "audit_log",
    ]);
    const auditDefinition = REPORT_DEFINITION_CATALOG.find(
      (definition) => definition.code === REPORT_CODE.AUDIT_LOG,
    );
    expect(auditDefinition?.requiredPermissions).toEqual([
      DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
      DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT,
    ]);
    expect(REPORT_DEFINITION_CATALOG).toHaveLength(7);
  });
});

describe("Module 20 query and export boundaries", () => {
  it("normalizes bounded sales filters and rejects undocumented query fields", () => {
    expect(
      salesReportQuerySchema.parse({
        page: "2",
        pageSize: "25",
        from: "2026-09-01T00:00:00Z",
        to: "2026-09-16T00:00:00Z",
        sellerId: ID,
        currency: " usd ",
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 25,
      sellerId: ID,
      currency: "USD",
      sort: "created_desc",
    });

    expect(() => salesReportQuerySchema.parse({ customerEmail: "hidden@example.test" })).toThrow();
    expect(() =>
      salesReportQuerySchema.parse({
        from: "2025-01-01T00:00:00Z",
        to: "2026-09-16T00:00:00Z",
      }),
    ).toThrow();
  });

  it("parses false low-stock query values without JavaScript truthiness bugs", () => {
    expect(inventoryReportQuerySchema.parse({ lowStockOnly: "false" }).lowStockOnly).toBe(false);
    expect(inventoryReportQuerySchema.parse({ lowStockOnly: "true" }).lowStockOnly).toBe(true);
  });

  it("validates each async report run with its report-specific filter contract", () => {
    expect(
      createReportRunBodySchema.parse({
        reportCode: "sales",
        filters: { sellerId: ID, currency: "usd" },
        outputFormat: "csv",
      }),
    ).toMatchObject({
      reportCode: "sales",
      filters: { sellerId: ID, currency: "USD" },
      outputFormat: "csv",
    });

    expect(() =>
      createReportRunBodySchema.parse({
        reportCode: "inventory",
        filters: { currency: "USD" },
        outputFormat: "csv",
      }),
    ).toThrow();
    expect(() =>
      createReportRunBodySchema.parse({
        reportCode: "sales",
        filters: {},
        outputFormat: "xlsx",
      }),
    ).toThrow();
  });

  it("keeps approved audit-export filters aligned with the Module 21 audit search identity fields", () => {
    expect(
      auditLogReportFilterSchema.parse({
        actorUserId: ID,
        action: "order.cancelled",
        resourceType: " ORDER ",
        resourceId: SECOND_ID,
        sellerId: ID,
        from: "2026-09-01T00:00:00Z",
        to: "2026-09-16T00:00:00Z",
      }),
    ).toMatchObject({
      actorUserId: ID,
      resourceType: "order",
      resourceId: SECOND_ID,
      sellerId: ID,
    });
  });
});

describe("Module 20 exact-money and privacy-safe responses", () => {
  it("keeps GMV, captured cash, and refunds separate and requires decimal strings", () => {
    const parsed = salesReportResponseSchema.parse({
      summary: {
        orderCount: 1,
        sellerOrderCount: 1,
        gmvByCurrency: [{ currency: "USD", amount: "125.0000" }],
        capturedCashByCurrency: [{ currency: "USD", amount: "125.0000" }],
        refundsByCurrency: [{ currency: "USD", amount: "0.0000" }],
      },
      rows: [
        {
          orderId: ID,
          orderNo: "ORD-1",
          sellerOrderId: SECOND_ID,
          sellerOrderNo: "SO-1",
          sellerId: ID,
          storeId: SECOND_ID,
          orderStatus: "confirmed",
          sellerOrderStatus: "pending_acceptance",
          currency: "USD",
          grandTotal: "125.0000",
          createdAt: NOW,
        },
      ],
    });
    expect(parsed.summary.gmvByCurrency[0]?.amount).toBe("125.0000");

    expect(() =>
      salesReportResponseSchema.parse({
        ...parsed,
        summary: {
          ...parsed.summary,
          gmvByCurrency: [{ currency: "USD", amount: 125 }],
        },
      }),
    ).toThrow();
  });

  it("does not expose a download URL until a completed run has authorized download metadata", () => {
    const queued = reportRunResponseSchema.parse({
      id: ID,
      reportCode: "sales",
      filters: {},
      outputFormat: "csv",
      status: "queued",
      errorCode: null,
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      download: null,
    });
    expect(queued.download).toBeNull();
    expect(() => reportRunResponseSchema.parse({ ...queued, providerSecret: "nope" })).toThrow();
  });
});

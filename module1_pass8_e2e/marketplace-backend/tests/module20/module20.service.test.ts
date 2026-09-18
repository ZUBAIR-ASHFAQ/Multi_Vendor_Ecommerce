import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import type { ReportDefinitionRow, ReportRunRow } from "../../src/database/schema/reports.js";
import { DOCUMENT_AUDIT_PERMISSION } from "../../src/modules/documents-audit/documents-audit.constants.js";
import {
  REPORT_CODE,
  REPORT_DEFINITION_STATUS,
  REPORT_OUTPUT_FORMAT,
  REPORT_RUN_STATUS,
  REPORTS_ERROR_CODE,
  REPORTS_PERMISSION,
} from "../../src/modules/reports/reports.constants.js";
import { ReportsRepository } from "../../src/modules/reports/reports.repository.js";
import {
  ReportsService,
  type ReportsDocumentsIntegration,
} from "../../src/modules/reports/reports.service.js";
import {
  payoutsReportQuerySchema,
  salesReportQuerySchema,
} from "../../src/modules/reports/reports.schema.js";
import {
  reportsAdminContext,
  reportsSellerContext,
} from "./module20.test-helpers.js";

/** Creates one active report-definition row for service permission tests. */
function definition(
  code: ReportDefinitionRow["code"],
  requiredPermissions: PermissionCode[],
): ReportDefinitionRow {
  const now = new Date("2026-09-17T10:00:00.000Z");
  return {
    id: randomUUID(),
    code,
    domain: code === REPORT_CODE.AUDIT_LOG ? "audit" : code,
    requiredPermissions,
    filterSchemaJson: {},
    outputFormats: [REPORT_OUTPUT_FORMAT.CSV, REPORT_OUTPUT_FORMAT.PDF],
    status: REPORT_DEFINITION_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
}

/** Creates one persisted report-run row with server-owned scope metadata. */
function reportRun(overrides: Partial<ReportRunRow> = {}): ReportRunRow {
  return {
    id: randomUUID(),
    reportCode: REPORT_CODE.SALES,
    requestedBy: randomUUID(),
    filtersJson: {
      request: { currency: "PKR" },
      scope: { sellerIds: null, storeIds: null },
    },
    outputFormat: REPORT_OUTPUT_FORMAT.CSV,
    status: REPORT_RUN_STATUS.QUEUED,
    fileId: null,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    createdAt: new Date("2026-09-17T10:00:00.000Z"),
    ...overrides,
  };
}

/** Builds a narrow document double used only for signed-download assertions. */
function documentsDouble(): ReportsDocumentsIntegration {
  return {
    /** This focused service suite does not execute the export worker. */
    async storeGeneratedDocument() {
      return { file: { id: randomUUID() } };
    },
    /** Returns deterministic signed metadata after the service has verified run ownership. */
    async getGeneratedDocumentDownload(ownerUserId, fileId) {
      return {
        downloadUrl: `https://example.test/${ownerUserId}/${fileId}`,
        expiresAt: "2026-09-17T12:00:00.000Z",
      };
    },
  };
}

/** Creates a partial repository double while retaining the production repository type at the service boundary. */
function repositoryDouble(overrides: Partial<Record<keyof ReportsRepository, unknown>> = {}): ReportsRepository {
  return {
    listActiveDefinitions: vi.fn().mockResolvedValue([]),
    findActiveDefinitionByCode: vi.fn().mockResolvedValue(null),
    findStoreScope: vi.fn().mockResolvedValue(null),
    listSalesRows: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    sumSalesGmv: vi.fn().mockResolvedValue([]),
    countSalesOrders: vi.fn().mockResolvedValue({ orderCount: 0, sellerOrderCount: 0 }),
    sumCapturedSellerOrderValue: vi.fn().mockResolvedValue([]),
    sumCompletedRefunds: vi.fn().mockResolvedValue([]),
    listPayoutRows: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    sumSellerPayable: vi.fn().mockResolvedValue([]),
    sumPaidPayouts: vi.fn().mockResolvedValue([]),
    findReportRunById: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ReportsRepository;
}

describe("Module 20 Reports service business boundaries", () => {
  it("keeps GMV, captured customer cash, and refunds separate while passing the server-derived seller/store scope to every Sales query", async () => {
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const listSalesRows = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
    const sumSalesGmv = vi.fn().mockResolvedValue([{ currency: "PKR", amount: "125.0000" }]);
    const countSalesOrders = vi.fn().mockResolvedValue({ orderCount: 1, sellerOrderCount: 1 });
    const sumCapturedSellerOrderValue = vi.fn().mockResolvedValue([{ currency: "PKR", amount: "120.0000" }]);
    const sumCompletedRefunds = vi.fn().mockResolvedValue([{ currency: "PKR", amount: "20.0000" }]);
    const repository = repositoryDouble({
      listSalesRows,
      sumSalesGmv,
      countSalesOrders,
      sumCapturedSellerOrderValue,
      sumCompletedRefunds,
    });
    const service = new ReportsService({ repository, documents: documentsDouble() });
    const context = reportsSellerContext({
      actorId: randomUUID(),
      sellerId,
      storeIds: [storeId],
      permissions: [REPORTS_PERMISSION.SALES_READ],
    });
    const query = salesReportQuerySchema.parse({ page: 1, pageSize: 20, currency: "PKR" });

    const result = await service.getSalesReport(context, query);

    expect(result.data.summary).toEqual({
      orderCount: 1,
      sellerOrderCount: 1,
      gmvByCurrency: [{ currency: "PKR", amount: "125.0000" }],
      capturedCashByCurrency: [{ currency: "PKR", amount: "120.0000" }],
      refundsByCurrency: [{ currency: "PKR", amount: "20.0000" }],
    });
    for (const call of [
      listSalesRows,
      sumSalesGmv,
      countSalesOrders,
      sumCapturedSellerOrderValue,
      sumCompletedRefunds,
    ]) {
      expect(call.mock.calls[0]?.[1]).toEqual({ sellerIds: [sellerId], storeIds: [storeId] });
    }
  });

  it("rejects a seller request for another seller before any report repository read executes", async () => {
    const ownSellerId = randomUUID();
    const foreignSellerId = randomUUID();
    const listSalesRows = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
    const repository = repositoryDouble({ listSalesRows });
    const service = new ReportsService({ repository, documents: documentsDouble() });
    const context = reportsSellerContext({
      actorId: randomUUID(),
      sellerId: ownSellerId,
      permissions: [REPORTS_PERMISSION.SALES_READ],
    });
    const query = salesReportQuerySchema.parse({ sellerId: foreignSellerId, page: 1, pageSize: 20 });

    await expect(service.getSalesReport(context, query)).rejects.toMatchObject({
      code: REPORTS_ERROR_CODE.SCOPE_FORBIDDEN,
      statusCode: 403,
    });
    expect(listSalesRows).not.toHaveBeenCalled();
  });

  it("preserves signed seller payable separately from terminal paid Payout totals", async () => {
    const repository = repositoryDouble({
      listPayoutRows: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      sumSellerPayable: vi.fn().mockResolvedValue([{ currency: "PKR", amount: "-5.0000" }]),
      sumPaidPayouts: vi.fn().mockResolvedValue([{ currency: "PKR", amount: "75.0000" }]),
    });
    const service = new ReportsService({ repository, documents: documentsDouble() });
    const context = reportsAdminContext(randomUUID(), [REPORTS_PERMISSION.FINANCE_READ]);

    const result = await service.getPayoutsReport(
      context,
      payoutsReportQuerySchema.parse({ page: 1, pageSize: 20 }),
    );

    expect(result.data.sellerPayableByCurrency).toEqual([{ currency: "PKR", amount: "-5.0000" }]);
    expect(result.data.paidOutByCurrency).toEqual([{ currency: "PKR", amount: "75.0000" }]);
  });

  it("filters the report catalog by actor permission and never exposes the audit export definition to a seller", async () => {
    const sales = definition(REPORT_CODE.SALES, [REPORTS_PERMISSION.SALES_READ]);
    const audit = definition(REPORT_CODE.AUDIT_LOG, [
      DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
      DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT,
    ]);
    const repository = repositoryDouble({
      listActiveDefinitions: vi.fn().mockResolvedValue([audit, sales]),
    });
    const service = new ReportsService({ repository, documents: documentsDouble() });
    const sellerId = randomUUID();
    const sellerCatalog = await service.getCatalog(
      reportsSellerContext({
        actorId: randomUUID(),
        sellerId,
        permissions: [REPORTS_PERMISSION.SALES_READ],
      }),
    );
    const adminCatalog = await service.getCatalog(
      reportsAdminContext(randomUUID(), [
        REPORTS_PERMISSION.SALES_READ,
        DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
        DOCUMENT_AUDIT_PERMISSION.AUDIT_EXPORT,
      ]),
    );

    expect(sellerCatalog.map((item) => item.code)).toEqual([REPORT_CODE.SALES]);
    expect(adminCatalog.map((item) => item.code)).toEqual([REPORT_CODE.AUDIT_LOG, REPORT_CODE.SALES]);
  });

  it("returns a signed download only to the report requester after completion", async () => {
    const ownerUserId = randomUUID();
    const fileId = randomUUID();
    const completed = reportRun({
      requestedBy: ownerUserId,
      status: REPORT_RUN_STATUS.COMPLETED,
      fileId,
      startedAt: new Date("2026-09-17T10:01:00.000Z"),
      finishedAt: new Date("2026-09-17T10:02:00.000Z"),
    });
    const repository = repositoryDouble({
      findReportRunById: vi.fn().mockResolvedValue(completed),
    });
    const documents = documentsDouble();
    const downloadSpy = vi.spyOn(documents, "getGeneratedDocumentDownload");
    const service = new ReportsService({ repository, documents });

    const result = await service.getReportRun(
      reportsAdminContext(ownerUserId, [REPORTS_PERMISSION.EXPORT]),
      completed.id,
    );
    expect(result.download).toEqual({
      fileId,
      downloadUrl: `https://example.test/${ownerUserId}/${fileId}`,
      expiresAt: "2026-09-17T12:00:00.000Z",
    });
    expect(downloadSpy).toHaveBeenCalledWith(ownerUserId, fileId, "report_export");

    await expect(
      service.getReportRun(
        reportsAdminContext(randomUUID(), [REPORTS_PERMISSION.EXPORT]),
        completed.id,
      ),
    ).rejects.toMatchObject({ code: REPORTS_ERROR_CODE.SCOPE_FORBIDDEN, statusCode: 403 });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import {
  REPORT_CODE,
  REPORT_OUTPUT_FORMAT,
  REPORT_RUN_STATUS,
  REPORTS_ERROR_CODE,
  REPORTS_OUTBOX_EVENT,
} from "../../src/modules/reports/reports.constants.js";
import { ReportsService } from "../../src/modules/reports/reports.service.js";
import { createPlatformAdmin, resetModule4Tables } from "../module4/module4.test-helpers.js";
import {
  ReportsDatabaseDocumentStub,
  countReportOutboxEvents,
  reportsAdminContext,
  resetModule20ReportTables,
} from "./module20.test-helpers.js";

beforeEach(async () => {
  await resetModule4Tables();
  await resetModule20ReportTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 20 asynchronous report-run integration", () => {
  it("queues, generates, stores, downloads, and replays one export without duplicating terminal effects", async () => {
    const admin = await createPlatformAdmin(`module20-run-owner-${randomUUID()}@example.com`);
    const documents = new ReportsDatabaseDocumentStub();
    const service = new ReportsService({ documents });
    const context = reportsAdminContext(admin.id);

    const queued = await service.createReportRun(context, {
      reportCode: REPORT_CODE.SALES,
      filters: {},
      outputFormat: REPORT_OUTPUT_FORMAT.CSV,
    });
    expect(queued).toMatchObject({
      reportCode: REPORT_CODE.SALES,
      status: REPORT_RUN_STATUS.QUEUED,
      outputFormat: REPORT_OUTPUT_FORMAT.CSV,
      download: null,
    });
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.RUN_REQUESTED)).toBe(1);

    await service.processReportRun(queued.id);
    const completed = await service.getReportRun(context, queued.id);
    expect(completed.status).toBe(REPORT_RUN_STATUS.COMPLETED);
    expect(completed.errorCode).toBeNull();
    expect(completed.download?.fileId).toBe(documents.storedFiles[0]?.fileId);
    expect(completed.download?.downloadUrl).toContain(`/reports/${admin.id}/`);
    expect(documents.storedFiles).toHaveLength(1);
    expect(new TextDecoder().decode(documents.storedFiles[0]?.body)).toBe("\n");
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.GENERATED)).toBe(1);

    await service.processReportRun(queued.id);
    expect(documents.storedFiles).toHaveLength(1);
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.GENERATED)).toBe(1);

    const otherAdmin = await createPlatformAdmin(`module20-run-other-${randomUUID()}@example.com`);
    await expect(
      service.getReportRun(reportsAdminContext(otherAdmin.id), queued.id),
    ).rejects.toMatchObject({ code: REPORTS_ERROR_CODE.SCOPE_FORBIDDEN, statusCode: 403 });
  });

  it("records only the final export failure and keeps failure notification replay-safe", async () => {
    const admin = await createPlatformAdmin(`module20-failure-owner-${randomUUID()}@example.com`);
    const service = new ReportsService({ documents: new ReportsDatabaseDocumentStub() });
    const context = reportsAdminContext(admin.id);
    const queued = await service.createReportRun(context, {
      reportCode: REPORT_CODE.INVENTORY,
      filters: {},
      outputFormat: REPORT_OUTPUT_FORMAT.PDF,
    });

    await service.recordReportRunFailure(queued.id, REPORTS_ERROR_CODE.EXPORT_FAILED, false);
    expect((await service.getReportRun(context, queued.id)).status).toBe(REPORT_RUN_STATUS.QUEUED);
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.FAILED)).toBe(0);

    await service.recordReportRunFailure(queued.id, REPORTS_ERROR_CODE.EXPORT_FAILED, true);
    const failed = await service.getReportRun(context, queued.id);
    expect(failed).toMatchObject({
      status: REPORT_RUN_STATUS.FAILED,
      errorCode: REPORTS_ERROR_CODE.EXPORT_FAILED,
      download: null,
    });
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.FAILED)).toBe(1);

    await service.recordReportRunFailure(queued.id, REPORTS_ERROR_CODE.EXPORT_FAILED, true);
    expect(await countReportOutboxEvents(REPORTS_OUTBOX_EVENT.FAILED)).toBe(1);
  });
});

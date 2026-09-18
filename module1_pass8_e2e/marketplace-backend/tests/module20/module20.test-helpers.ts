import { randomUUID } from "node:crypto";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { databasePool } from "../../src/database/db.js";
import { seedReportsCatalog } from "../../src/database/seeds/reports.seed.js";
import { DOCUMENT_PURPOSE } from "../../src/modules/documents-audit/documents-audit.constants.js";
import {
  REPORTS_PERMISSION,
} from "../../src/modules/reports/reports.constants.js";
import type { ReportsDocumentsIntegration } from "../../src/modules/reports/reports.service.js";

/** Clears Module 20-owned state and restores the server-controlled report-definition catalog. */
export async function resetModule20ReportTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      saved_report_filters,
      report_runs,
      report_definitions
    RESTART IDENTITY CASCADE
  `);
  await seedReportsCatalog();
}

/** Builds a platform-admin Reports context with the supplied permissions. */
export function reportsAdminContext(
  actorId: string,
  permissions: PermissionCode[] = [
    REPORTS_PERMISSION.SALES_READ,
    REPORTS_PERMISSION.INVENTORY_READ,
    REPORTS_PERMISSION.FINANCE_READ,
    REPORTS_PERMISSION.SELLER_READ,
    REPORTS_PERMISSION.EXPORT,
  ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds a seller-scoped Reports context whose permissions are effective only for the supplied seller. */
export function reportsSellerContext(input: {
  actorId: string;
  sellerId: string;
  storeIds?: string[];
  permissions?: PermissionCode[];
}): RequestContext {
  const permissions = input.permissions ?? [
    REPORTS_PERMISSION.SALES_READ,
    REPORTS_PERMISSION.INVENTORY_READ,
    REPORTS_PERMISSION.FINANCE_READ,
    REPORTS_PERMISSION.SELLER_READ,
    REPORTS_PERMISSION.EXPORT,
  ];
  return {
    requestId: randomUUID(),
    actorId: input.actorId,
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([input.sellerId]),
    storeIds: new Set(input.storeIds ?? []),
    sellerPermissions: new Map([[input.sellerId, new Set(permissions)]]),
    sessionId: randomUUID(),
  };
}

/** Stores generated report bytes in the real files table without contacting external object storage. */
export class ReportsDatabaseDocumentStub implements ReportsDocumentsIntegration {
  readonly storedFiles: Array<{
    ownerUserId: string;
    originalName: string;
    mimeType: string;
    body: Uint8Array;
    fileId: string;
  }> = [];

  /** Persists one confirmed private file row so report_runs.file_id foreign-key behavior is exercised. */
  async storeGeneratedDocument(input: {
    ownerUserId: string;
    purpose: typeof DOCUMENT_PURPOSE.REPORT_EXPORT;
    originalName: string;
    mimeType: string;
    body: Uint8Array;
  }): Promise<{ file: { id: string } }> {
    const result = await databasePool.query<{ id: string }>(
      `insert into files
        (object_key, purpose, original_name, mime_type, size_bytes, owner_user_id, status)
       values ($1, $2, $3, $4, $5, $6, 'confirmed')
       returning id`,
      [
        `module20-tests/${randomUUID()}`,
        input.purpose,
        input.originalName,
        input.mimeType,
        Math.max(1, input.body.byteLength),
        input.ownerUserId,
      ],
    );
    const fileId = result.rows[0]?.id;
    if (!fileId) throw new Error("Module 20 document stub did not create a file row.");
    this.storedFiles.push({ ...input, fileId });
    return { file: { id: fileId } };
  }

  /** Returns deterministic short-lived download metadata for an already authorized report owner. */
  async getGeneratedDocumentDownload(
    ownerUserId: string,
    fileId: string,
    purpose: typeof DOCUMENT_PURPOSE.REPORT_EXPORT,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    if (purpose !== DOCUMENT_PURPOSE.REPORT_EXPORT) {
      throw new Error("Unexpected document purpose in Module 20 test stub.");
    }
    return {
      downloadUrl: `https://example.test/reports/${ownerUserId}/${fileId}`,
      expiresAt: "2026-09-17T12:00:00.000Z",
    };
  }
}

/** Counts one durable report outbox event without depending on event ordering. */
export async function countReportOutboxEvents(eventType: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from outbox_events where event_type = $1",
    [eventType],
  );
  return result.rows[0]?.count ?? 0;
}

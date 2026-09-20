import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  auditLogs,
  fileLinks,
  files,
  type AuditLogRow,
  type FileLinkRow,
  type FileRow,
  type NewFileLinkRow,
  type NewFileRow,
} from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { DOCUMENT_FILE_STATUS } from "./documents-audit.constants.js";
import type { AuditListQuery } from "./documents-audit.schema.js";

export interface PaginatedAuditLogRecords {
  items: AuditLogRow[];
  totalItems: number;
}

export interface ConfirmFileRecordInput {
  checksum?: string | null;
}

/**
 * Scope applied by the service to every audit read.
 * Platform scope can read the complete ledger; seller scope always adds immutable allowed-seller filters.
 */
export type AuditReadScope =
  | { kind: "platform" }
  | { kind: "seller"; sellerIds: readonly string[] };

/** Combines only SQL predicates that were actually supplied. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Converts a service-approved audit scope into a mandatory repository predicate. */
function auditScopeCondition(scope: AuditReadScope): SQL | undefined {
  if (scope.kind === "platform") return undefined;
  if (scope.sellerIds.length === 0) return sql`false`;
  if (scope.sellerIds.length === 1) {
    return eq(auditLogs.sellerId, scope.sellerIds[0] as string);
  }
  return inArray(auditLogs.sellerId, [...scope.sellerIds]);
}

/**
 * Persistence-only Module 21 repository.
 * Storage calls, authorization decisions, redaction and business lifecycle decisions belong to services.
 */
export class DocumentsAuditRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Inserts pending file metadata whose object key and ownership were already derived by the service. */
  async createFile(input: NewFileRow): Promise<FileRow> {
    const [row] = await this.executor.insert(files).values(input).returning();

    if (!row) {
      throw new Error("File insert completed without returning a row.");
    }

    return row;
  }

  /**
   * Reads one file by identifier for an already-authorized platform/system path or an internal transaction.
   * Normal user-owned reads should prefer findFileOwnedByUser so ownership is enforced in SQL.
   */
  async findFileById(fileId: string): Promise<FileRow | null> {
    const [row] = await this.executor
      .select()
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one file only when it belongs to the supplied owner user. */
  async findFileOwnedByUser(
    fileId: string,
    ownerUserId: string,
  ): Promise<FileRow | null> {
    const [row] = await this.executor
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.ownerUserId, ownerUserId)))
      .limit(1);

    return row ?? null;
  }

  /**
   * Atomically changes a pending file to confirmed and stores an optional verified checksum.
   * A null result means the row was absent or was no longer pending when the update executed.
   */
  async confirmPendingFile(
    fileId: string,
    input: ConfirmFileRecordInput = {},
  ): Promise<FileRow | null> {
    const [row] = await this.executor
      .update(files)
      .set({
        status: DOCUMENT_FILE_STATUS.CONFIRMED,
        ...(input.checksum !== undefined ? { checksum: input.checksum } : {}),
      })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.status, DOCUMENT_FILE_STATUS.PENDING),
        ),
      )
      .returning();

    return row ?? null;
  }

  /**
   * Marks a pending upload as failed after the storage provider cannot create its signed upload.
   * The conditional status check keeps repeated cleanup safe and never rewrites confirmed history.
   */
  async markPendingFileFailed(fileId: string): Promise<FileRow | null> {
    const [row] = await this.executor
      .update(files)
      .set({ status: DOCUMENT_FILE_STATUS.FAILED })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.status, DOCUMENT_FILE_STATUS.PENDING),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Inserts one service-approved link between a confirmed file and a business resource. */
  async createFileLink(input: NewFileLinkRow): Promise<FileLinkRow> {
    const [row] = await this.executor.insert(fileLinks).values(input).returning();

    if (!row) {
      throw new Error("File-link insert completed without returning a row.");
    }

    return row;
  }

  /** Reads one link while ensuring the link belongs to the requested file. */
  async findFileLink(
    fileId: string,
    linkId: string,
  ): Promise<FileLinkRow | null> {
    const [row] = await this.executor
      .select()
      .from(fileLinks)
      .where(and(eq(fileLinks.id, linkId), eq(fileLinks.fileId, fileId)))
      .limit(1);

    return row ?? null;
  }

  /** Finds an existing link for the same file/resource/purpose tuple. */
  async findMatchingFileLink(
    fileId: string,
    resourceType: string,
    resourceId: string,
    purpose: string,
  ): Promise<FileLinkRow | null> {
    const [row] = await this.executor
      .select()
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.fileId, fileId),
          eq(fileLinks.resourceType, resourceType),
          eq(fileLinks.resourceId, resourceId),
          eq(fileLinks.purpose, purpose),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Lists all resource links for one file in deterministic newest-first order. */
  async listFileLinks(fileId: string): Promise<FileLinkRow[]> {
    return this.executor
      .select()
      .from(fileLinks)
      .where(eq(fileLinks.fileId, fileId))
      .orderBy(desc(fileLinks.createdAt), desc(fileLinks.id));
  }

  /**
   * Reads one file only when an exact link exists to the supplied business resource.
   * This keeps resource ownership/scope in the database query after service authorization succeeds.
   */
  async findFileLinkedToResource(
    fileId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<FileRow | null> {
    const [row] = await this.executor
      .select({ file: files })
      .from(files)
      .innerJoin(fileLinks, eq(fileLinks.fileId, files.id))
      .where(
        and(
          eq(files.id, fileId),
          eq(fileLinks.resourceType, resourceType),
          eq(fileLinks.resourceId, resourceId),
        ),
      )
      .limit(1);

    return row?.file ?? null;
  }

  /** Removes one link only when it belongs to the requested file and returns the deleted row. */
  async deleteFileLink(
    fileId: string,
    linkId: string,
  ): Promise<FileLinkRow | null> {
    const [row] = await this.executor
      .delete(fileLinks)
      .where(and(eq(fileLinks.id, linkId), eq(fileLinks.fileId, fileId)))
      .returning();

    return row ?? null;
  }

  /**
   * Searches append-only audit rows with validated filters and a mandatory caller-provided scope.
   * Seller scope is always ANDed with any requested seller filter as a defense-in-depth data boundary.
   */
  async listAuditLogs(
    query: AuditListQuery,
    scope: AuditReadScope,
  ): Promise<PaginatedAuditLogRecords> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      auditScopeCondition(scope),
      query.actorUserId ? eq(auditLogs.actorUserId, query.actorUserId) : undefined,
      query.action ? eq(auditLogs.action, query.action) : undefined,
      query.resourceType ? eq(auditLogs.resourceType, query.resourceType) : undefined,
      query.resourceId ? eq(auditLogs.resourceId, query.resourceId) : undefined,
      query.sellerId ? eq(auditLogs.sellerId, query.sellerId) : undefined,
      query.from ? gte(auditLogs.createdAt, new Date(query.from)) : undefined,
      query.to ? lte(auditLogs.createdAt, new Date(query.to)) : undefined,
    ]);

    const baseQuery = this.executor.select().from(auditLogs).where(where);
    const items =
      query.sort === "created_asc"
        ? await baseQuery
            .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
            .limit(limit)
            .offset(offset)
        : await baseQuery
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
            .limit(limit)
            .offset(offset);

    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(auditLogs)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.value ?? 0),
    };
  }

  /** Reads one audit row only inside the supplied platform or seller scope. */
  async findAuditLogById(
    auditLogId: string,
    scope: AuditReadScope,
  ): Promise<AuditLogRow | null> {
    const where = combineConditions([
      eq(auditLogs.id, auditLogId),
      auditScopeCondition(scope),
    ]);

    const [row] = await this.executor
      .select()
      .from(auditLogs)
      .where(where)
      .limit(1);

    return row ?? null;
  }
}

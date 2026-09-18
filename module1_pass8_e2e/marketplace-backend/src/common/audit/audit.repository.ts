import { db } from "../../database/db.js";
import { auditLogs, type AuditLogRow } from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import type { ActorType } from "../security/security.contract.js";

export interface AppendAuditEventInput {
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId?: string | null;
  sellerId?: string | null;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/** Append-only persistence gateway for meaningful security and business writes. */
export class AuditRepository {
  /** Stores the database executor so callers can share an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Appends one audit row while preserving the stable writer contract used by existing modules. */
  async append(input: AppendAuditEventInput): Promise<AuditLogRow> {
    const [row] = await this.executor
      .insert(auditLogs)
      .values({
        actorType: input.actorType,
        action: input.action,
        resourceType: input.entityType,
        ...(input.actorId !== undefined ? { actorUserId: input.actorId } : {}),
        ...(input.entityId !== undefined ? { resourceId: input.entityId } : {}),
        ...(input.sellerId !== undefined ? { sellerId: input.sellerId } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        ...(input.before !== undefined ? { beforeJsonRedacted: input.before } : {}),
        ...(input.after !== undefined ? { afterJsonRedacted: input.after } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      })
      .returning();

    if (!row) {
      throw new Error("Audit insert completed without returning a row.");
    }

    return row;
  }
}

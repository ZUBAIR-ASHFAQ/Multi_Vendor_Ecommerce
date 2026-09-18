import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "../../database/db.js";
import { idempotencyKeys, type IdempotencyKeyRow } from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { IDEMPOTENCY_STATUS, type IdempotencyStatus } from "./idempotency.contract.js";

export interface CreateIdempotencyKeyInput {
  scope: string;
  key: string;
  requestHash: string;
  lockedUntil?: Date | null;
  expiresAt?: Date | null;
}

export interface CompleteIdempotencyKeyInput {
  responseStatus: number;
  responseBody: unknown;
}

/** Persistence-only access for retry keys; conflict/replay policy belongs to the service layer. */
export class IdempotencyRepository {
  /** Stores the database executor so idempotency writes can share business transactions. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Finds one key inside its logical operation scope. */
  async findByScopeAndKey(scope: string, key: string): Promise<IdempotencyKeyRow | null> {
    const [row] = await this.executor
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);

    return row ?? null;
  }

  /** Inserts a PROCESSING row and returns null when a unique conflict already exists. */
  async createProcessing(input: CreateIdempotencyKeyInput): Promise<IdempotencyKeyRow | null> {
    const [row] = await this.executor
      .insert(idempotencyKeys)
      .values({
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        status: IDEMPOTENCY_STATUS.PROCESSING,
        ...(input.lockedUntil !== undefined ? { lockedUntil: input.lockedUntil } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      })
      .onConflictDoNothing()
      .returning();

    return row ?? null;
  }

  /** Atomically reclaims a failed/stale key and refreshes its lock window. */
  async markProcessing(
    id: string,
    lockedUntil: Date,
    now: Date,
  ): Promise<IdempotencyKeyRow | null> {
    const [row] = await this.executor
      .update(idempotencyKeys)
      .set({
        status: IDEMPOTENCY_STATUS.PROCESSING,
        lockedUntil,
        responseStatus: null,
        responseBody: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyKeys.id, id),
          or(
            eq(idempotencyKeys.status, IDEMPOTENCY_STATUS.FAILED),
            and(
              eq(idempotencyKeys.status, IDEMPOTENCY_STATUS.PROCESSING),
              or(isNull(idempotencyKeys.lockedUntil), lte(idempotencyKeys.lockedUntil, now)),
            ),
          ),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Stores the canonical response that a later retry can replay. */
  async markCompleted(
    id: string,
    input: CompleteIdempotencyKeyInput,
  ): Promise<IdempotencyKeyRow | null> {
    return this.updateStatus(id, IDEMPOTENCY_STATUS.COMPLETED, {
      lockedUntil: null,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
    });
  }

  /** Marks a key failed without deleting retry history. */
  async markFailed(id: string): Promise<IdempotencyKeyRow | null> {
    return this.updateStatus(id, IDEMPOTENCY_STATUS.FAILED, {
      lockedUntil: null,
    });
  }

  /** Deletes a bounded batch of expired completed/failed keys while preserving in-progress operations. */
  async deleteExpiredTerminalKeys(now: Date, limit: number): Promise<number> {
    if (limit <= 0) return 0;

    const candidates = await this.executor
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(
        and(
          inArray(idempotencyKeys.status, [
            IDEMPOTENCY_STATUS.COMPLETED,
            IDEMPOTENCY_STATUS.FAILED,
          ]),
          isNotNull(idempotencyKeys.expiresAt),
          lte(idempotencyKeys.expiresAt, now),
        ),
      )
      .orderBy(asc(idempotencyKeys.expiresAt), asc(idempotencyKeys.id))
      .limit(limit);

    if (candidates.length === 0) return 0;

    const deleted = await this.executor
      .delete(idempotencyKeys)
      .where(
        and(
          inArray(
            idempotencyKeys.id,
            candidates.map((candidate) => candidate.id),
          ),
          inArray(idempotencyKeys.status, [
            IDEMPOTENCY_STATUS.COMPLETED,
            IDEMPOTENCY_STATUS.FAILED,
          ]),
          isNotNull(idempotencyKeys.expiresAt),
          lte(idempotencyKeys.expiresAt, now),
        ),
      )
      .returning({ id: idempotencyKeys.id });

    return deleted.length;
  }

  /** Applies one status update and returns the updated idempotency row when it exists. */
  private async updateStatus(
    id: string,
    status: IdempotencyStatus,
    values: {
      lockedUntil?: Date | null;
      responseStatus?: number | null;
      responseBody?: unknown;
    },
  ): Promise<IdempotencyKeyRow | null> {
    const [row] = await this.executor
      .update(idempotencyKeys)
      .set({
        status,
        updatedAt: new Date(),
        ...(values.lockedUntil !== undefined ? { lockedUntil: values.lockedUntil } : {}),
        ...(values.responseStatus !== undefined ? { responseStatus: values.responseStatus } : {}),
        ...(values.responseBody !== undefined ? { responseBody: values.responseBody } : {}),
      })
      .where(eq(idempotencyKeys.id, id))
      .returning();

    return row ?? null;
  }
}

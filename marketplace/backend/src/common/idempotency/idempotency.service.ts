import { env } from "../../config/env.js";
import type { IdempotencyKeyRow } from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODE } from "../errors/error-codes.js";
import {
  IDEMPOTENCY_STATUS,
  type IdempotencyReplay,
  type IdempotencyRequest,
} from "./idempotency.contract.js";
import { IdempotencyRepository } from "./idempotency.repository.js";

export type BeginIdempotentOperationResult =
  | { mode: "acquired"; recordId: string }
  | { mode: "replay"; replay: IdempotencyReplay };

/** Coordinates request de-duplication without owning HTTP response formatting. */
export class IdempotencyService {
  /** Stores the persistence gateway used to coordinate retry state. */
  constructor(private readonly repository = new IdempotencyRepository()) {}

  /** Creates an idempotency service that writes through the caller's existing database transaction. */
  static using(executor: DatabaseExecutor): IdempotencyService {
    return new IdempotencyService(new IdempotencyRepository(executor));
  }

  /** Acquires a new retry key, replays a completed result, or rejects an unsafe duplicate. */
  async begin(request: IdempotencyRequest, now = new Date()): Promise<BeginIdempotentOperationResult> {
    const existing = await this.repository.findByScopeAndKey(request.scope, request.key);
    if (existing) return this.resolveExisting(existing, request, now);

    const lockedUntil = new Date(now.getTime() + env.IDEMPOTENCY_LOCK_SECONDS * 1_000);
    const expiresAt = new Date(now.getTime() + env.IDEMPOTENCY_RETENTION_SECONDS * 1_000);
    const created = await this.repository.createProcessing({ ...request, lockedUntil, expiresAt });

    if (created) return { mode: "acquired", recordId: created.id };

    // Unique-key race: another request inserted after our first read.
    const raced = await this.repository.findByScopeAndKey(request.scope, request.key);
    if (!raced) {
      throw new AppError({
        code: ERROR_CODE.INTERNAL_ERROR,
        message: "Unable to resolve idempotency state.",
        statusCode: 500,
      });
    }

    return this.resolveExisting(raced, request, now);
  }

  /** Marks one idempotency record completed with the response needed for safe replay. */
  async complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void> {
    const row = await this.repository.markCompleted(recordId, { responseStatus: statusCode, responseBody });
    if (!row) throw this.missingStateError();
  }

  /** Marks one in-progress idempotency record failed so a later retry can proceed safely. */
  async fail(recordId: string): Promise<void> {
    const row = await this.repository.markFailed(recordId);
    if (!row) throw this.missingStateError();
  }

  /** Deletes a bounded batch of expired completed/failed keys while preserving active operations. */
  async cleanupExpiredIdempotencyKeys(limit = 100, now = new Date()): Promise<number> {
    return this.repository.deleteExpiredTerminalKeys(now, limit);
  }

  /** Resolves an existing key into replay, retry acquisition, or a stable conflict. */
  private async resolveExisting(
    row: IdempotencyKeyRow,
    request: IdempotencyRequest,
    now: Date,
  ): Promise<BeginIdempotentOperationResult> {
    if (row.requestHash !== request.requestHash) {
      throw new AppError({
        code: ERROR_CODE.IDEMPOTENCY_CONFLICT,
        message: "The idempotency key was already used with a different request.",
        statusCode: 409,
      });
    }

    if (row.status === IDEMPOTENCY_STATUS.COMPLETED) {
      if (row.responseStatus === null) throw this.missingStateError();
      return {
        mode: "replay",
        replay: { statusCode: row.responseStatus, responseBody: row.responseBody },
      };
    }

    const lockExpired = !row.lockedUntil || row.lockedUntil.getTime() <= now.getTime();
    if (row.status === IDEMPOTENCY_STATUS.FAILED || lockExpired) {
      const lockedUntil = new Date(now.getTime() + env.IDEMPOTENCY_LOCK_SECONDS * 1_000);
      const claimed = await this.repository.markProcessing(row.id, lockedUntil, now);
      if (claimed) return { mode: "acquired", recordId: claimed.id };
    }

    throw new AppError({
      code: ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
      message: "An identical operation is already being processed.",
      statusCode: 409,
    });
  }

  /** Creates the stable error returned when an idempotency record has an invalid state. */
  private missingStateError(): AppError {
    return new AppError({
      code: ERROR_CODE.INTERNAL_ERROR,
      message: "Idempotency state is inconsistent.",
      statusCode: 500,
    });
  }
}

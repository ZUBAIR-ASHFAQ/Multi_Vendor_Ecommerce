import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../database/db.js";
import { outboxEvents, type OutboxEventRow } from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { OUTBOX_STATUS, type DomainEvent } from "./outbox.contract.js";

export interface EnqueueOutboxEventInput<TPayload = unknown> extends DomainEvent<TPayload> {
  availableAt?: Date;
}

/** Persistence-only access for the transactional outbox. Publishing/retry policy belongs to services/workers. */
export class OutboxRepository {
  /** Stores the database executor so event writes can share the business transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Adds a pending event using the same executor/transaction as the business write. */
  async enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<OutboxEventRow> {
    const [row] = await this.executor
      .insert(outboxEvents)
      .values({
        eventType: input.eventType,
        payload: input.payload,
        status: OUTBOX_STATUS.PENDING,
        ...(input.aggregateType !== undefined ? { aggregateType: input.aggregateType } : {}),
        ...(input.aggregateId !== undefined ? { aggregateId: input.aggregateId } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
        ...(input.availableAt !== undefined ? { availableAt: input.availableAt } : {}),
      })
      .returning();

    if (!row) {
      throw new Error("Outbox insert completed without returning a row.");
    }

    return row;
  }

  /** Returns events currently eligible for dispatch in deterministic creation order. */
  async findDispatchable(now: Date, limit: number): Promise<OutboxEventRow[]> {
    return this.executor
      .select()
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.status, [
            OUTBOX_STATUS.PENDING,
            OUTBOX_STATUS.FAILED,
            OUTBOX_STATUS.PROCESSING,
          ]),
          lte(outboxEvents.availableAt, now),
        ),
      )
      .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.createdAt))
      .limit(limit);
  }

  /** Atomically leases one eligible event and increments its attempt counter. */
  async markProcessing(
    id: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<OutboxEventRow | null> {
    const [row] = await this.executor
      .update(outboxEvents)
      .set({
        status: OUTBOX_STATUS.PROCESSING,
        attempts: sql`${outboxEvents.attempts} + 1`,
        // available_at doubles as the retry time and PROCESSING lease expiry.
        availableAt: leaseUntil,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxEvents.id, id),
          inArray(outboxEvents.status, [
            OUTBOX_STATUS.PENDING,
            OUTBOX_STATUS.FAILED,
            OUTBOX_STATUS.PROCESSING,
          ]),
          lte(outboxEvents.availableAt, now),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Marks a successfully published event immutable from the dispatcher's perspective. */
  async markPublished(id: string, publishedAt = new Date()): Promise<OutboxEventRow | null> {
    const [row] = await this.executor
      .update(outboxEvents)
      .set({
        status: OUTBOX_STATUS.PUBLISHED,
        publishedAt,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, id))
      .returning();

    return row ?? null;
  }

  /** Records a failed publish attempt and schedules when it may be retried. */
  async markFailed(
    id: string,
    lastError: string,
    availableAt: Date,
  ): Promise<OutboxEventRow | null> {
    const [row] = await this.executor
      .update(outboxEvents)
      .set({
        status: OUTBOX_STATUS.FAILED,
        lastError,
        availableAt,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, id))
      .returning();

    return row ?? null;
  }
}

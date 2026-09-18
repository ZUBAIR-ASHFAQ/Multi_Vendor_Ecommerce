import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditRepository } from "../../src/common/audit/audit.repository.js";
import { IDEMPOTENCY_STATUS } from "../../src/common/idempotency/idempotency.contract.js";
import { IdempotencyRepository } from "../../src/common/idempotency/idempotency.repository.js";
import { IdempotencyService } from "../../src/common/idempotency/idempotency.service.js";
import { OUTBOX_STATUS } from "../../src/common/outbox/outbox.contract.js";
import { OutboxRepository } from "../../src/common/outbox/outbox.repository.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { withTransaction } from "../../src/database/transaction.js";

/** Clears Foundation persistence tables so each integration test starts from a known state. */
async function clearFoundationTables(): Promise<void> {
  await databasePool.query("TRUNCATE TABLE audit_logs, outbox_events, idempotency_keys RESTART IDENTITY CASCADE");
}

beforeAll(async () => {
  await databasePool.query("select 1");
});

beforeEach(async () => {
  await clearFoundationTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Foundation PostgreSQL persistence", () => {
  it("rolls back every repository write when a transaction fails", async () => {
    await expect(
      withTransaction(async (transaction) => {
        await new AuditRepository(transaction).append({
          actorType: ACTOR_TYPE.SYSTEM,
          action: "foundation.rollback_test",
          entityType: "test",
          entityId: "rollback",
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const result = await databasePool.query<{ count: number }>(
      "select count(*)::int as count from audit_logs",
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it("acquires, completes and replays an idempotent operation exactly once", async () => {
    const service = new IdempotencyService(new IdempotencyRepository());
    const request = {
      scope: "checkout.confirm",
      key: `checkout-${randomUUID()}`,
      requestHash: "a".repeat(64),
    };

    const first = await service.begin(request);
    expect(first.mode).toBe("acquired");
    if (first.mode !== "acquired") throw new Error("Expected acquired idempotency state");

    await service.complete(first.recordId, 201, { orderId: "order-1" });
    const replay = await service.begin(request);
    expect(replay).toEqual({
      mode: "replay",
      replay: { statusCode: 201, responseBody: { orderId: "order-1" } },
    });

    const rows = await databasePool.query<{ status: string; count: number }>(
      "select status, count(*)::int as count from idempotency_keys group by status",
    );
    expect(rows.rows).toEqual([{ status: IDEMPOTENCY_STATUS.COMPLETED, count: 1 }]);
  });

  it("deletes only expired terminal idempotency records in bounded batches", async () => {
    const repository = new IdempotencyRepository();
    const now = new Date("2030-01-01T00:00:00.000Z");

    const expiredCompleted = await repository.createProcessing({
      scope: "checkout.confirm",
      key: `expired-completed-${randomUUID()}`,
      requestHash: "d".repeat(64),
      expiresAt: new Date(now.getTime() - 4_000),
    });
    if (!expiredCompleted) throw new Error("Expected expired completed fixture to be created.");
    await repository.markCompleted(expiredCompleted.id, {
      responseStatus: 201,
      responseBody: { orderId: "expired-order" },
    });

    const expiredFailed = await repository.createProcessing({
      scope: "payments.capture",
      key: `expired-failed-${randomUUID()}`,
      requestHash: "e".repeat(64),
      expiresAt: new Date(now.getTime() - 3_000),
    });
    if (!expiredFailed) throw new Error("Expected expired failed fixture to be created.");
    await repository.markFailed(expiredFailed.id);

    await repository.createProcessing({
      scope: "inventory.reserve",
      key: `expired-processing-${randomUUID()}`,
      requestHash: "f".repeat(64),
      expiresAt: new Date(now.getTime() - 2_000),
    });

    const freshCompleted = await repository.createProcessing({
      scope: "documents.link",
      key: `fresh-completed-${randomUUID()}`,
      requestHash: "1".repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    if (!freshCompleted) throw new Error("Expected fresh completed fixture to be created.");
    await repository.markCompleted(freshCompleted.id, {
      responseStatus: 200,
      responseBody: { linked: true },
    });

    const service = new IdempotencyService(repository);
    await expect(service.cleanupExpiredIdempotencyKeys(1, now)).resolves.toBe(1);
    await expect(service.cleanupExpiredIdempotencyKeys(10, now)).resolves.toBe(1);
    await expect(service.cleanupExpiredIdempotencyKeys(10, now)).resolves.toBe(0);

    const remaining = await databasePool.query<{ status: string; expires_at: Date | null }>(
      "select status, expires_at from idempotency_keys order by created_at, id",
    );
    expect(remaining.rows).toHaveLength(2);
    expect(remaining.rows.map((row) => row.status).sort()).toEqual([
      IDEMPOTENCY_STATUS.COMPLETED,
      IDEMPOTENCY_STATUS.PROCESSING,
    ]);
    expect(remaining.rows.some((row) => row.expires_at && row.expires_at > now)).toBe(true);
    expect(
      remaining.rows.some(
        (row) =>
          row.status === IDEMPOTENCY_STATUS.PROCESSING &&
          row.expires_at !== null &&
          row.expires_at <= now,
      ),
    ).toBe(true);
  });

  it("rejects a duplicate in-flight request and conflicting reuse of the same key", async () => {
    const service = new IdempotencyService(new IdempotencyRepository());
    const key = `payment-${randomUUID()}`;
    const initial = {
      scope: "payments.capture",
      key,
      requestHash: "b".repeat(64),
    };

    await service.begin(initial);

    await expect(service.begin(initial)).rejects.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      statusCode: 409,
    });

    await expect(
      service.begin({ ...initial, requestHash: "c".repeat(64) }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("writes audit and outbox records atomically through one transaction executor", async () => {
    const requestId = randomUUID();

    await withTransaction(async (transaction) => {
      await new AuditRepository(transaction).append({
        actorType: ACTOR_TYPE.SYSTEM,
        action: "foundation.atomic_test",
        entityType: "test",
        entityId: "entity-1",
        requestId,
        after: { status: "created" },
      });

      await new OutboxRepository(transaction).enqueue({
        eventType: "foundation.test_created",
        aggregateType: "test",
        aggregateId: "entity-1",
        payload: { requestId },
      });
    });

    const audit = await databasePool.query<{ action: string; request_id: string }>(
      "select action, request_id from audit_logs",
    );
    const outbox = await databasePool.query<{ event_type: string; status: string; attempts: number }>(
      "select event_type, status, attempts from outbox_events",
    );

    expect(audit.rows).toEqual([{ action: "foundation.atomic_test", request_id: requestId }]);
    expect(outbox.rows).toEqual([
      { event_type: "foundation.test_created", status: OUTBOX_STATUS.PENDING, attempts: 0 },
    ]);
  });
});

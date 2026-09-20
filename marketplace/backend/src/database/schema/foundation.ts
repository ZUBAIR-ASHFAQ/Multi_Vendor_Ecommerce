import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Stores retry keys for operations that must not be executed more than once.
 * Business modules will consume this infrastructure in later passes.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 100 }).notNull(),
    key: varchar("key", { length: 200 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_scope_key_uq").on(table.scope, table.key),
    index("idempotency_keys_status_expires_idx").on(table.status, table.expiresAt),
    check(
      "idempotency_keys_status_check",
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
    check(
      "idempotency_keys_response_status_check",
      sql`${table.responseStatus} is null or (${table.responseStatus} between 100 and 599)`,
    ),
  ],
);

/**
 * Transactional outbox rows. Publishing/worker behavior is implemented in a later Foundation pass.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: varchar("event_type", { length: 200 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 100 }),
    aggregateId: varchar("aggregate_id", { length: 200 }),
    payload: jsonb("payload").notNull(),
    headers: jsonb("headers"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("outbox_events_dispatch_idx").on(table.status, table.availableAt),
    index("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId),
    check(
      "outbox_events_status_check",
      sql`${table.status} in ('pending', 'processing', 'published', 'failed')`,
    ),
    check("outbox_events_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;

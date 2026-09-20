import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { orders } from "./orders.js";

/** Stores one provider-neutral Payment aggregate for exactly one Customer Order. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerPaymentId: varchar("provider_payment_id", { length: 255 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    amountAuthorized: numeric("amount_authorized", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    amountCaptured: numeric("amount_captured", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    amountRefunded: numeric("amount_refunded", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_order_uq").on(table.orderId),
    uniqueIndex("payments_provider_payment_uq").on(table.providerPaymentId),
    index("payments_status_created_idx").on(table.status, table.createdAt),
    index("payments_provider_status_created_idx").on(
      table.provider,
      table.status,
      table.createdAt,
    ),
    index("payments_updated_idx").on(table.updatedAt),
    check(
      "payments_provider_normalized_check",
      sql`${table.provider} = lower(btrim(${table.provider})) and length(${table.provider}) > 0`,
    ),
    check(
      "payments_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check("payments_amount_authorized_nonnegative_check", sql`${table.amountAuthorized} >= 0`),
    check("payments_amount_captured_nonnegative_check", sql`${table.amountCaptured} >= 0`),
    check("payments_amount_refunded_nonnegative_check", sql`${table.amountRefunded} >= 0`),
    check(
      "payments_amount_refunded_not_over_captured_check",
      sql`${table.amountRefunded} <= ${table.amountCaptured}`,
    ),
    check(
      "payments_status_check",
      sql`${table.status} in ('pending', 'processing', 'captured', 'failed', 'cancelled', 'partially_refunded', 'refunded')`,
    ),
    check(
      "payments_idempotency_key_check",
      sql`${table.idempotencyKey} is null or ${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** Stores one verified provider webhook delivery without retaining its raw request body. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 160 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 40 }).notNull().default("received"),
    errorCode: varchar("error_code", { length: 120 }),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_event_uq").on(
      table.provider,
      table.providerEventId,
    ),
    index("payment_webhook_events_status_received_idx").on(table.status, table.receivedAt),
    index("payment_webhook_events_type_received_idx").on(table.eventType, table.receivedAt),
    check(
      "payment_webhook_events_provider_normalized_check",
      sql`${table.provider} = lower(btrim(${table.provider})) and length(${table.provider}) > 0`,
    ),
    check(
      "payment_webhook_events_event_id_not_blank_check",
      sql`length(btrim(${table.providerEventId})) > 0`,
    ),
    check(
      "payment_webhook_events_event_type_not_blank_check",
      sql`length(btrim(${table.eventType})) > 0`,
    ),
    check(
      "payment_webhook_events_payload_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "payment_webhook_events_status_check",
      sql`${table.status} in ('received', 'processing', 'processed', 'ignored', 'failed')`,
    ),
    check(
      "payment_webhook_events_processed_at_check",
      sql`${table.processedAt} is null or ${table.processedAt} >= ${table.receivedAt}`,
    ),
    check(
      "payment_webhook_events_error_code_check",
      sql`${table.errorCode} is null or length(btrim(${table.errorCode})) > 0`,
    ),
  ],
);

/** Stores append-only Payment intent/capture/refund/failure transaction history. */
export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 40 }).notNull(),
    providerTxnId: varchar("provider_txn_id", { length: 255 }),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    rawEventId: uuid("raw_event_id").references(() => paymentWebhookEvents.id, {
      onDelete: "restrict",
    }),
    sourceKey: varchar("source_key", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_transactions_provider_txn_uq").on(table.providerTxnId),
    uniqueIndex("payment_transactions_source_key_uq").on(table.sourceKey),
    index("payment_transactions_payment_occurred_idx").on(table.paymentId, table.occurredAt),
    index("payment_transactions_type_status_idx").on(table.type, table.status, table.occurredAt),
    index("payment_transactions_raw_event_idx").on(table.rawEventId),
    check(
      "payment_transactions_type_check",
      sql`${table.type} in ('intent', 'authorize', 'capture', 'refund', 'failure')`,
    ),
    check(
      "payment_transactions_status_check",
      sql`${table.status} in ('pending', 'succeeded', 'failed')`,
    ),
    check("payment_transactions_amount_nonnegative_check", sql`${table.amount} >= 0`),
    check(
      "payment_transactions_provider_txn_not_blank_check",
      sql`${table.providerTxnId} is null or length(btrim(${table.providerTxnId})) > 0`,
    ),
    check(
      "payment_transactions_source_key_not_blank_check",
      sql`${table.sourceKey} is null or length(btrim(${table.sourceKey})) > 0`,
    ),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type PaymentTransactionRow = typeof paymentTransactions.$inferSelect;
export type PaymentWebhookEventRow = typeof paymentWebhookEvents.$inferSelect;

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";
import { outboxEvents } from "./foundation.js";

/** Stores versioned notification templates for one supported delivery channel. */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_templates_code_channel_version_uq").on(
      table.code,
      table.channel,
      table.version,
    ),
    uniqueIndex("notification_templates_one_active_uq")
      .on(table.code, table.channel)
      .where(sql`${table.status} = 'active'`),
    index("notification_templates_status_channel_idx").on(
      table.status,
      table.channel,
      table.code,
    ),
    check(
      "notification_templates_channel_check",
      sql`${table.channel} in ('in_app', 'email')`,
    ),
    check(
      "notification_templates_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check("notification_templates_version_check", sql`${table.version} > 0`),
    check(
      "notification_templates_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      "notification_templates_subject_not_blank_check",
      sql`${table.subjectTemplate} is null or length(btrim(${table.subjectTemplate})) > 0`,
    ),
    check(
      "notification_templates_body_not_blank_check",
      sql`length(btrim(${table.bodyTemplate})) > 0`,
    ),
  ],
);

/** Stores the durable in-app notification record and per-user read state. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 120 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body").notNull(),
    dataJson: jsonb("data_json").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt,
      table.id,
    ),
    index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    check(
      "notifications_type_normalized_check",
      sql`${table.type} = lower(btrim(${table.type})) and ${table.type} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check("notifications_title_not_blank_check", sql`length(btrim(${table.title})) > 0`),
    check("notifications_body_not_blank_check", sql`length(btrim(${table.body})) > 0`),
    check(
      "notifications_read_at_time_check",
      sql`${table.readAt} is null or ${table.readAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Stores one retryable delivery attempt stream for one committed outbox event, user, and channel.
 * source_event_id is persistence support for the required event/recipient/channel idempotency rule.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "restrict",
    }),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: varchar("channel", { length: 20 }).notNull(),
    templateCode: varchar("template_code", { length: 120 }).notNull(),
    destinationMasked: varchar("destination_masked", { length: 320 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    providerRef: varchar("provider_ref", { length: 255 }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_event_user_channel_uq").on(
      table.sourceEventId,
      table.userId,
      table.channel,
    ),
    index("notification_deliveries_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index("notification_deliveries_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("notification_deliveries_notification_idx").on(table.notificationId),
    check(
      "notification_deliveries_channel_check",
      sql`${table.channel} in ('in_app', 'email')`,
    ),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} in ('queued', 'processing', 'sent', 'failed')`,
    ),
    check("notification_deliveries_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "notification_deliveries_template_code_normalized_check",
      sql`${table.templateCode} = lower(btrim(${table.templateCode})) and ${table.templateCode} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      "notification_deliveries_destination_not_blank_check",
      sql`length(btrim(${table.destinationMasked})) > 0`,
    ),
    check(
      "notification_deliveries_provider_ref_not_blank_check",
      sql`${table.providerRef} is null or length(btrim(${table.providerRef})) > 0`,
    ),
    check(
      "notification_deliveries_error_code_not_blank_check",
      sql`${table.lastErrorCode} is null or length(btrim(${table.lastErrorCode})) > 0`,
    ),
  ],
);

/** Stores one user's enable/disable choice for one domain event and delivery channel. */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventCode: varchar("event_code", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.eventCode, table.channel],
      name: "notification_preferences_pk",
    }),
    index("notification_preferences_event_channel_idx").on(
      table.eventCode,
      table.channel,
      table.enabled,
    ),
    check(
      "notification_preferences_channel_check",
      sql`${table.channel} in ('in_app', 'email')`,
    ),
    check(
      "notification_preferences_event_code_normalized_check",
      sql`${table.eventCode} = lower(btrim(${table.eventCode})) and ${table.eventCode} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
  ],
);

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplateRow = typeof notificationTemplates.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRow = typeof notificationPreferences.$inferInsert;

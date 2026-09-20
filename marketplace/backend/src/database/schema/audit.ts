import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";

/**
 * Safe metadata for objects stored in S3/R2-compatible storage.
 * Business tables keep file IDs/links instead of binary blobs or permanent public URLs.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storageProvider: varchar("storage_provider", { length: 40 })
      .notNull()
      .default("s3_compatible"),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    purpose: varchar("purpose", { length: 100 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 128 }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("files_object_key_uq").on(table.objectKey),
    index("files_owner_user_idx").on(table.ownerUserId, table.createdAt),
    index("files_status_created_idx").on(table.status, table.createdAt),
    check(
      "files_storage_provider_check",
      sql`${table.storageProvider} in ('s3', 'r2', 's3_compatible')`,
    ),
    check(
      "files_status_check",
      sql`${table.status} in ('pending', 'confirmed', 'failed')`,
    ),
    check(
      "files_purpose_check",
      sql`${table.purpose} in ('product_media', 'seller_verification', 'store_asset', 'report_export', 'operational_evidence')`,
    ),
    check("files_size_bytes_check", sql`${table.sizeBytes} > 0`),
    check("files_object_key_not_blank_check", sql`length(btrim(${table.objectKey})) > 0`),
    check(
      "files_original_name_not_blank_check",
      sql`length(btrim(${table.originalName})) > 0`,
    ),
    check("files_mime_type_not_blank_check", sql`length(btrim(${table.mimeType})) > 0`),
  ],
);

/** Links one confirmed file to an authorized business resource without coupling to future module tables. */
export const fileLinks = pgTable(
  "file_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    purpose: varchar("purpose", { length: 100 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("file_links_resource_file_purpose_uq").on(
      table.fileId,
      table.resourceType,
      table.resourceId,
      table.purpose,
    ),
    index("file_links_file_idx").on(table.fileId, table.createdAt),
    index("file_links_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    index("file_links_created_by_idx").on(table.createdBy, table.createdAt),
    check(
      "file_links_resource_type_not_blank_check",
      sql`length(btrim(${table.resourceType})) > 0`,
    ),
    check(
      "file_links_purpose_not_blank_check",
      sql`length(btrim(${table.purpose})) > 0`,
    ),
    check(
      "file_links_purpose_check",
      sql`${table.purpose} in ('product_media', 'seller_verification', 'store_asset', 'report_export', 'operational_evidence')`,
    ),
  ],
);

/**
 * Cross-module append-only audit history. The migration preserves all Foundation/Module 2 rows
 * while renaming the physical table/columns to the Module 21 contract.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id"),
    actorType: varchar("actor_type", { length: 30 }).notNull().default("system"),
    action: varchar("action", { length: 150 }).notNull(),
    resourceType: varchar("resource_type", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 200 }),
    sellerId: uuid("seller_id"),
    requestId: varchar("request_id", { length: 100 }),
    beforeJsonRedacted: jsonb("before_json_redacted"),
    afterJsonRedacted: jsonb("after_json_redacted"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_request_idx").on(table.requestId),
    index("audit_logs_seller_idx").on(table.sellerId, table.createdAt),
    index("audit_logs_action_idx").on(table.action, table.createdAt),
    index("audit_logs_created_idx").on(table.createdAt),
    check(
      "audit_logs_actor_type_check",
      sql`${table.actorType} in ('system', 'platform_admin', 'seller', 'customer')`,
    ),
    check("audit_logs_action_not_blank_check", sql`length(btrim(${table.action})) > 0`),
    check(
      "audit_logs_resource_type_not_blank_check",
      sql`length(btrim(${table.resourceType})) > 0`,
    ),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
export type FileLinkRow = typeof fileLinks.$inferSelect;
export type NewFileLinkRow = typeof fileLinks.$inferInsert;
export type AuditLogRow = typeof auditLogs.$inferSelect;

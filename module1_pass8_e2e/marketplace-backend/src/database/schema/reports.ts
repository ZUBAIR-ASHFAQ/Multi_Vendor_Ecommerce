import { sql } from "drizzle-orm";
import {
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
import { files } from "./audit.js";

/** Stores one stable report definition used by the permission-filtered report catalog. */
export const reportDefinitions = pgTable(
  "report_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    domain: varchar("domain", { length: 80 }).notNull(),
    requiredPermissions: jsonb("required_permissions").notNull(),
    filterSchemaJson: jsonb("filter_schema_json").notNull().default({}),
    outputFormats: jsonb("output_formats").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("report_definitions_code_uq").on(table.code),
    index("report_definitions_domain_status_idx").on(
      table.domain,
      table.status,
      table.code,
    ),
    check(
      "report_definitions_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      "report_definitions_domain_normalized_check",
      sql`${table.domain} = lower(btrim(${table.domain})) and ${table.domain} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      "report_definitions_required_permissions_check",
      sql`jsonb_typeof(${table.requiredPermissions}) = 'array' and jsonb_array_length(${table.requiredPermissions}) > 0`,
    ),
    check(
      "report_definitions_filter_schema_check",
      sql`jsonb_typeof(${table.filterSchemaJson}) = 'object'`,
    ),
    check(
      "report_definitions_output_formats_check",
      sql`jsonb_typeof(${table.outputFormats}) = 'array'
        and jsonb_array_length(${table.outputFormats}) > 0
        and ${table.outputFormats} <@ '["csv", "pdf"]'::jsonb`,
    ),
    check(
      "report_definitions_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
);

/** Stores one asynchronous report export request and its generated Module 21 file reference. */
export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportCode: varchar("report_code", { length: 120 })
      .notNull()
      .references(() => reportDefinitions.code, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    filtersJson: jsonb("filters_json").notNull().default({}),
    outputFormat: varchar("output_format", { length: 10 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    errorCode: varchar("error_code", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("report_runs_requester_created_idx").on(
      table.requestedBy,
      table.createdAt,
      table.id,
    ),
    index("report_runs_report_created_idx").on(
      table.reportCode,
      table.createdAt,
      table.id,
    ),
    index("report_runs_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("report_runs_file_uq").on(table.fileId).where(sql`${table.fileId} is not null`),
    check(
      "report_runs_report_code_normalized_check",
      sql`${table.reportCode} = lower(btrim(${table.reportCode})) and ${table.reportCode} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check("report_runs_filters_check", sql`jsonb_typeof(${table.filtersJson}) = 'object'`),
    check("report_runs_output_format_check", sql`${table.outputFormat} in ('csv', 'pdf')`),
    check(
      "report_runs_status_check",
      sql`${table.status} in ('queued', 'processing', 'completed', 'failed')`,
    ),
    check(
      "report_runs_started_at_check",
      sql`${table.startedAt} is null or ${table.startedAt} >= ${table.createdAt}`,
    ),
    check(
      "report_runs_finished_at_check",
      sql`${table.finishedAt} is null or (${table.startedAt} is not null and ${table.finishedAt} >= ${table.startedAt})`,
    ),
    check(
      "report_runs_error_code_not_blank_check",
      sql`${table.errorCode} is null or length(btrim(${table.errorCode})) > 0`,
    ),
  ],
);

/** Stores one reusable report-filter preset owned by one authenticated user. */
export const savedReportFilters = pgTable(
  "saved_report_filters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportCode: varchar("report_code", { length: 120 })
      .notNull()
      .references(() => reportDefinitions.code, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    filtersJson: jsonb("filters_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("saved_report_filters_user_report_name_uq").on(
      table.userId,
      table.reportCode,
      table.name,
    ),
    index("saved_report_filters_user_report_created_idx").on(
      table.userId,
      table.reportCode,
      table.createdAt,
      table.id,
    ),
    check(
      "saved_report_filters_report_code_normalized_check",
      sql`${table.reportCode} = lower(btrim(${table.reportCode})) and ${table.reportCode} ~ '^[a-z][a-z0-9_.-]*$'`,
    ),
    check(
      "saved_report_filters_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "saved_report_filters_filters_check",
      sql`jsonb_typeof(${table.filtersJson}) = 'object'`,
    ),
  ],
);

export type ReportDefinitionRow = typeof reportDefinitions.$inferSelect;
export type ReportRunRow = typeof reportRuns.$inferSelect;

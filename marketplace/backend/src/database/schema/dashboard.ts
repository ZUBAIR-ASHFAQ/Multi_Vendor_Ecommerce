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
import { stores } from "./sellers.js";

/** Stores one authenticated user's Dashboard layout and default filter preferences. */
export const dashboardPreferences = pgTable(
  "dashboard_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    layoutJson: jsonb("layout_json").notNull().default({}),
    defaultDateRange: varchar("default_date_range", { length: 40 }).notNull(),
    defaultStoreId: uuid("default_store_id").references(() => stores.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dashboard_preferences_user_uq").on(table.userId),
    index("dashboard_preferences_default_store_idx").on(table.defaultStoreId),
    check(
      "dashboard_preferences_layout_check",
      sql`jsonb_typeof(${table.layoutJson}) = 'object'`,
    ),
    check(
      "dashboard_preferences_default_date_range_not_blank_check",
      sql`length(btrim(${table.defaultDateRange})) > 0`,
    ),
  ],
);

/** Stores one named Dashboard filter preset owned by one authenticated user. */
export const dashboardSavedFilters = pgTable(
  "dashboard_saved_filters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    filterJson: jsonb("filter_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("dashboard_saved_filters_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    check(
      "dashboard_saved_filters_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "dashboard_saved_filters_filter_check",
      sql`jsonb_typeof(${table.filterJson}) = 'object'`,
    ),
  ],
);

export type DashboardPreferenceRow = typeof dashboardPreferences.$inferSelect;
export type DashboardSavedFilterRow = typeof dashboardSavedFilters.$inferSelect;
export type NewDashboardSavedFilterRow = typeof dashboardSavedFilters.$inferInsert;

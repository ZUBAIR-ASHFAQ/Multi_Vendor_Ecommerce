import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";

/**
 * One-to-one customer commerce profile for an existing Module 2 user identity.
 * Authentication/account authority stays in users; this row owns customer-facing commerce data.
 */
export const customerProfiles = pgTable(
  "customer_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("customer_profiles_status_created_idx").on(table.status, table.createdAt),
    check(
      "customer_profiles_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "customer_profiles_display_name_not_blank_check",
      sql`length(btrim(${table.displayName})) > 0`,
    ),
    check(
      "customer_profiles_phone_not_blank_check",
      sql`${table.phone} is null or length(btrim(${table.phone})) > 0`,
    ),
  ],
);

/**
 * Saved shipping/billing address owned by one customer profile.
 * Archive status preserves historical identity while preventing archived rows from remaining defaults.
 */
export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id").notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    recipientName: varchar("recipient_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    line1: varchar("line1", { length: 255 }).notNull(),
    line2: varchar("line2", { length: 255 }),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }).notNull(),
    postalCode: varchar("postal_code", { length: 32 }),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    isDefaultShipping: boolean("is_default_shipping").notNull().default(false),
    isDefaultBilling: boolean("is_default_billing").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "customer_addresses_customer_profile_fk",
      columns: [table.customerUserId],
      foreignColumns: [customerProfiles.userId],
    }).onDelete("restrict"),
    index("customer_addresses_customer_status_idx").on(
      table.customerUserId,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("customer_addresses_id_customer_uq").on(
      table.id,
      table.customerUserId,
    ),
    uniqueIndex("customer_addresses_default_shipping_uq")
      .on(table.customerUserId)
      .where(sql`${table.status} = 'active' and ${table.isDefaultShipping} = true`),
    uniqueIndex("customer_addresses_default_billing_uq")
      .on(table.customerUserId)
      .where(sql`${table.status} = 'active' and ${table.isDefaultBilling} = true`),
    check(
      "customer_addresses_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
    check(
      "customer_addresses_archived_defaults_check",
      sql`${table.status} = 'active' or (${table.isDefaultShipping} = false and ${table.isDefaultBilling} = false)`,
    ),
    check("customer_addresses_label_not_blank_check", sql`length(btrim(${table.label})) > 0`),
    check(
      "customer_addresses_recipient_name_not_blank_check",
      sql`length(btrim(${table.recipientName})) > 0`,
    ),
    check("customer_addresses_phone_not_blank_check", sql`length(btrim(${table.phone})) > 0`),
    check("customer_addresses_line1_not_blank_check", sql`length(btrim(${table.line1})) > 0`),
    check("customer_addresses_city_not_blank_check", sql`length(btrim(${table.city})) > 0`),
    check("customer_addresses_region_not_blank_check", sql`length(btrim(${table.region})) > 0`),
    check(
      "customer_addresses_line2_not_blank_check",
      sql`${table.line2} is null or length(btrim(${table.line2})) > 0`,
    ),
    check(
      "customer_addresses_postal_code_not_blank_check",
      sql`${table.postalCode} is null or length(btrim(${table.postalCode})) > 0`,
    ),
    check(
      "customer_addresses_country_code_check",
      sql`${table.countryCode} = upper(btrim(${table.countryCode})) and ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

export type CustomerProfileRow = typeof customerProfiles.$inferSelect;
export type CustomerAddressRow = typeof customerAddresses.$inferSelect;

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
  text,
} from "drizzle-orm/pg-core";
import { files } from "./audit.js";
import { users } from "./administration.js";

/** Seller application history submitted by an authenticated marketplace user. */
export const sellerApplications = pgTable(
  "seller_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    payloadJson: jsonb("payload_json").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("submitted"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_applications_open_applicant_uq")
      .on(table.applicantUserId)
      .where(sql`${table.status} = 'submitted'`),
    index("seller_applications_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("seller_applications_applicant_created_idx").on(
      table.applicantUserId,
      table.createdAt,
    ),
    index("seller_applications_reviewer_idx").on(
      table.reviewedBy,
      table.reviewedAt,
    ),
    check(
      "seller_applications_status_check",
      sql`${table.status} in ('submitted', 'approved', 'rejected')`,
    ),
    check(
      "seller_applications_payload_object_check",
      sql`jsonb_typeof(${table.payloadJson}) = 'object'`,
    ),
    check(
      "seller_applications_review_state_check",
      sql`(
        ${table.status} = 'submitted'
        and ${table.reviewedBy} is null
        and ${table.reviewedAt} is null
        and ${table.reason} is null
      ) or (
        ${table.status} = 'approved'
        and ${table.reviewedBy} is not null
        and ${table.reviewedAt} is not null
        and ${table.reason} is null
      ) or (
        ${table.status} = 'rejected'
        and ${table.reviewedBy} is not null
        and ${table.reviewedAt} is not null
        and length(btrim(${table.reason})) > 0
      )`,
    ),
  ],
);

/** Approved seller master used as the ownership boundary for stores and seller-scoped access. */
export const sellers = pgTable(
  "sellers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    legalName: varchar("legal_name", { length: 220 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    taxId: varchar("tax_id", { length: 120 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    approvalStatus: varchar("approval_status", { length: 20 })
      .notNull()
      .default("approved"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sellers_owner_user_uq").on(table.ownerUserId),
    index("sellers_status_approval_idx").on(
      table.status,
      table.approvalStatus,
      table.createdAt,
    ),
    check(
      "sellers_status_check",
      sql`${table.status} in ('active', 'suspended')`,
    ),
    check(
      "sellers_approval_status_check",
      sql`${table.approvalStatus} = 'approved'`,
    ),
    check(
      "sellers_legal_name_not_blank_check",
      sql`length(btrim(${table.legalName})) > 0`,
    ),
    check(
      "sellers_display_name_not_blank_check",
      sql`length(btrim(${table.displayName})) > 0`,
    ),
    check(
      "sellers_tax_id_not_blank_check",
      sql`${table.taxId} is null or length(btrim(${table.taxId})) > 0`,
    ),
  ],
);

/** Storefront identity owned by one approved seller. */
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    logoFileId: uuid("logo_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    defaultCurrency: varchar("default_currency", { length: 3 }).notNull(),
    supportEmail: varchar("support_email", { length: 320 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stores_slug_uq").on(table.slug),
    uniqueIndex("stores_id_seller_uq").on(table.id, table.sellerId),
    index("stores_seller_status_idx").on(
      table.sellerId,
      table.status,
      table.createdAt,
    ),
    index("stores_logo_file_idx").on(table.logoFileId),
    check(
      "stores_status_check",
      sql`${table.status} in ('active', 'inactive', 'suspended')`,
    ),
    check(
      "stores_slug_normalized_check",
      sql`${table.slug} = lower(btrim(${table.slug})) and ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "stores_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "stores_description_not_blank_check",
      sql`${table.description} is null or length(btrim(${table.description})) > 0`,
    ),
    check(
      "stores_currency_check",
      sql`${table.defaultCurrency} = upper(btrim(${table.defaultCurrency})) and ${table.defaultCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "stores_support_email_normalized_check",
      sql`${table.supportEmail} is null or (
        ${table.supportEmail} = lower(btrim(${table.supportEmail}))
        and length(${table.supportEmail}) between 3 and 320
      )`,
    ),
  ],
);

/** Seller staff membership synchronized with seller-scoped Module 2 role assignments. */
export const sellerStaff = pgTable(
  "seller_staff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("seller_staff_seller_user_uq").on(table.sellerId, table.userId),
    index("seller_staff_user_status_idx").on(
      table.userId,
      table.status,
      table.sellerId,
    ),
    index("seller_staff_seller_status_idx").on(
      table.sellerId,
      table.status,
      table.joinedAt,
    ),
    check(
      "seller_staff_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
);

export type SellerApplicationRow = typeof sellerApplications.$inferSelect;
export type NewSellerApplicationRow = typeof sellerApplications.$inferInsert;
export type SellerRow = typeof sellers.$inferSelect;
export type NewSellerRow = typeof sellers.$inferInsert;
export type StoreRow = typeof stores.$inferSelect;
export type NewStoreRow = typeof stores.$inferInsert;
export type SellerStaffRow = typeof sellerStaff.$inferSelect;

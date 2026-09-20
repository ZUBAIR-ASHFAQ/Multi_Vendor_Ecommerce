import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customerProfiles } from "./customers.js";
import { orders } from "./orders.js";
import { sellers } from "./sellers.js";

/** Stores one marketplace- or seller-owned discount rule and its funding owner. */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerType: varchar("owner_type", { length: 20 }).notNull(),
    sellerId: uuid("seller_id").references(() => sellers.id, {
      onDelete: "restrict",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    value: numeric("value", { precision: 18, scale: 4 }).notNull(),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    fundingType: varchar("funding_type", { length: 20 }).notNull(),
  },
  (table) => [
    index("promotions_seller_status_window_idx").on(
      table.sellerId,
      table.status,
      table.startAt,
      table.endAt,
    ),
    index("promotions_owner_status_window_idx").on(
      table.ownerType,
      table.status,
      table.startAt,
      table.endAt,
    ),
    check(
      "promotions_owner_type_check",
      sql`${table.ownerType} in ('platform', 'seller')`,
    ),
    check(
      "promotions_owner_seller_check",
      sql`(
        (${table.ownerType} = 'platform' and ${table.sellerId} is null)
        or (${table.ownerType} = 'seller' and ${table.sellerId} is not null)
      )`,
    ),
    check("promotions_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check(
      "promotions_type_normalized_check",
      sql`${table.type} = lower(btrim(${table.type})) and length(${table.type}) > 0`,
    ),
    check("promotions_value_positive_check", sql`${table.value} > 0`),
    check(
      "promotions_percentage_bounded_check",
      sql`lower(btrim(${table.type})) <> 'percentage' or ${table.value} <= 100`,
    ),
    check("promotions_date_range_check", sql`${table.startAt} < ${table.endAt}`),
    check(
      "promotions_status_check",
      sql`${table.status} in ('draft', 'scheduled', 'active', 'inactive')`,
    ),
    check(
      "promotions_funding_type_check",
      sql`${table.fundingType} in ('platform', 'seller')`,
    ),
    check(
      "promotions_seller_funding_check",
      sql`${table.ownerType} <> 'seller' or ${table.fundingType} = 'seller'`,
    ),
  ],
);

/** Stores one eligibility target for a promotion without duplicating Product/Catalog ownership data. */
export const promotionScopes = pgTable(
  "promotion_scopes",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    scopeType: varchar("scope_type", { length: 40 }).notNull(),
    scopeId: uuid("scope_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.promotionId, table.scopeType, table.scopeId],
      name: "promotion_scopes_pk",
    }),
    index("promotion_scopes_target_idx").on(
      table.scopeType,
      table.scopeId,
      table.promotionId,
    ),
    check(
      "promotion_scopes_type_normalized_check",
      sql`${table.scopeType} = lower(btrim(${table.scopeType})) and length(${table.scopeType}) > 0`,
    ),
  ],
);

/** Stores one optional customer-facing coupon code attached to a promotion. */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 120 }).notNull(),
    maxUses: integer("max_uses"),
    maxUsesPerCustomer: integer("max_uses_per_customer"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
  },
  (table) => [
    uniqueIndex("coupons_code_uq").on(table.code),
    index("coupons_promotion_status_idx").on(table.promotionId, table.status),
    check(
      "coupons_code_normalized_check",
      sql`${table.code} = upper(btrim(${table.code})) and length(${table.code}) > 0`,
    ),
    check("coupons_max_uses_check", sql`${table.maxUses} is null or ${table.maxUses} > 0`),
    check(
      "coupons_max_uses_per_customer_check",
      sql`${table.maxUsesPerCustomer} is null or ${table.maxUsesPerCustomer} > 0`,
    ),
    check("coupons_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

/** Records one coupon use by a customer for one future order identifier. */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    customerUserId: uuid("customer_user_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "coupon_redemptions_customer_fk",
      columns: [table.customerUserId],
      foreignColumns: [customerProfiles.userId],
    }).onDelete("restrict"),
    uniqueIndex("coupon_redemptions_coupon_order_uq").on(
      table.couponId,
      table.orderId,
    ),
    index("coupon_redemptions_coupon_customer_idx").on(
      table.couponId,
      table.customerUserId,
      table.redeemedAt,
    ),
    index("coupon_redemptions_order_idx").on(table.orderId),
  ],
);

export type PromotionRow = typeof promotions.$inferSelect;
export type NewPromotionRow = typeof promotions.$inferInsert;
export type PromotionScopeRow = typeof promotionScopes.$inferSelect;
export type NewPromotionScopeRow = typeof promotionScopes.$inferInsert;
export type CouponRow = typeof coupons.$inferSelect;
export type NewCouponRow = typeof coupons.$inferInsert;
export type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemptionRow = typeof couponRedemptions.$inferInsert;

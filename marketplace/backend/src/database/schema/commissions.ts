import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { orderItems, sellerOrders } from "./orders.js";
import { sellers } from "./sellers.js";

/** Stores effective-dated marketplace Commission rules while keeping rule selection in the service layer. */
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    priority: integer("priority").notNull(),
    scopeType: varchar("scope_type", { length: 30 }).notNull(),
    scopeId: uuid("scope_id"),
    ratePercent: numeric("rate_percent", { precision: 9, scale: 6 }).notNull(),
    fixedFee: numeric("fixed_fee", { precision: 18, scale: 4 }),
    fundingRulesJson: jsonb("funding_rules_json"),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 30 })
      .$type<"active" | "inactive">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("commission_rules_resolution_idx").on(
      table.scopeType,
      table.scopeId,
      table.status,
      table.startAt,
      table.endAt,
      table.priority,
    ),
    index("commission_rules_status_start_idx").on(table.status, table.startAt),
    check(
      "commission_rules_scope_type_check",
      sql`${table.scopeType} in ('default', 'seller', 'category', 'product')`,
    ),
    check(
      "commission_rules_scope_shape_check",
      sql`
        (${table.scopeType} = 'default' and ${table.scopeId} is null)
        or (${table.scopeType} <> 'default' and ${table.scopeId} is not null)
      `,
    ),
    check(
      "commission_rules_rate_percent_check",
      sql`${table.ratePercent} >= 0 and ${table.ratePercent} <= 100`,
    ),
    check(
      "commission_rules_fixed_fee_nonnegative_check",
      sql`${table.fixedFee} is null or ${table.fixedFee} >= 0`,
    ),
    check(
      "commission_rules_date_range_check",
      sql`${table.endAt} is null or ${table.endAt} > ${table.startAt}`,
    ),
    check(
      "commission_rules_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "commission_rules_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
);

/** Stores the immutable Commission rule facts applied to one Order Item. */
export const commissionRuleSnapshots = pgTable(
  "commission_rule_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    ruleId: uuid("rule_id").references(() => commissionRules.id, {
      onDelete: "restrict",
    }),
    ratePercent: numeric("rate_percent", { precision: 9, scale: 6 }).notNull(),
    fixedFee: numeric("fixed_fee", { precision: 18, scale: 4 }),
    basisJson: jsonb("basis_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commission_rule_snapshots_order_item_uq").on(table.orderItemId),
    index("commission_rule_snapshots_rule_idx").on(table.ruleId),
    check(
      "commission_rule_snapshots_rate_percent_check",
      sql`${table.ratePercent} >= 0 and ${table.ratePercent} <= 100`,
    ),
    check(
      "commission_rule_snapshots_fixed_fee_nonnegative_check",
      sql`${table.fixedFee} is null or ${table.fixedFee} >= 0`,
    ),
  ],
);

/** Stores append-only sale, refund, and correction entries for marketplace revenue and seller net. */
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    sellerOrderId: uuid("seller_order_id")
      .notNull()
      .references(() => sellerOrders.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 30 }).notNull(),
    grossAmount: numeric("gross_amount", { precision: 18, scale: 4 }).notNull(),
    commissionAmount: numeric("commission_amount", { precision: 18, scale: 4 }).notNull(),
    sellerNetAmount: numeric("seller_net_amount", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    sourceKey: varchar("source_key", { length: 255 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("commission_entries_source_key_uq").on(table.sourceKey),
    index("commission_entries_seller_occurred_idx").on(table.sellerId, table.occurredAt),
    index("commission_entries_seller_order_occurred_idx").on(
      table.sellerOrderId,
      table.occurredAt,
    ),
    index("commission_entries_order_item_occurred_idx").on(table.orderItemId, table.occurredAt),
    index("commission_entries_type_occurred_idx").on(table.type, table.occurredAt),
    check(
      "commission_entries_type_check",
      sql`${table.type} in ('sale', 'refund', 'adjustment')`,
    ),
    check(
      "commission_entries_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "commission_entries_source_key_not_blank_check",
      sql`length(btrim(${table.sourceKey})) > 0`,
    ),
  ],
);

export type CommissionRuleRow = typeof commissionRules.$inferSelect;
export type NewCommissionRuleRow = typeof commissionRules.$inferInsert;
export type CommissionRuleSnapshotRow = typeof commissionRuleSnapshots.$inferSelect;
export type NewCommissionRuleSnapshotRow = typeof commissionRuleSnapshots.$inferInsert;
export type CommissionEntryRow = typeof commissionEntries.$inferSelect;
export type NewCommissionEntryRow = typeof commissionEntries.$inferInsert;

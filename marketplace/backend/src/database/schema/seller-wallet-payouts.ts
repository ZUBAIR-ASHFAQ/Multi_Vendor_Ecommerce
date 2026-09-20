import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sellers } from "./sellers.js";

/** Stores one current Wallet balance snapshot per seller and currency. */
export const sellerWallets = pgTable(
  "seller_wallets",
  {
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    pendingBalance: numeric("pending_balance", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    availableBalance: numeric("available_balance", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    heldBalance: numeric("held_balance", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    negativeBalance: numeric("negative_balance", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.sellerId, table.currency],
      name: "seller_wallets_pk",
    }),
    index("seller_wallets_updated_idx").on(table.updatedAt),
    check(
      "seller_wallets_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "seller_wallets_pending_nonnegative_check",
      sql`${table.pendingBalance} >= 0`,
    ),
    check(
      "seller_wallets_available_nonnegative_check",
      sql`${table.availableBalance} >= 0`,
    ),
    check(
      "seller_wallets_held_nonnegative_check",
      sql`${table.heldBalance} >= 0`,
    ),
  ],
);

/** Stores immutable source-attributed deltas for one seller/currency Wallet balance bucket. */
export const sellerWalletEntries = pgTable(
  "seller_wallet_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    balanceBucket: varchar("balance_bucket", { length: 30 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceKey: varchar("source_key", { length: 255 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sellerId, table.currency],
      foreignColumns: [sellerWallets.sellerId, sellerWallets.currency],
      name: "seller_wallet_entries_wallet_fk",
    }).onDelete("restrict"),
    uniqueIndex("seller_wallet_entries_source_key_uq").on(table.sourceKey),
    index("seller_wallet_entries_wallet_occurred_idx").on(
      table.sellerId,
      table.currency,
      table.occurredAt,
      table.id,
    ),
    index("seller_wallet_entries_source_idx").on(table.sourceType, table.sourceId),
    index("seller_wallet_entries_bucket_occurred_idx").on(
      table.sellerId,
      table.currency,
      table.balanceBucket,
      table.occurredAt,
    ),
    check(
      "seller_wallet_entries_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "seller_wallet_entries_type_normalized_check",
      sql`${table.type} = lower(btrim(${table.type})) and length(${table.type}) > 0`,
    ),
    check(
      "seller_wallet_entries_bucket_normalized_check",
      sql`${table.balanceBucket} = lower(btrim(${table.balanceBucket})) and length(${table.balanceBucket}) > 0`,
    ),
    check(
      "seller_wallet_entries_source_type_normalized_check",
      sql`${table.sourceType} = lower(btrim(${table.sourceType})) and length(${table.sourceType}) > 0`,
    ),
    check("seller_wallet_entries_amount_nonzero_check", sql`${table.amount} <> 0`),
    check(
      "seller_wallet_entries_source_key_not_blank_check",
      sql`length(btrim(${table.sourceKey})) > 0`,
    ),
  ],
);

/** Stores a seller-owned tokenized payout destination without raw bank or card credentials. */
export const payoutAccounts = pgTable(
  "payout_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    providerType: varchar("provider_type", { length: 40 }).notNull(),
    maskedDetails: varchar("masked_details", { length: 255 }).notNull(),
    providerAccountRef: varchar("provider_account_ref", { length: 255 }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("payout_accounts_id_seller_uq").on(table.id, table.sellerId),
    index("payout_accounts_seller_status_idx").on(table.sellerId, table.status),
    index("payout_accounts_provider_type_idx").on(table.providerType),
    check(
      "payout_accounts_provider_type_normalized_check",
      sql`${table.providerType} = lower(btrim(${table.providerType})) and length(${table.providerType}) > 0`,
    ),
    check(
      "payout_accounts_masked_details_not_blank_check",
      sql`length(btrim(${table.maskedDetails})) > 0`,
    ),
    check(
      "payout_accounts_provider_ref_not_blank_check",
      sql`length(btrim(${table.providerAccountRef})) > 0`,
    ),
    check(
      "payout_accounts_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
  ],
);

/** Stores one seller payout request and its provider execution result. */
export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payoutNo: varchar("payout_no", { length: 40 }).notNull(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    accountId: uuid("account_id").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    providerRef: varchar("provider_ref", { length: 255 }),
  },
  (table) => [
    foreignKey({
      columns: [table.sellerId, table.currency],
      foreignColumns: [sellerWallets.sellerId, sellerWallets.currency],
      name: "payouts_wallet_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.accountId, table.sellerId],
      foreignColumns: [payoutAccounts.id, payoutAccounts.sellerId],
      name: "payouts_account_seller_fk",
    }).onDelete("restrict"),
    uniqueIndex("payouts_payout_no_uq").on(table.payoutNo),
    index("payouts_seller_status_requested_idx").on(
      table.sellerId,
      table.status,
      table.requestedAt,
    ),
    index("payouts_account_requested_idx").on(table.accountId, table.requestedAt),
    index("payouts_status_requested_idx").on(table.status, table.requestedAt),
    check("payouts_payout_no_not_blank_check", sql`length(btrim(${table.payoutNo})) > 0`),
    check("payouts_amount_positive_check", sql`${table.amount} > 0`),
    check(
      "payouts_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "payouts_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "payouts_processed_at_check",
      sql`${table.processedAt} is null or ${table.processedAt} >= ${table.requestedAt}`,
    ),
    check(
      "payouts_provider_ref_not_blank_check",
      sql`${table.providerRef} is null or length(btrim(${table.providerRef})) > 0`,
    ),
  ],
);

/** Allocates an approved Payout amount back to immutable Wallet earning entries. */
export const payoutAllocations = pgTable(
  "payout_allocations",
  {
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => payouts.id, { onDelete: "restrict" }),
    walletEntryId: uuid("wallet_entry_id")
      .notNull()
      .references(() => sellerWalletEntries.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.payoutId, table.walletEntryId],
      name: "payout_allocations_pk",
    }),
    index("payout_allocations_wallet_entry_idx").on(table.walletEntryId),
    check("payout_allocations_amount_positive_check", sql`${table.amount} > 0`),
  ],
);

export type SellerWalletRow = typeof sellerWallets.$inferSelect;
export type SellerWalletEntryRow = typeof sellerWalletEntries.$inferSelect;
export type NewSellerWalletEntryRow = typeof sellerWalletEntries.$inferInsert;
export type PayoutAccountRow = typeof payoutAccounts.$inferSelect;
export type NewPayoutAccountRow = typeof payoutAccounts.$inferInsert;
export type PayoutRow = typeof payouts.$inferSelect;
export type NewPayoutRow = typeof payouts.$inferInsert;
export type PayoutAllocationRow = typeof payoutAllocations.$inferSelect;
export type NewPayoutAllocationRow = typeof payoutAllocations.$inferInsert;

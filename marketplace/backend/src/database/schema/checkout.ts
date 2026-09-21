import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { customerAddresses, customerProfiles } from "./customers.js";
import { productVariants } from "./products.js";
import { sellers, stores } from "./sellers.js";
import { shippingMethods } from "./shipping.js";
import { orders } from "./orders.js";

/** Stores one short-lived, server-authoritative checkout quote for a customer. */
export const checkoutQuotes = pgTable(
  "checkout_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    // These columns remain physically nullable for safe upgrade of pre-Patch-0004 rows.
    // The NOT VALID database check rejects nulls for every new row after migration 0022.
    shippingAddressId: uuid("shipping_address_id"),
    billingAddressId: uuid("billing_address_id"),
    couponCode: varchar("coupon_code", { length: 120 }),
    source: varchar("source", { length: 20 }).notNull().default("cart"),
    currency: varchar("currency", { length: 3 }).notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 4 }).notNull(),
    discountTotal: numeric("discount_total", { precision: 18, scale: 4 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 18, scale: 4 }).notNull(),
    shippingTotal: numeric("shipping_total", { precision: 18, scale: 4 }).notNull(),
    grandTotal: numeric("grand_total", { precision: 18, scale: 4 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    stateHash: varchar("state_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("checkout_quotes_id_customer_uq").on(table.id, table.customerUserId),
    index("checkout_quotes_customer_expiry_idx").on(table.customerUserId, table.expiresAt),
    foreignKey({
      columns: [table.shippingAddressId, table.customerUserId],
      foreignColumns: [customerAddresses.id, customerAddresses.customerUserId],
      name: "checkout_quotes_shipping_address_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.billingAddressId, table.customerUserId],
      foreignColumns: [customerAddresses.id, customerAddresses.customerUserId],
      name: "checkout_quotes_billing_address_customer_fk",
    }).onDelete("restrict"),
    check(
      "checkout_quotes_addresses_present_check",
      sql`${table.shippingAddressId} is not null and ${table.billingAddressId} is not null`,
    ),
    check(
      "checkout_quotes_coupon_code_normalized_check",
      sql`${table.couponCode} is null or (${table.couponCode} = upper(btrim(${table.couponCode})) and length(${table.couponCode}) > 0)`,
    ),
    check(
      "checkout_quotes_source_check",
      sql`${table.source} in ('cart', 'buy_now')`,
    ),
    check(
      "checkout_quotes_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check("checkout_quotes_subtotal_nonnegative_check", sql`${table.subtotal} >= 0`),
    check(
      "checkout_quotes_discount_total_nonnegative_check",
      sql`${table.discountTotal} >= 0`,
    ),
    check(
      "checkout_quotes_discount_not_over_subtotal_check",
      sql`${table.discountTotal} <= ${table.subtotal}`,
    ),
    check("checkout_quotes_tax_total_nonnegative_check", sql`${table.taxTotal} >= 0`),
    check(
      "checkout_quotes_shipping_total_nonnegative_check",
      sql`${table.shippingTotal} >= 0`,
    ),
    check("checkout_quotes_grand_total_nonnegative_check", sql`${table.grandTotal} >= 0`),
    check(
      "checkout_quotes_grand_total_formula_check",
      sql`${table.grandTotal} = ${table.subtotal} - ${table.discountTotal} + ${table.taxTotal} + ${table.shippingTotal}`,
    ),
    check(
      "checkout_quotes_state_hash_sha256_check",
      sql`${table.stateHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "checkout_quotes_expiry_after_creation_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

/** Stores one immutable priced Product-variant line inside an authoritative checkout quote. */
export const checkoutQuoteLines = pgTable(
  "checkout_quote_lines",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => checkoutQuotes.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    // Physically nullable only so migration 0022 can preserve pre-contract quote lines.
    // The database check requires a store for every new line.
    storeId: uuid("store_id"),
    qty: integer("qty").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    discount: numeric("discount", { precision: 18, scale: 4 }).notNull(),
    tax: numeric("tax", { precision: 18, scale: 4 }).notNull(),
    lineTotal: numeric("line_total", { precision: 18, scale: 4 }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.quoteId, table.variantId],
      name: "checkout_quote_lines_pk",
    }),
    foreignKey({
      columns: [table.storeId, table.sellerId],
      foreignColumns: [stores.id, stores.sellerId],
      name: "checkout_quote_lines_store_seller_fk",
    }).onDelete("restrict"),
    index("checkout_quote_lines_seller_idx").on(table.sellerId, table.quoteId),
    index("checkout_quote_lines_store_idx").on(table.storeId, table.quoteId),
    index("checkout_quote_lines_variant_idx").on(table.variantId),
    check("checkout_quote_lines_store_present_check", sql`${table.storeId} is not null`),
    check("checkout_quote_lines_qty_positive_check", sql`${table.qty} > 0`),
    check("checkout_quote_lines_unit_price_nonnegative_check", sql`${table.unitPrice} >= 0`),
    check("checkout_quote_lines_discount_nonnegative_check", sql`${table.discount} >= 0`),
    check("checkout_quote_lines_tax_nonnegative_check", sql`${table.tax} >= 0`),
    check("checkout_quote_lines_line_total_nonnegative_check", sql`${table.lineTotal} >= 0`),
    check(
      "checkout_quote_lines_discount_not_over_subtotal_check",
      sql`${table.discount} <= (${table.unitPrice} * ${table.qty})`,
    ),
    check(
      "checkout_quote_lines_total_formula_check",
      sql`${table.lineTotal} = (${table.unitPrice} * ${table.qty}) - ${table.discount} + ${table.tax}`,
    ),
  ],
);

/** Stores one selected Shipping Core option per store group for a stable short-lived quote. */
export const checkoutQuoteShippingSelections = pgTable(
  "checkout_quote_shipping_selections",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => checkoutQuotes.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull(),
    shippingMethodId: uuid("shipping_method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "restrict" }),
    shippingMethodCodeSnapshot: varchar("shipping_method_code_snapshot", {
      length: 120,
    }).notNull(),
    shippingMethodNameSnapshot: varchar("shipping_method_name_snapshot", {
      length: 200,
    }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.quoteId, table.storeId],
      name: "checkout_quote_shipping_selections_pk",
    }),
    foreignKey({
      columns: [table.storeId, table.sellerId],
      foreignColumns: [stores.id, stores.sellerId],
      name: "checkout_quote_shipping_selections_store_seller_fk",
    }).onDelete("restrict"),
    index("checkout_quote_shipping_selections_seller_idx").on(
      table.sellerId,
      table.quoteId,
    ),
    index("checkout_quote_shipping_selections_method_idx").on(
      table.shippingMethodId,
    ),
    check(
      "checkout_quote_shipping_selections_code_not_blank_check",
      sql`length(btrim(${table.shippingMethodCodeSnapshot})) > 0`,
    ),
    check(
      "checkout_quote_shipping_selections_name_not_blank_check",
      sql`length(btrim(${table.shippingMethodNameSnapshot})) > 0`,
    ),
    check(
      "checkout_quote_shipping_selections_amount_nonnegative_check",
      sql`${table.amount} >= 0`,
    ),
    check(
      "checkout_quote_shipping_selections_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

/** Stores one idempotent checkout confirmation attempt before Orders/Payments are generated. */
export const checkoutAttempts = pgTable(
  "checkout_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteId: uuid("quote_id").notNull(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    // Module 11 owns Orders. This remains nullable until Checkout materializes the Order.
    orderId: uuid("order_id").references(
      (): AnyPgColumn => orders.id,
      { onDelete: "restrict" },
    ),
    status: varchar("status", { length: 40 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.quoteId, table.customerUserId],
      foreignColumns: [checkoutQuotes.id, checkoutQuotes.customerUserId],
      name: "checkout_attempts_quote_customer_fk",
    }).onDelete("restrict"),
    uniqueIndex("checkout_attempts_quote_uq").on(table.quoteId),
    uniqueIndex("checkout_attempts_customer_idempotency_uq").on(
      table.customerUserId,
      table.idempotencyKey,
    ),
    index("checkout_attempts_customer_status_idx").on(table.customerUserId, table.status),
    index("checkout_attempts_order_idx")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    // Supports the bounded Payments maintenance scan for linked attempts whose immutable deadline passed.
    index("checkout_attempts_expiry_order_idx")
      .on(table.expiresAt, table.id, table.orderId)
      .where(sql`${table.orderId} is not null`),
    check(
      "checkout_attempts_status_not_blank_check",
      sql`length(btrim(${table.status})) > 0`,
    ),
    check(
      "checkout_attempts_idempotency_key_normalized_check",
      sql`${table.idempotencyKey} = btrim(${table.idempotencyKey}) and length(${table.idempotencyKey}) > 0`,
    ),
    check(
      "checkout_attempts_expiry_after_creation_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type CheckoutQuoteRow = typeof checkoutQuotes.$inferSelect;
export type NewCheckoutQuoteRow = typeof checkoutQuotes.$inferInsert;
export type CheckoutQuoteLineRow = typeof checkoutQuoteLines.$inferSelect;
export type NewCheckoutQuoteLineRow = typeof checkoutQuoteLines.$inferInsert;
export type CheckoutQuoteShippingSelectionRow =
  typeof checkoutQuoteShippingSelections.$inferSelect;
export type NewCheckoutQuoteShippingSelectionRow =
  typeof checkoutQuoteShippingSelections.$inferInsert;
export type CheckoutAttemptRow = typeof checkoutAttempts.$inferSelect;
export type NewCheckoutAttemptRow = typeof checkoutAttempts.$inferInsert;

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
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
import { users } from "./administration.js";
import { checkoutAttempts } from "./checkout.js";
import { customerAddresses, customerProfiles } from "./customers.js";
import { stockReservations } from "./inventory.js";
import { productVariants, products } from "./products.js";
import { sellers, stores } from "./sellers.js";
import { shippingMethods } from "./shipping.js";

/** Stores the immutable customer-facing commercial Order created from one Checkout attempt. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNo: varchar("order_no", { length: 40 }).notNull(),
    checkoutAttemptId: uuid("checkout_attempt_id")
      .notNull()
      .references(
        (): AnyPgColumn => checkoutAttempts.id,
        { onDelete: "restrict" },
      ),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 4 }).notNull(),
    discountTotal: numeric("discount_total", { precision: 18, scale: 4 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 18, scale: 4 }).notNull(),
    shippingTotal: numeric("shipping_total", { precision: 18, scale: 4 }).notNull(),
    grandTotal: numeric("grand_total", { precision: 18, scale: 4 }).notNull(),
    paymentStatus: varchar("payment_status", { length: 40 }).notNull().default("pending"),
    fulfillmentStatus: varchar("fulfillment_status", { length: 40 })
      .notNull()
      .default("unfulfilled"),
    orderStatus: varchar("order_status", { length: 40 })
      .notNull()
      .default("pending_payment"),
    placedAt: timestamp("placed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_order_no_uq").on(table.orderNo),
    uniqueIndex("orders_checkout_attempt_uq").on(table.checkoutAttemptId),
    index("orders_customer_created_idx").on(table.customerUserId, table.createdAt),
    index("orders_customer_status_created_idx").on(
      table.customerUserId,
      table.orderStatus,
      table.createdAt,
    ),
    index("orders_payment_status_idx").on(table.paymentStatus, table.createdAt),
    check(
      "orders_order_no_matches_id_check",
      sql`${table.orderNo} = 'ORD-' || upper(replace(${table.id}::text, '-', ''))`,
    ),
    check(
      "orders_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check("orders_subtotal_nonnegative_check", sql`${table.subtotal} >= 0`),
    check(
      "orders_discount_total_nonnegative_check",
      sql`${table.discountTotal} >= 0`,
    ),
    check(
      "orders_discount_not_over_subtotal_check",
      sql`${table.discountTotal} <= ${table.subtotal}`,
    ),
    check("orders_tax_total_nonnegative_check", sql`${table.taxTotal} >= 0`),
    check(
      "orders_shipping_total_nonnegative_check",
      sql`${table.shippingTotal} >= 0`,
    ),
    check("orders_grand_total_nonnegative_check", sql`${table.grandTotal} >= 0`),
    check(
      "orders_grand_total_formula_check",
      sql`${table.grandTotal} = ${table.subtotal} - ${table.discountTotal} + ${table.taxTotal} + ${table.shippingTotal}`,
    ),
    check(
      "orders_payment_status_normalized_check",
      sql`${table.paymentStatus} = lower(btrim(${table.paymentStatus})) and length(${table.paymentStatus}) > 0`,
    ),
    check(
      "orders_fulfillment_status_normalized_check",
      sql`${table.fulfillmentStatus} = lower(btrim(${table.fulfillmentStatus})) and length(${table.fulfillmentStatus}) > 0`,
    ),
    check(
      "orders_fulfillment_status_check",
      sql`${table.fulfillmentStatus} in ('unfulfilled', 'partially_fulfilled', 'fulfilled')`,
    ),
    check(
      "orders_order_status_normalized_check",
      sql`${table.orderStatus} = lower(btrim(${table.orderStatus})) and length(${table.orderStatus}) > 0`,
    ),
  ],
);

/** Stores one seller/store fulfillment and settlement unit inside a parent Customer Order. */
export const sellerOrders = pgTable(
  "seller_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull(),
    sellerOrderNo: varchar("seller_order_no", { length: 40 }).notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 4 }).notNull(),
    discountTotal: numeric("discount_total", { precision: 18, scale: 4 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 18, scale: 4 }).notNull(),
    shippingTotal: numeric("shipping_total", { precision: 18, scale: 4 }).notNull(),
    grandTotal: numeric("grand_total", { precision: 18, scale: 4 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending_payment"),
    shippingMethodId: uuid("shipping_method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "restrict" }),
    shippingMethodCodeSnapshot: varchar("shipping_method_code_snapshot", {
      length: 120,
    }).notNull(),
    shippingMethodNameSnapshot: varchar("shipping_method_name_snapshot", {
      length: 200,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.storeId, table.sellerId],
      foreignColumns: [stores.id, stores.sellerId],
      name: "seller_orders_store_seller_fk",
    }).onDelete("restrict"),
    uniqueIndex("seller_orders_seller_order_no_uq").on(table.sellerOrderNo),
    uniqueIndex("seller_orders_order_seller_store_uq").on(
      table.orderId,
      table.sellerId,
      table.storeId,
    ),
    uniqueIndex("seller_orders_id_order_uq").on(table.id, table.orderId),
    index("seller_orders_seller_status_created_idx").on(
      table.sellerId,
      table.status,
      table.createdAt,
    ),
    index("seller_orders_store_status_created_idx").on(
      table.storeId,
      table.status,
      table.createdAt,
    ),
    index("seller_orders_order_idx").on(table.orderId),
    check(
      "seller_orders_number_matches_id_check",
      sql`${table.sellerOrderNo} = 'SOR-' || upper(replace(${table.id}::text, '-', ''))`,
    ),
    check("seller_orders_subtotal_nonnegative_check", sql`${table.subtotal} >= 0`),
    check(
      "seller_orders_discount_total_nonnegative_check",
      sql`${table.discountTotal} >= 0`,
    ),
    check(
      "seller_orders_discount_not_over_subtotal_check",
      sql`${table.discountTotal} <= ${table.subtotal}`,
    ),
    check("seller_orders_tax_total_nonnegative_check", sql`${table.taxTotal} >= 0`),
    check(
      "seller_orders_shipping_total_nonnegative_check",
      sql`${table.shippingTotal} >= 0`,
    ),
    check("seller_orders_grand_total_nonnegative_check", sql`${table.grandTotal} >= 0`),
    check(
      "seller_orders_grand_total_formula_check",
      sql`${table.grandTotal} = ${table.subtotal} - ${table.discountTotal} + ${table.taxTotal} + ${table.shippingTotal}`,
    ),
    check(
      "seller_orders_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "seller_orders_shipping_code_not_blank_check",
      sql`length(btrim(${table.shippingMethodCodeSnapshot})) > 0`,
    ),
    check(
      "seller_orders_shipping_name_not_blank_check",
      sql`length(btrim(${table.shippingMethodNameSnapshot})) > 0`,
    ),
  ],
);

/** Stores one immutable Product/price snapshot line assigned to exactly one Seller Order. */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sellerOrderId: uuid("seller_order_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull(),
    inventoryReservationId: uuid("inventory_reservation_id")
      .notNull()
      .references(() => stockReservations.id, { onDelete: "restrict" }),
    skuSnapshot: varchar("sku_snapshot", { length: 120 }).notNull(),
    nameSnapshot: varchar("name_snapshot", { length: 240 }).notNull(),
    variantTitleSnapshot: varchar("variant_title_snapshot", { length: 200 }),
    qty: integer("qty").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    discountAllocated: numeric("discount_allocated", { precision: 18, scale: 4 })
      .notNull(),
    taxAllocated: numeric("tax_allocated", { precision: 18, scale: 4 }).notNull(),
    lineTotal: numeric("line_total", { precision: 18, scale: 4 }).notNull(),
    commissionRuleSnapshotJson: jsonb("commission_rule_snapshot_json"),
    status: varchar("status", { length: 40 }).notNull().default("active"),
    cancelledQty: integer("cancelled_qty").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sellerOrderId, table.orderId],
      foreignColumns: [sellerOrders.id, sellerOrders.orderId],
      name: "order_items_seller_order_parent_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
      name: "order_items_variant_product_fk",
    }).onDelete("restrict"),
    uniqueIndex("order_items_inventory_reservation_uq").on(table.inventoryReservationId),
    index("order_items_order_idx").on(table.orderId),
    index("order_items_seller_order_idx").on(table.sellerOrderId),
    index("order_items_product_variant_idx").on(table.productId, table.variantId),
    index("order_items_status_idx").on(table.status),
    check("order_items_qty_positive_check", sql`${table.qty} > 0`),
    check("order_items_cancelled_qty_nonnegative_check", sql`${table.cancelledQty} >= 0`),
    check(
      "order_items_cancelled_qty_not_over_qty_check",
      sql`${table.cancelledQty} <= ${table.qty}`,
    ),
    check("order_items_unit_price_nonnegative_check", sql`${table.unitPrice} >= 0`),
    check(
      "order_items_discount_allocated_nonnegative_check",
      sql`${table.discountAllocated} >= 0`,
    ),
    check(
      "order_items_discount_not_over_subtotal_check",
      sql`${table.discountAllocated} <= (${table.unitPrice} * ${table.qty})`,
    ),
    check(
      "order_items_tax_allocated_nonnegative_check",
      sql`${table.taxAllocated} >= 0`,
    ),
    check("order_items_line_total_nonnegative_check", sql`${table.lineTotal} >= 0`),
    check(
      "order_items_line_total_formula_check",
      sql`${table.lineTotal} = (${table.unitPrice} * ${table.qty}) - ${table.discountAllocated} + ${table.taxAllocated}`,
    ),
    check(
      "order_items_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "order_items_sku_snapshot_not_blank_check",
      sql`length(btrim(${table.skuSnapshot})) > 0`,
    ),
    check(
      "order_items_name_snapshot_not_blank_check",
      sql`length(btrim(${table.nameSnapshot})) > 0`,
    ),
    check(
      "order_items_variant_title_snapshot_not_blank_check",
      sql`${table.variantTitleSnapshot} is null or length(btrim(${table.variantTitleSnapshot})) > 0`,
    ),
  ],
);

/** Stores immutable shipping/billing address text copied from the final authoritative Checkout state. */
export const orderAddresses = pgTable(
  "order_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 20 }).notNull(),
    sourceAddressId: uuid("source_address_id").references(() => customerAddresses.id, {
      onDelete: "restrict",
    }),
    recipientName: varchar("recipient_name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    line1: varchar("line1", { length: 255 }).notNull(),
    line2: varchar("line2", { length: 255 }),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }).notNull(),
    postalCode: varchar("postal_code", { length: 32 }),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_addresses_order_type_uq").on(table.orderId, table.type),
    index("order_addresses_source_address_idx").on(table.sourceAddressId),
    check("order_addresses_type_check", sql`${table.type} in ('shipping', 'billing')`),
    check(
      "order_addresses_recipient_name_not_blank_check",
      sql`length(btrim(${table.recipientName})) > 0`,
    ),
    check("order_addresses_phone_not_blank_check", sql`length(btrim(${table.phone})) > 0`),
    check("order_addresses_line1_not_blank_check", sql`length(btrim(${table.line1})) > 0`),
    check("order_addresses_city_not_blank_check", sql`length(btrim(${table.city})) > 0`),
    check("order_addresses_region_not_blank_check", sql`length(btrim(${table.region})) > 0`),
    check(
      "order_addresses_line2_not_blank_check",
      sql`${table.line2} is null or length(btrim(${table.line2})) > 0`,
    ),
    check(
      "order_addresses_postal_code_not_blank_check",
      sql`${table.postalCode} is null or length(btrim(${table.postalCode})) > 0`,
    ),
    check(
      "order_addresses_country_code_check",
      sql`${table.countryCode} = upper(btrim(${table.countryCode})) and ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/** Stores append-only parent-Order or Seller-Order lifecycle history and optional replay-safe source identity. */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    sellerOrderId: uuid("seller_order_id").references(() => sellerOrders.id, {
      onDelete: "restrict",
    }),
    fromStatus: varchar("from_status", { length: 40 }),
    toStatus: varchar("to_status", { length: 40 }).notNull(),
    reason: varchar("reason", { length: 500 }),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    sourceType: varchar("source_type", { length: 80 }),
    sourceKey: varchar("source_key", { length: 200 }),
    metadataJson: jsonb("metadata_json"),
  },
  (table) => [
    index("order_status_history_order_changed_idx").on(table.orderId, table.changedAt),
    index("order_status_history_seller_order_changed_idx").on(
      table.sellerOrderId,
      table.changedAt,
    ),
    uniqueIndex("order_status_history_source_uq")
      .on(table.sourceType, table.sourceKey)
      .where(sql`${table.sourceType} is not null and ${table.sourceKey} is not null`),
    check(
      "order_status_history_one_target_check",
      sql`num_nonnulls(${table.orderId}, ${table.sellerOrderId}) = 1`,
    ),
    check(
      "order_status_history_from_status_normalized_check",
      sql`${table.fromStatus} is null or (${table.fromStatus} = lower(btrim(${table.fromStatus})) and length(${table.fromStatus}) > 0)`,
    ),
    check(
      "order_status_history_to_status_normalized_check",
      sql`${table.toStatus} = lower(btrim(${table.toStatus})) and length(${table.toStatus}) > 0`,
    ),
    check(
      "order_status_history_reason_not_blank_check",
      sql`${table.reason} is null or length(btrim(${table.reason})) > 0`,
    ),
    check(
      "order_status_history_source_pair_check",
      sql`(
        ${table.sourceType} is null and ${table.sourceKey} is null
      ) or (
        ${table.sourceType} is not null and ${table.sourceKey} is not null
      )`,
    ),
    check(
      "order_status_history_source_type_normalized_check",
      sql`${table.sourceType} is null or (${table.sourceType} = lower(btrim(${table.sourceType})) and length(${table.sourceType}) > 0)`,
    ),
    check(
      "order_status_history_source_key_normalized_check",
      sql`${table.sourceKey} is null or (${table.sourceKey} = btrim(${table.sourceKey}) and length(${table.sourceKey}) > 0)`,
    ),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type SellerOrderRow = typeof sellerOrders.$inferSelect;
export type NewSellerOrderRow = typeof sellerOrders.$inferInsert;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type NewOrderItemRow = typeof orderItems.$inferInsert;
export type OrderAddressRow = typeof orderAddresses.$inferSelect;
export type NewOrderAddressRow = typeof orderAddresses.$inferInsert;
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect;
export type NewOrderStatusHistoryRow = typeof orderStatusHistory.$inferInsert;

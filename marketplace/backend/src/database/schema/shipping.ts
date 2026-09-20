import { sql } from "drizzle-orm";
import {
  check,
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
import { orderItems, sellerOrders } from "./orders.js";
import { sellers } from "./sellers.js";

/** Stores one platform- or seller-owned flat-rate shipping method used by Checkout. */
export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerType: varchar("owner_type", { length: 20 }).notNull(),
    sellerId: uuid("seller_id").references(() => sellers.id, {
      onDelete: "restrict",
    }),
    code: varchar("code", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    pricingType: varchar("pricing_type", { length: 40 }).notNull(),
    baseRate: numeric("base_rate", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
  },
  (table) => [
    index("shipping_methods_owner_status_idx").on(
      table.ownerType,
      table.status,
    ),
    index("shipping_methods_seller_status_idx").on(
      table.sellerId,
      table.status,
    ),
    index("shipping_methods_currency_status_idx").on(
      table.currency,
      table.status,
    ),
    check(
      "shipping_methods_owner_type_check",
      sql`${table.ownerType} in ('platform', 'seller')`,
    ),
    check(
      "shipping_methods_owner_seller_check",
      sql`(
        (${table.ownerType} = 'platform' and ${table.sellerId} is null)
        or (${table.ownerType} = 'seller' and ${table.sellerId} is not null)
      )`,
    ),
    check(
      "shipping_methods_code_not_blank_check",
      sql`length(btrim(${table.code})) > 0`,
    ),
    check(
      "shipping_methods_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "shipping_methods_pricing_type_check",
      sql`${table.pricingType} = 'flat'`,
    ),
    check(
      "shipping_methods_base_rate_nonnegative_check",
      sql`${table.baseRate} >= 0`,
    ),
    check(
      "shipping_methods_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "shipping_methods_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
);

/** Stores one immutable seller-order Shipment header and its fulfillment lifecycle timestamps. */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerOrderId: uuid("seller_order_id")
      .notNull()
      .references(() => sellerOrders.id, { onDelete: "restrict" }),
    shipmentNo: varchar("shipment_no", { length: 40 }).notNull(),
    carrier: varchar("carrier", { length: 120 }),
    serviceLevel: varchar("service_level", { length: 120 }),
    trackingNo: varchar("tracking_no", { length: 200 }),
    status: varchar("status", { length: 20 }).notNull().default("created"),
    shippedAt: timestamp("shipped_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("shipments_shipment_no_uq").on(table.shipmentNo),
    index("shipments_seller_order_status_created_idx").on(
      table.sellerOrderId,
      table.status,
      table.createdAt,
    ),
    index("shipments_status_created_idx").on(table.status, table.createdAt),
    check(
      "shipments_number_matches_id_check",
      sql`${table.shipmentNo} = 'SHP-' || upper(replace(${table.id}::text, '-', ''))`,
    ),
    check(
      "shipments_status_check",
      sql`${table.status} in ('created', 'shipped', 'delivered')`,
    ),
    check(
      "shipments_carrier_not_blank_check",
      sql`${table.carrier} is null or length(btrim(${table.carrier})) > 0`,
    ),
    check(
      "shipments_service_level_not_blank_check",
      sql`${table.serviceLevel} is null or length(btrim(${table.serviceLevel})) > 0`,
    ),
    check(
      "shipments_tracking_no_not_blank_check",
      sql`${table.trackingNo} is null or length(btrim(${table.trackingNo})) > 0`,
    ),
    check(
      "shipments_tracking_required_after_ship_check",
      sql`${table.status} = 'created' or (${table.carrier} is not null and ${table.trackingNo} is not null)`,
    ),
    check(
      "shipments_lifecycle_timestamps_check",
      sql`(
        (${table.status} = 'created' and ${table.shippedAt} is null and ${table.deliveredAt} is null)
        or (${table.status} = 'shipped' and ${table.shippedAt} is not null and ${table.deliveredAt} is null)
        or (
          ${table.status} = 'delivered'
          and ${table.shippedAt} is not null
          and ${table.deliveredAt} is not null
          and ${table.deliveredAt} >= ${table.shippedAt}
        )
      )`,
    ),
  ],
);

/** Stores one immutable allocation of an Order Item quantity to one Shipment. */
export const shipmentItems = pgTable(
  "shipment_items",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.shipmentId, table.orderItemId],
      name: "shipment_items_pk",
    }),
    index("shipment_items_order_item_idx").on(table.orderItemId),
    check("shipment_items_quantity_positive_check", sql`${table.quantity} > 0`),
  ],
);

/** Stores append-only Shipment lifecycle history separate from general audit evidence. */
export const shipmentStatusHistory = pgTable(
  "shipment_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    payloadRef: varchar("payload_ref", { length: 500 }),
  },
  (table) => [
    index("shipment_status_history_shipment_occurred_idx").on(
      table.shipmentId,
      table.occurredAt,
    ),
    index("shipment_status_history_status_occurred_idx").on(
      table.status,
      table.occurredAt,
    ),
    check(
      "shipment_status_history_status_check",
      sql`${table.status} in ('created', 'shipped', 'delivered')`,
    ),
    check(
      "shipment_status_history_source_not_blank_check",
      sql`length(btrim(${table.source})) > 0`,
    ),
    check(
      "shipment_status_history_payload_ref_not_blank_check",
      sql`${table.payloadRef} is null or length(btrim(${table.payloadRef})) > 0`,
    ),
  ],
);

export type ShippingMethodRow = typeof shippingMethods.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type NewShipmentRow = typeof shipments.$inferInsert;
export type ShipmentItemRow = typeof shipmentItems.$inferSelect;
export type NewShipmentItemRow = typeof shipmentItems.$inferInsert;
export type ShipmentStatusHistoryRow = typeof shipmentStatusHistory.$inferSelect;
export type NewShipmentStatusHistoryRow = typeof shipmentStatusHistory.$inferInsert;

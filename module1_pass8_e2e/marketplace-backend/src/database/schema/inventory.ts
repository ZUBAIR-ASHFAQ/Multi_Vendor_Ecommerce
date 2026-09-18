import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";
import { customerProfiles } from "./customers.js";
import { productVariants } from "./products.js";
import { sellers, stores } from "./sellers.js";

/** Current physical and reserved quantity for one seller/store Product variant. */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    onHandQty: integer("on_hand_qty").notNull().default(0),
    reservedQty: integer("reserved_qty").notNull().default(0),
    reorderLevel: integer("reorder_level"),
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
      name: "inventory_items_store_seller_fk",
    }).onDelete("restrict"),
    uniqueIndex("inventory_items_store_variant_uq").on(table.storeId, table.variantId),
    index("inventory_items_seller_store_idx").on(table.sellerId, table.storeId),
    index("inventory_items_variant_idx").on(table.variantId),
    index("inventory_items_reorder_idx")
      .on(table.sellerId, table.storeId, table.reorderLevel)
      .where(sql`${table.reorderLevel} is not null`),
    check("inventory_items_on_hand_nonnegative_check", sql`${table.onHandQty} >= 0`),
    check("inventory_items_reserved_nonnegative_check", sql`${table.reservedQty} >= 0`),
    check(
      "inventory_items_reserved_not_over_on_hand_check",
      sql`${table.reservedQty} <= ${table.onHandQty}`,
    ),
    check(
      "inventory_items_reorder_level_check",
      sql`${table.reorderLevel} is null or ${table.reorderLevel} >= 0`,
    ),
  ],
);

/** Immutable stock ledger row describing one attributable inventory quantity change. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    movementType: varchar("movement_type", { length: 30 }).notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: uuid("source_id"),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("stock_movements_idempotency_key_uq").on(table.idempotencyKey),
    index("stock_movements_item_occurred_idx").on(table.inventoryItemId, table.occurredAt),
    index("stock_movements_source_idx").on(table.sourceType, table.sourceId),
    index("stock_movements_actor_idx").on(table.actorUserId, table.occurredAt),
    check(
      "stock_movements_type_check",
      sql`${table.movementType} in ('adjustment', 'reserve', 'release', 'ship', 'restock')`,
    ),
    check("stock_movements_quantity_nonzero_check", sql`${table.quantityDelta} <> 0`),
    check(
      "stock_movements_source_type_not_blank_check",
      sql`length(btrim(${table.sourceType})) > 0`,
    ),
    check(
      "stock_movements_idempotency_key_normalized_check",
      sql`${table.idempotencyKey} = btrim(${table.idempotencyKey}) and length(${table.idempotencyKey}) > 0`,
    ),
  ],
);

/** Temporary or committed reservation for one customer Product variant request. */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    // Checkout now owns checkout_attempts, but legacy reservations may contain opaque
    // pre-Checkout UUIDs. Keep this column non-FK for backward-compatible upgrades.
    orderAttemptId: uuid("order_attempt_id"),
    qty: integer("qty").notNull(),
    consumedQty: integer("consumed_qty").notNull().default(0),
    releasedQty: integer("released_qty").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("reserved"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    sourceKey: varchar("source_key", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_reservations_source_key_uq").on(table.sourceKey),
    index("stock_reservations_variant_status_expiry_idx").on(
      table.variantId,
      table.status,
      table.expiresAt,
    ),
    index("stock_reservations_customer_status_idx").on(table.customerUserId, table.status),
    index("stock_reservations_order_attempt_idx").on(table.orderAttemptId),
    check("stock_reservations_qty_positive_check", sql`${table.qty} > 0`),
    check(
      "stock_reservations_consumed_qty_nonnegative_check",
      sql`${table.consumedQty} >= 0`,
    ),
    check(
      "stock_reservations_released_qty_nonnegative_check",
      sql`${table.releasedQty} >= 0`,
    ),
    check(
      "stock_reservations_accounted_qty_range_check",
      sql`${table.consumedQty} + ${table.releasedQty} <= ${table.qty}`,
    ),
    check(
      "stock_reservations_status_check",
      sql`${table.status} in ('reserved', 'committed', 'released', 'consumed', 'expired')`,
    ),
    check(
      "stock_reservations_source_key_normalized_check",
      sql`${table.sourceKey} = btrim(${table.sourceKey}) and length(${table.sourceKey}) > 0`,
    ),
    check(
      "stock_reservations_expiry_after_creation_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type NewInventoryItemRow = typeof inventoryItems.$inferInsert;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type NewStockMovementRow = typeof stockMovements.$inferInsert;
export type StockReservationRow = typeof stockReservations.$inferSelect;
export type NewStockReservationRow = typeof stockReservations.$inferInsert;

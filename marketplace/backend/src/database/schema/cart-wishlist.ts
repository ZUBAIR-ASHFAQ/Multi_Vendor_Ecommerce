import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customerProfiles } from "./customers.js";
import { products, productVariants } from "./products.js";

/** Stores one customer's current shopping intent and its display currency. */
export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carts_customer_user_id_uq").on(table.customerUserId),
    check(
      "carts_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

/** Stores one requested Product variant in a customer's cart; Product and Inventory remain authoritative. */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("cart_items_cart_variant_uq").on(table.cartId, table.variantId),
    check("cart_items_quantity_positive_check", sql`${table.quantity} > 0`),
  ],
);

/** Stores a named customer wishlist; Module 8 initially uses the single default wishlist. */
export const wishlists = pgTable(
  "wishlists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("wishlists_customer_default_uq")
      .on(table.customerUserId)
      .where(sql`${table.isDefault} = true`),
    check("wishlists_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
  ],
);

/** Stores a saved Product or optional Product variant inside one wishlist. */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "wishlist_items_variant_product_fk",
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
    }).onDelete("restrict"),
    uniqueIndex("wishlist_items_product_only_uq")
      .on(table.wishlistId, table.productId)
      .where(sql`${table.variantId} is null`),
    uniqueIndex("wishlist_items_variant_uq")
      .on(table.wishlistId, table.productId, table.variantId)
      .where(sql`${table.variantId} is not null`),
  ],
);

export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;
export type WishlistRow = typeof wishlists.$inferSelect;
export type WishlistItemRow = typeof wishlistItems.$inferSelect;

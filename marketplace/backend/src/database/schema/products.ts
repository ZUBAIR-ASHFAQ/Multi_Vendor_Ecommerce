import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
  integer,
} from "drizzle-orm/pg-core";
import { files } from "./audit.js";
import { users } from "./administration.js";
import {
  attributeValues,
  attributes,
  brands,
  categories,
} from "./catalog.js";
import { sellers, stores } from "./sellers.js";

/** Seller-owned product listing classified by Module 5 taxonomy. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id").references(() => brands.id, {
      onDelete: "restrict",
    }),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 240 }).notNull(),
    description: text("description").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    publicationStatus: varchar("publication_status", { length: 30 })
      .notNull()
      .default("draft"),
    moderationReason: text("moderation_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
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
      name: "products_store_seller_fk",
    }).onDelete("restrict"),
    uniqueIndex("products_slug_uq").on(table.slug),
    index("products_seller_store_status_idx").on(
      table.sellerId,
      table.storeId,
      table.publicationStatus,
      table.status,
    ),
    index("products_public_catalog_idx").on(
      table.publicationStatus,
      table.status,
      table.categoryId,
      table.brandId,
    ),
    check("products_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "products_publication_status_check",
      sql`${table.publicationStatus} in ('draft', 'pending_approval', 'published', 'rejected', 'unpublished')`,
    ),
    check(
      "products_slug_normalized_check",
      sql`${table.slug} = lower(btrim(${table.slug})) and length(${table.slug}) > 0`,
    ),
    check("products_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
    check(
      "products_description_not_blank_check",
      sql`length(btrim(${table.description})) > 0`,
    ),
    check(
      "products_published_at_state_check",
      sql`(${table.publicationStatus} = 'published' and ${table.publishedAt} is not null) or (${table.publicationStatus} <> 'published')`,
    ),
    check(
      "products_moderation_reason_check",
      sql`(${table.publicationStatus} = 'rejected' and ${table.moderationReason} is not null and length(btrim(${table.moderationReason})) > 0) or (${table.publicationStatus} <> 'rejected')`,
    ),
    index("products_moderation_queue_idx").on(
      table.publicationStatus,
      table.updatedAt,
      table.id,
    ),
  ],
);

/** Sellable SKU/variant owned by one product; inventory quantities remain Module 7 responsibility. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sku: varchar("sku", { length: 120 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    price: numeric("price", { precision: 18, scale: 2 }).notNull(),
    compareAtPrice: numeric("compare_at_price", { precision: 18, scale: 2 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    weight: numeric("weight", { precision: 12, scale: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_variants_product_sku_uq").on(table.productId, table.sku),
    uniqueIndex("product_variants_id_product_uq").on(table.id, table.productId),
    index("product_variants_product_status_idx").on(table.productId, table.status),
    check("product_variants_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "product_variants_sku_not_blank_check",
      sql`length(btrim(${table.sku})) > 0`,
    ),
    check(
      "product_variants_sku_normalized_check",
      sql`${table.sku} = btrim(${table.sku})`,
    ),
    check(
      "product_variants_title_not_blank_check",
      sql`length(btrim(${table.title})) > 0`,
    ),
    check("product_variants_price_check", sql`${table.price} >= 0`),
    check(
      "product_variants_compare_price_check",
      sql`${table.compareAtPrice} is null or ${table.compareAtPrice} >= 0`,
    ),
    check(
      "product_variants_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "product_variants_weight_check",
      sql`${table.weight} is null or ${table.weight} >= 0`,
    ),
  ],
);

/** Product- or variant-level value selected from one Module 5 attribute definition. */
export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id"),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    valueText: text("value_text"),
    valueNumber: numeric("value_number", { precision: 24, scale: 6 }),
    valueId: uuid("value_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
      name: "product_attribute_values_variant_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.valueId, table.attributeId],
      foreignColumns: [attributeValues.id, attributeValues.attributeId],
      name: "product_attribute_values_value_attribute_fk",
    }).onDelete("restrict"),
    uniqueIndex("product_attribute_values_product_attribute_uq")
      .on(table.productId, table.attributeId)
      .where(sql`${table.variantId} is null`),
    uniqueIndex("product_attribute_values_variant_attribute_uq")
      .on(table.variantId, table.attributeId)
      .where(sql`${table.variantId} is not null`),
    index("product_attribute_values_attribute_idx").on(table.attributeId),
    index("product_attribute_values_value_id_idx").on(table.valueId),
    check(
      "product_attribute_values_one_value_check",
      sql`num_nonnulls(${table.valueText}, ${table.valueNumber}, ${table.valueId}) = 1`,
    ),
    check(
      "product_attribute_values_text_not_blank_check",
      sql`${table.valueText} is null or length(btrim(${table.valueText})) > 0`,
    ),
  ],
);

/** Product media metadata linked to a confirmed Module 21 file object. */
export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id"),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
    mediaType: varchar("media_type", { length: 40 }).notNull(),
    altText: varchar("alt_text", { length: 500 }),
    sortOrder: integer("sort_order").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.variantId, table.productId],
      foreignColumns: [productVariants.id, productVariants.productId],
      name: "product_media_variant_product_fk",
    }).onDelete("restrict"),
    index("product_media_product_status_sort_idx").on(
      table.productId,
      table.status,
      table.sortOrder,
    ),
    index("product_media_variant_idx").on(table.variantId),
    index("product_media_file_idx").on(table.fileId),
    check("product_media_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "product_media_type_not_blank_check",
      sql`length(btrim(${table.mediaType})) > 0`,
    ),
    check(
      "product_media_alt_text_not_blank_check",
      sql`${table.altText} is null or length(btrim(${table.altText})) > 0`,
    ),
    check("product_media_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

/** Immutable price-change history appended whenever a variant price changes. */
export const productPriceHistory = pgTable(
  "product_price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    oldPrice: numeric("old_price", { precision: 18, scale: 2 }).notNull(),
    newPrice: numeric("new_price", { precision: 18, scale: 2 }).notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("product_price_history_variant_changed_idx").on(
      table.variantId,
      table.changedAt,
    ),
    check("product_price_history_old_price_check", sql`${table.oldPrice} >= 0`),
    check("product_price_history_new_price_check", sql`${table.newPrice} >= 0`),
  ],
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type NewProductVariantRow = typeof productVariants.$inferInsert;
export type ProductAttributeValueRow = typeof productAttributeValues.$inferSelect;
export type NewProductAttributeValueRow = typeof productAttributeValues.$inferInsert;
export type ProductMediaRow = typeof productMedia.$inferSelect;
export type NewProductMediaRow = typeof productMedia.$inferInsert;
export type ProductPriceHistoryRow = typeof productPriceHistory.$inferSelect;
export type NewProductPriceHistoryRow = typeof productPriceHistory.$inferInsert;

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Category hierarchy used by product classification and storefront navigation. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id"),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "categories_parent_id_categories_id_fk",
    }).onDelete("restrict"),
    uniqueIndex("categories_slug_uq").on(table.slug),
    index("categories_parent_status_sort_idx").on(
      table.parentId,
      table.status,
      table.sortOrder,
    ),
    check(
      "categories_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "categories_slug_normalized_check",
      sql`${table.slug} = lower(btrim(${table.slug})) and length(${table.slug}) > 0`,
    ),
    check(
      "categories_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "categories_not_own_parent_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    check("categories_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

/** Reusable product brand master referenced later by Product Management. */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
  },
  (table) => [
    uniqueIndex("brands_slug_uq").on(table.slug),
    index("brands_status_name_idx").on(table.status, table.name),
    check(
      "brands_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "brands_slug_normalized_check",
      sql`${table.slug} = lower(btrim(${table.slug})) and length(${table.slug}) > 0`,
    ),
    check("brands_name_not_blank_check", sql`length(btrim(${table.name})) > 0`),
  ],
);

/** Reusable attribute definition used by categories, products, variants, and search facets. */
export const attributes = pgTable(
  "attributes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    dataType: varchar("data_type", { length: 40 }).notNull(),
    isVariantAxis: boolean("is_variant_axis").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("active"),
  },
  (table) => [
    uniqueIndex("attributes_code_uq").on(table.code),
    index("attributes_status_name_idx").on(table.status, table.name),
    check(
      "attributes_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "attributes_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and length(${table.code}) > 0`,
    ),
    check(
      "attributes_name_not_blank_check",
      sql`length(btrim(${table.name})) > 0`,
    ),
    check(
      "attributes_data_type_not_blank_check",
      sql`length(btrim(${table.dataType})) > 0`,
    ),
  ],
);

/** Ordered value option belonging to one reusable attribute definition. */
export const attributeValues = pgTable(
  "attribute_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    value: varchar("value", { length: 240 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("active"),
  },
  (table) => [
    uniqueIndex("attribute_values_id_attribute_uq").on(
      table.id,
      table.attributeId,
    ),
    index("attribute_values_attribute_status_sort_idx").on(
      table.attributeId,
      table.status,
      table.sortOrder,
    ),
    check(
      "attribute_values_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
    check(
      "attribute_values_value_not_blank_check",
      sql`length(btrim(${table.value})) > 0`,
    ),
    check("attribute_values_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

/** Category-to-attribute rule that controls required fields and storefront facets. */
export const categoryAttributes = pgTable(
  "category_attributes",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "restrict" }),
    isRequired: boolean("is_required").notNull().default(false),
    isFilterable: boolean("is_filterable").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.categoryId, table.attributeId],
      name: "category_attributes_pk",
    }),
    index("category_attributes_attribute_idx").on(table.attributeId),
    check("category_attributes_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
export type BrandRow = typeof brands.$inferSelect;
export type NewBrandRow = typeof brands.$inferInsert;
export type AttributeRow = typeof attributes.$inferSelect;
export type NewAttributeRow = typeof attributes.$inferInsert;
export type AttributeValueRow = typeof attributeValues.$inferSelect;
export type NewAttributeValueRow = typeof attributeValues.$inferInsert;
export type CategoryAttributeRow = typeof categoryAttributes.$inferSelect;
export type NewCategoryAttributeRow = typeof categoryAttributes.$inferInsert;

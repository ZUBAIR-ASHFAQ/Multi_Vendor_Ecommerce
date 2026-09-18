import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { brands, categories } from "./catalog.js";
import { products } from "./products.js";

/** Eventually-consistent public Search document derived from one published Product. */
export const productSearchDocuments = pgTable(
  "product_search_documents",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    searchableText: text("searchable_text").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    categoryPath: text("category_path").notNull(),
    brandId: uuid("brand_id").references(() => brands.id, {
      onDelete: "restrict",
    }),
    brand: varchar("brand", { length: 200 }),
    minPrice: numeric("min_price", { precision: 18, scale: 2 }).notNull(),
    maxPrice: numeric("max_price", { precision: 18, scale: 2 }).notNull(),
    ratingAvg: numeric("rating_avg", { precision: 4, scale: 2 })
      .notNull()
      .default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    inStock: boolean("in_stock").notNull().default(false),
    filterableAttributes: jsonb("filterable_attributes")
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // PostgreSQL FTS is the primary relevance path; pg_trgm provides typo/fuzzy fallback.
    index("product_search_documents_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', ${table.searchableText})`,
    ),
    index("product_search_documents_trgm_idx").using(
      "gin",
      sql`${table.searchableText} gin_trgm_ops`,
    ),
    index("product_search_documents_category_idx").on(table.categoryId),
    index("product_search_documents_brand_idx").on(table.brandId),
    index("product_search_documents_price_idx").on(table.minPrice, table.maxPrice),
    index("product_search_documents_rating_idx").on(table.ratingAvg, table.ratingCount),
    index("product_search_documents_in_stock_idx")
      .on(table.inStock)
      .where(sql`${table.inStock} = true`),
    index("product_search_documents_attributes_idx").using(
      "gin",
      sql`${table.filterableAttributes} jsonb_path_ops`,
    ),
    index("product_search_documents_updated_idx").on(table.updatedAt),
    check(
      "product_search_documents_searchable_text_not_blank_check",
      sql`length(btrim(${table.searchableText})) > 0`,
    ),
    check(
      "product_search_documents_category_path_not_blank_check",
      sql`length(btrim(${table.categoryPath})) > 0`,
    ),
    check(
      "product_search_documents_brand_not_blank_check",
      sql`${table.brand} is null or length(btrim(${table.brand})) > 0`,
    ),
    check("product_search_documents_min_price_check", sql`${table.minPrice} >= 0`),
    check("product_search_documents_max_price_check", sql`${table.maxPrice} >= 0`),
    check(
      "product_search_documents_price_range_check",
      sql`${table.minPrice} <= ${table.maxPrice}`,
    ),
    check(
      "product_search_documents_rating_avg_check",
      sql`${table.ratingAvg} >= 0 and ${table.ratingAvg} <= 5`,
    ),
    check(
      "product_search_documents_rating_count_check",
      sql`${table.ratingCount} >= 0`,
    ),
    check(
      "product_search_documents_attributes_object_check",
      sql`jsonb_typeof(${table.filterableAttributes}) = 'object'`,
    ),
  ],
);

/** Admin-managed synonym set used to expand public Search queries. */
export const searchSynonyms = pgTable(
  "search_synonyms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    term: varchar("term", { length: 160 }).notNull(),
    synonyms: jsonb("synonyms").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("search_synonyms_term_uq").on(table.term),
    index("search_synonyms_status_term_idx").on(table.status, table.term),
    check(
      "search_synonyms_term_normalized_check",
      sql`${table.term} = lower(btrim(${table.term})) and length(${table.term}) > 0`,
    ),
    check(
      "search_synonyms_values_array_check",
      sql`jsonb_typeof(${table.synonyms}) = 'array' and jsonb_array_length(${table.synonyms}) > 0`,
    ),
    check(
      "search_synonyms_status_check",
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
);

/** Durable status record for one bounded full-catalog Search reindex request. */
export const searchReindexRuns = pgTable(
  "search_reindex_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 40 }).notNull().default("full_catalog"),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    errorCode: varchar("error_code", { length: 120 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("search_reindex_runs_active_scope_uq")
      .on(table.scope)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("search_reindex_runs_status_requested_idx").on(table.status, table.requestedAt),
    check(
      "search_reindex_runs_scope_check",
      sql`${table.scope} = 'full_catalog'`,
    ),
    check(
      "search_reindex_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
    check(
      "search_reindex_runs_state_check",
      sql`(
        ${table.status} = 'queued'
        and ${table.startedAt} is null
        and ${table.completedAt} is null
        and ${table.errorCode} is null
      ) or (
        ${table.status} = 'running'
        and ${table.startedAt} is not null
        and ${table.completedAt} is null
        and ${table.errorCode} is null
      ) or (
        ${table.status} = 'completed'
        and ${table.startedAt} is not null
        and ${table.completedAt} is not null
        and ${table.errorCode} is null
      ) or (
        ${table.status} = 'failed'
        and ${table.startedAt} is not null
        and ${table.completedAt} is not null
        and ${table.errorCode} is not null
        and length(btrim(${table.errorCode})) > 0
      )`,
    ),
    check(
      "search_reindex_runs_started_after_requested_check",
      sql`${table.startedAt} is null or ${table.startedAt} >= ${table.requestedAt}`,
    ),
    check(
      "search_reindex_runs_completed_after_started_check",
      sql`${table.completedAt} is null or (${table.startedAt} is not null and ${table.completedAt} >= ${table.startedAt})`,
    ),
  ],
);

export type ProductSearchDocumentRow = typeof productSearchDocuments.$inferSelect;
export type NewProductSearchDocumentRow = typeof productSearchDocuments.$inferInsert;
export type SearchSynonymRow = typeof searchSynonyms.$inferSelect;
export type SearchReindexRunRow = typeof searchReindexRuns.$inferSelect;

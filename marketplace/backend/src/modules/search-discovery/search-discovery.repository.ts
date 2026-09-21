import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  attributes,
  brands,
  categories,
} from "../../database/schema/catalog.js";
import {
  productMedia,
  products,
  productVariants,
} from "../../database/schema/products.js";
import {
  productSearchDocuments,
  searchReindexRuns,
  searchSynonyms,
  type NewProductSearchDocumentRow,
  type ProductSearchDocumentRow,
  type SearchReindexRunRow,
  type SearchSynonymRow,
} from "../../database/schema/search-discovery.js";
import { sellers, stores } from "../../database/schema/sellers.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { CATALOG_STATUS } from "../catalog-taxonomy/catalog-taxonomy.constants.js";
import {
  PRODUCT_PUBLICATION_STATUS,
  PRODUCT_STATUS,
} from "../products/products.constants.js";
import {
  SELLER_APPROVAL_STATUS,
  SELLER_STATUS,
  STORE_STATUS,
} from "../sellers/sellers.constants.js";
import {
  SEARCH_PRODUCT_SORT,
  SEARCH_REINDEX_SCOPE,
  SEARCH_REINDEX_STATUS,
} from "./search-discovery.constants.js";
import type {
  SearchProductsQuery,
  SearchStoresQuery,
  SearchSuggestionsQuery,
} from "./search-discovery.schema.js";

/** Canonical JSON shape stored in product_search_documents.filterable_attributes. */
export type SearchFilterableAttributes = Record<string, string[]>;

/** Values needed to replace one derived Product Search document. */
export interface UpsertProductSearchDocumentInput {
  productId: string;
  searchableText: string;
  categoryId: string;
  categoryPath: string;
  brandId: string | null;
  brand: string | null;
  minPrice: string;
  maxPrice: string;
  ratingAvg: string;
  ratingCount: number;
  inStock: boolean;
  filterableAttributes: SearchFilterableAttributes;
  updatedAt?: Date;
}

/** Public-safe Product card data returned by the repository before service mapping. */
export interface SearchProductRow {
  productId: string;
  storeId: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryPath: string;
  brandId: string | null;
  brand: string | null;
  minPrice: string;
  maxPrice: string;
  minCompareAtPrice: string | null;
  maxCompareAtPrice: string | null;
  currency: string;
  ratingAvg: string;
  ratingCount: number;
  inStock: boolean;
  thumbnailFileId: string | null;
  updatedAt: Date;
}

/** Product Search page returned with a total used for the shared pagination envelope. */
export interface PaginatedSearchProductRows {
  items: SearchProductRow[];
  totalItems: number;
}

/** One category aggregate generated from the current public Search result set. */
export interface SearchCategoryFacetRow {
  categoryId: string;
  label: string;
  path: string;
  count: number;
}

/** One brand aggregate generated from the current public Search result set. */
export interface SearchBrandFacetRow {
  brandId: string;
  label: string;
  count: number;
}

/** One flattened attribute/value aggregate generated from filterable Search JSON. */
export interface SearchAttributeFacetRow {
  attributeId: string;
  attributeLabel: string;
  value: string;
  count: number;
}

/** Price and availability aggregates generated from the current public Search result set. */
export interface SearchSummaryFacetRow {
  minPrice: string | null;
  maxPrice: string | null;
  inStockCount: number;
  outOfStockCount: number;
}

/** All facet rows needed by the service to build the public Search facet response. */
export interface SearchFacetRows {
  categories: SearchCategoryFacetRow[];
  brands: SearchBrandFacetRow[];
  attributes: SearchAttributeFacetRow[];
  summary: SearchSummaryFacetRow;
}

/** Public-safe store data returned by Search without seller-private fields. */
export interface SearchStoreRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoFileId: string | null;
  defaultCurrency: string;
  supportEmail: string | null;
  sellerId: string;
  sellerDisplayName: string;
}

/** Public store page returned with a total used for the shared pagination envelope. */
export interface PaginatedSearchStoreRows {
  items: SearchStoreRow[];
  totalItems: number;
}

/** Small stable ID page used by bounded full-catalog reindex workers. */
export interface SearchProductIdPage {
  productIds: string[];
  nextAfterProductId: string | null;
}

/** Reads one raw SQL field after confirming the result row is object-like. */
function readRawResultField(row: unknown, field: string): unknown {
  if (typeof row !== "object" || row === null) {
    throw new Error(`Search query returned an invalid row for ${field}.`);
  }

  return Reflect.get(row, field);
}

/** Reads one required string field from a raw SQL result. */
function readRawStringField(row: unknown, field: string): string {
  const value = readRawResultField(row, field);

  if (typeof value !== "string") {
    throw new Error(`Search query returned an invalid string field: ${field}.`);
  }

  return value;
}

/** Reads one required numeric field from a raw SQL result. */
function readRawNumberField(row: unknown, field: string): number {
  const value = Number(readRawResultField(row, field));

  if (!Number.isFinite(value)) {
    throw new Error(`Search query returned an invalid numeric field: ${field}.`);
  }

  return value;
}

/** Splits validated attributeId=value tokens into deterministic repository filter pairs. */
function parseAttributeFilters(tokens: string[] | undefined): Array<{
  attributeId: string;
  value: string;
}> {
  if (!tokens) return [];

  return tokens.map((token) => {
    const separatorIndex = token.indexOf("=");
    return {
      attributeId: token.slice(0, separatorIndex),
      value: token.slice(separatorIndex + 1).trim(),
    };
  });
}

/** Combines only predicates that are present so optional storefront filters stay readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const defined = conditions.filter((condition): condition is SQL => Boolean(condition));
  return defined.length === 0 ? undefined : and(...defined);
}

/** Adds the defense-in-depth public visibility rules shared by Search reads and reindex paging. */
function publicSearchVisibilityCondition(): SQL {
  return and(
    eq(products.status, PRODUCT_STATUS.ACTIVE),
    eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
    eq(stores.status, STORE_STATUS.ACTIVE),
    eq(sellers.status, SELLER_STATUS.ACTIVE),
    eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
    eq(categories.status, CATALOG_STATUS.ACTIVE),
    or(
      isNull(productSearchDocuments.brandId),
      eq(brands.status, CATALOG_STATUS.ACTIVE),
    ),
  ) as SQL;
}

/** Builds the PostgreSQL FTS plus trigram predicate for one optional Product Search phrase. */
function productTextSearchCondition(queryText: string | undefined): SQL | undefined {
  if (!queryText) return undefined;

  return sql`(
    to_tsvector('simple', ${productSearchDocuments.searchableText})
      @@ websearch_to_tsquery('simple', ${queryText})
    or ${productSearchDocuments.searchableText} % ${queryText}
  )`;
}

/** Computes one relevance score from the same FTS/trigram expressions used by Product Search. */
function productRelevanceExpression(queryText: string | undefined): SQL<number> {
  if (!queryText) return sql<number>`0`;

  return sql<number>`greatest(
    ts_rank_cd(
      to_tsvector('simple', ${productSearchDocuments.searchableText}),
      websearch_to_tsquery('simple', ${queryText})
    ),
    similarity(${productSearchDocuments.searchableText}, ${queryText})
  )`;
}

/** Converts one validated Product Search query into parameterized database predicates. */
function productSearchWhere(query: SearchProductsQuery): SQL {
  const attributeConditions = parseAttributeFilters(query.attribute).map(
    ({ attributeId, value }) =>
      sql`${productSearchDocuments.filterableAttributes} @> ${JSON.stringify({
        [attributeId]: [value],
      })}::jsonb`,
  );

  return combineConditions([
    publicSearchVisibilityCondition(),
    productTextSearchCondition(query.q),
    query.categoryId
      ? eq(productSearchDocuments.categoryId, query.categoryId)
      : undefined,
    query.brandId ? eq(productSearchDocuments.brandId, query.brandId) : undefined,
    query.minPrice
      ? gte(productSearchDocuments.maxPrice, query.minPrice)
      : undefined,
    query.maxPrice
      ? lte(productSearchDocuments.minPrice, query.maxPrice)
      : undefined,
    query.minRating !== undefined
      ? gte(productSearchDocuments.ratingAvg, query.minRating.toFixed(2))
      : undefined,
    query.inStock !== undefined
      ? eq(productSearchDocuments.inStock, query.inStock)
      : undefined,
    ...attributeConditions,
  ]) as SQL;
}

/** Maps the allow-listed Product Search sort key to deterministic SQL ordering. */
function productSearchOrder(query: SearchProductsQuery): SQL[] {
  switch (query.sort) {
    case SEARCH_PRODUCT_SORT.PRICE_ASC:
      return [asc(productSearchDocuments.minPrice), asc(productSearchDocuments.productId)];
    case SEARCH_PRODUCT_SORT.PRICE_DESC:
      return [desc(productSearchDocuments.minPrice), asc(productSearchDocuments.productId)];
    case SEARCH_PRODUCT_SORT.RATING_DESC:
      return [
        desc(productSearchDocuments.ratingAvg),
        desc(productSearchDocuments.ratingCount),
        asc(productSearchDocuments.productId),
      ];
    case SEARCH_PRODUCT_SORT.NEWEST:
      return [desc(products.publishedAt), asc(productSearchDocuments.productId)];
    case SEARCH_PRODUCT_SORT.RELEVANCE:
    default:
      return [
        desc(productRelevanceExpression(query.q)),
        desc(productSearchDocuments.updatedAt),
        asc(productSearchDocuments.productId),
      ];
  }
}

/** Builds the FTS/trigram Search text expression for public stores. */
function storeSearchTextExpression(): SQL<string> {
  return sql<string>`concat_ws(
    ' ',
    ${stores.name},
    ${stores.slug},
    coalesce(${stores.description}, ''),
    ${sellers.displayName}
  )`;
}

/** Builds the public store Search predicate from the validated store query. */
function storeSearchWhere(query: SearchStoresQuery): SQL {
  const searchText = storeSearchTextExpression();

  return and(
    eq(stores.status, STORE_STATUS.ACTIVE),
    eq(sellers.status, SELLER_STATUS.ACTIVE),
    eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
    sql`(
      to_tsvector('simple', ${searchText}) @@ websearch_to_tsquery('simple', ${query.q})
      or ${searchText} % ${query.q}
    )`,
  ) as SQL;
}

/** Computes a deterministic FTS/trigram relevance score for public store results. */
function storeRelevanceExpression(queryText: string): SQL<number> {
  const searchText = storeSearchTextExpression();
  return sql<number>`greatest(
    ts_rank_cd(
      to_tsvector('simple', ${searchText}),
      websearch_to_tsquery('simple', ${queryText})
    ),
    similarity(${searchText}, ${queryText})
  )`;
}

/** Maps the allow-listed store Search sort key to deterministic SQL ordering. */
function storeSearchOrder(query: SearchStoresQuery): SQL[] {
  if (query.sort === "name") {
    return [asc(stores.name), asc(stores.id)];
  }

  return [
    desc(storeRelevanceExpression(query.q)),
    asc(stores.name),
    asc(stores.id),
  ];
}

/**
 * Persistence-only Module 19 repository.
 * Search visibility policy, source-module orchestration, queueing, audit, and outbox decisions stay in services.
 */
export class SearchDiscoveryRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Reads one derived Search document by Product ID for idempotent synchronization decisions. */
  async findProductSearchDocument(
    productId: string,
  ): Promise<ProductSearchDocumentRow | null> {
    const [row] = await this.executor
      .select()
      .from(productSearchDocuments)
      .where(eq(productSearchDocuments.productId, productId))
      .limit(1);

    return row ?? null;
  }

  /** Inserts or fully replaces one derived Product Search document without mutating source modules. */
  async upsertProductSearchDocument(
    input: UpsertProductSearchDocumentInput,
  ): Promise<ProductSearchDocumentRow> {
    const values: NewProductSearchDocumentRow = {
      ...input,
      updatedAt: input.updatedAt ?? new Date(),
    };

    const [row] = await this.executor
      .insert(productSearchDocuments)
      .values(values)
      .onConflictDoUpdate({
        target: productSearchDocuments.productId,
        set: {
          searchableText: values.searchableText,
          categoryId: values.categoryId,
          categoryPath: values.categoryPath,
          brandId: values.brandId,
          brand: values.brand,
          minPrice: values.minPrice,
          maxPrice: values.maxPrice,
          ratingAvg: values.ratingAvg,
          ratingCount: values.ratingCount,
          inStock: values.inStock,
          filterableAttributes: values.filterableAttributes,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Search document upsert returned no row.");
    }

    return row;
  }

  /** Removes one stale derived Search document after the service decides it is no longer public. */
  async deleteProductSearchDocument(productId: string): Promise<boolean> {
    const rows = await this.executor
      .delete(productSearchDocuments)
      .where(eq(productSearchDocuments.productId, productId))
      .returning({ productId: productSearchDocuments.productId });

    return rows.length > 0;
  }

  /** Removes derived documents whose Product/store/seller/taxonomy source is no longer publicly eligible. */
  async deleteNonPublicProductSearchDocuments(): Promise<string[]> {
    const result = await this.executor.execute(sql<{ productId: string }>`
      delete from ${productSearchDocuments} as search_document
      where not exists (
        select 1
        from ${products}
        inner join ${stores}
          on ${stores.id} = ${products.storeId}
        inner join ${sellers}
          on ${sellers.id} = ${products.sellerId}
        inner join ${categories}
          on ${categories.id} = ${products.categoryId}
        left join ${brands}
          on ${brands.id} = ${products.brandId}
        where ${products.id} = search_document.product_id
          and ${products.status} = ${PRODUCT_STATUS.ACTIVE}
          and ${products.publicationStatus} = ${PRODUCT_PUBLICATION_STATUS.PUBLISHED}
          and ${stores.status} = ${STORE_STATUS.ACTIVE}
          and ${sellers.status} = ${SELLER_STATUS.ACTIVE}
          and ${sellers.approvalStatus} = ${SELLER_APPROVAL_STATUS.APPROVED}
          and ${categories.status} = ${CATALOG_STATUS.ACTIVE}
          and (${products.brandId} is null or ${brands.status} = ${CATALOG_STATUS.ACTIVE})
      )
      returning search_document.product_id as "productId"
    `);

    return result.rows.map((row) => readRawStringField(row, "productId"));
  }

  /** Searches public Product documents with bounded filters, PostgreSQL relevance, and deterministic pagination. */
  async searchProducts(query: SearchProductsQuery): Promise<PaginatedSearchProductRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = productSearchWhere(query);
    const thumbnailFileId = sql<string | null>`(
      select ${productMedia.fileId}
      from ${productMedia}
      where ${productMedia.productId} = ${products.id}
        and ${productMedia.status} = 'active'
      order by ${productMedia.sortOrder} asc, ${productMedia.id} asc
      limit 1
    )`;
    const minCompareAtPrice = sql<string | null>`(
      select min(${productVariants.compareAtPrice})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
        and ${productVariants.status} = ${PRODUCT_STATUS.ACTIVE}
        and ${productVariants.compareAtPrice} is not null
        and ${productVariants.compareAtPrice} > ${productVariants.price}
    )`;
    const maxCompareAtPrice = sql<string | null>`(
      select max(${productVariants.compareAtPrice})
      from ${productVariants}
      where ${productVariants.productId} = ${products.id}
        and ${productVariants.status} = ${PRODUCT_STATUS.ACTIVE}
        and ${productVariants.compareAtPrice} is not null
        and ${productVariants.compareAtPrice} > ${productVariants.price}
    )`;

    const items = await this.executor
      .select({
        productId: productSearchDocuments.productId,
        storeId: products.storeId,
        slug: products.slug,
        name: products.name,
        categoryId: productSearchDocuments.categoryId,
        categoryPath: productSearchDocuments.categoryPath,
        brandId: productSearchDocuments.brandId,
        brand: productSearchDocuments.brand,
        minPrice: productSearchDocuments.minPrice,
        maxPrice: productSearchDocuments.maxPrice,
        minCompareAtPrice,
        maxCompareAtPrice,
        currency: stores.defaultCurrency,
        ratingAvg: productSearchDocuments.ratingAvg,
        ratingCount: productSearchDocuments.ratingCount,
        inStock: productSearchDocuments.inStock,
        thumbnailFileId,
        updatedAt: productSearchDocuments.updatedAt,
      })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(where)
      .orderBy(...productSearchOrder(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Computes category, brand, attribute, price, and availability facets for the current Product result set. */
  async getProductFacets(query: SearchProductsQuery): Promise<SearchFacetRows> {
    const where = productSearchWhere(query);

    const categoryRows = await this.executor
      .select({
        categoryId: productSearchDocuments.categoryId,
        label: categories.name,
        path: productSearchDocuments.categoryPath,
        count: sql<number>`count(*)::int`,
      })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(where)
      .groupBy(
        productSearchDocuments.categoryId,
        categories.name,
        productSearchDocuments.categoryPath,
      )
      .orderBy(desc(sql`count(*)`), asc(categories.name));

    const rawBrandRows = await this.executor
      .select({
        brandId: productSearchDocuments.brandId,
        label: productSearchDocuments.brand,
        count: sql<number>`count(*)::int`,
      })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(and(where, isNotNull(productSearchDocuments.brandId), isNotNull(productSearchDocuments.brand)))
      .groupBy(productSearchDocuments.brandId, productSearchDocuments.brand)
      .orderBy(desc(sql`count(*)`), asc(productSearchDocuments.brand));

    const [summaryRow] = await this.executor
      .select({
        minPrice: sql<string | null>`min(${productSearchDocuments.minPrice})`,
        maxPrice: sql<string | null>`max(${productSearchDocuments.maxPrice})`,
        inStockCount: sql<number>`count(*) filter (where ${productSearchDocuments.inStock} = true)::int`,
        outOfStockCount: sql<number>`count(*) filter (where ${productSearchDocuments.inStock} = false)::int`,
      })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(where);

    const attributeResult = await this.executor.execute(sql<{
      attributeId: string;
      attributeLabel: string;
      value: string;
      count: number;
    }>`
      select
        attribute_entry.attribute_id as "attributeId",
        ${attributes.name} as "attributeLabel",
        attribute_value.value as "value",
        count(*)::int as "count"
      from ${productSearchDocuments}
      inner join ${products}
        on ${products.id} = ${productSearchDocuments.productId}
      inner join ${stores}
        on ${stores.id} = ${products.storeId}
      inner join ${sellers}
        on ${sellers.id} = ${products.sellerId}
      inner join ${categories}
        on ${categories.id} = ${productSearchDocuments.categoryId}
      left join ${brands}
        on ${brands.id} = ${productSearchDocuments.brandId}
      cross join lateral jsonb_each(${productSearchDocuments.filterableAttributes})
        as attribute_entry(attribute_id, attribute_values)
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(attribute_entry.attribute_values) = 'array'
            then attribute_entry.attribute_values
          else jsonb_build_array(attribute_entry.attribute_values)
        end
      ) as attribute_value(value)
      inner join ${attributes}
        on ${attributes.id}::text = attribute_entry.attribute_id
       and ${attributes.status} = ${CATALOG_STATUS.ACTIVE}
      where ${where}
      group by attribute_entry.attribute_id, ${attributes.name}, attribute_value.value
      order by ${attributes.name} asc, count(*) desc, attribute_value.value asc
    `);

    const brandsFiltered: SearchBrandFacetRow[] = rawBrandRows.flatMap((row) =>
      row.brandId && row.label
        ? [{ brandId: row.brandId, label: row.label, count: Number(row.count) }]
        : [],
    );

    return {
      categories: categoryRows.map((row) => ({ ...row, count: Number(row.count) })),
      brands: brandsFiltered,
      attributes: attributeResult.rows.map((row) => ({
        attributeId: readRawStringField(row, "attributeId"),
        attributeLabel: readRawStringField(row, "attributeLabel"),
        value: readRawStringField(row, "value"),
        count: readRawNumberField(row, "count"),
      })),
      summary: {
        minPrice: summaryRow?.minPrice ?? null,
        maxPrice: summaryRow?.maxPrice ?? null,
        inStockCount: Number(summaryRow?.inStockCount ?? 0),
        outOfStockCount: Number(summaryRow?.outOfStockCount ?? 0),
      },
    };
  }

  /** Returns bounded public Product-name autocomplete suggestions ranked by Search relevance. */
  async searchSuggestions(query: SearchSuggestionsQuery): Promise<string[]> {
    const relevance = productRelevanceExpression(query.q);
    const where = and(
      publicSearchVisibilityCondition(),
      or(
        ilike(products.name, `${query.q}%`),
        productTextSearchCondition(query.q),
      ),
    );

    const rows = await this.executor
      .select({
        suggestion: products.name,
        relevance: sql<number>`max(${relevance})`,
      })
      .from(productSearchDocuments)
      .innerJoin(products, eq(products.id, productSearchDocuments.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, productSearchDocuments.categoryId))
      .leftJoin(brands, eq(brands.id, productSearchDocuments.brandId))
      .where(where)
      .groupBy(products.name)
      .orderBy(desc(sql`max(${relevance})`), asc(products.name))
      .limit(query.limit);

    return rows.map((row) => row.suggestion);
  }

  /** Searches only active public stores and returns no private seller fields. */
  async searchStores(query: SearchStoresQuery): Promise<PaginatedSearchStoreRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = storeSearchWhere(query);

    const items = await this.executor
      .select({
        id: stores.id,
        slug: stores.slug,
        name: stores.name,
        description: stores.description,
        logoFileId: stores.logoFileId,
        defaultCurrency: stores.defaultCurrency,
        supportEmail: stores.supportEmail,
        sellerId: sellers.id,
        sellerDisplayName: sellers.displayName,
      })
      .from(stores)
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .where(where)
      .orderBy(...storeSearchOrder(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(stores)
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads active synonym rows for normalized query terms without creating search-time writes. */
  async listActiveSynonymsByTerms(terms: string[]): Promise<SearchSynonymRow[]> {
    const normalizedTerms = [...new Set(terms.map((term) => term.trim().toLowerCase()))].filter(
      Boolean,
    );
    if (normalizedTerms.length === 0) return [];

    return this.executor
      .select()
      .from(searchSynonyms)
      .where(
        and(
          eq(searchSynonyms.status, "active"),
          inArray(searchSynonyms.term, normalizedTerms),
        ),
      )
      .orderBy(asc(searchSynonyms.term), asc(searchSynonyms.id));
  }

  /** Creates one queued full-catalog reindex row; the database unique guard rejects concurrent active runs. */
  async createReindexRun(requestedAt: Date = new Date()): Promise<SearchReindexRunRow> {
    const [row] = await this.executor
      .insert(searchReindexRuns)
      .values({
        scope: SEARCH_REINDEX_SCOPE.FULL_CATALOG,
        status: SEARCH_REINDEX_STATUS.QUEUED,
        requestedAt,
        updatedAt: requestedAt,
      })
      .returning();

    if (!row) {
      throw new Error("Search reindex creation returned no row.");
    }

    return row;
  }

  /** Reads the currently queued/running full-catalog reindex row when one exists. */
  async findActiveReindexRun(): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .select()
      .from(searchReindexRuns)
      .where(
        and(
          eq(searchReindexRuns.scope, SEARCH_REINDEX_SCOPE.FULL_CATALOG),
          inArray(searchReindexRuns.status, [
            SEARCH_REINDEX_STATUS.QUEUED,
            SEARCH_REINDEX_STATUS.RUNNING,
          ]),
        ),
      )
      .orderBy(desc(searchReindexRuns.requestedAt), desc(searchReindexRuns.id))
      .limit(1);

    return row ?? null;
  }

  /** Reads one reindex status row by its public admin identifier. */
  async findReindexRunById(reindexRunId: string): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .select()
      .from(searchReindexRuns)
      .where(eq(searchReindexRuns.id, reindexRunId))
      .limit(1);

    return row ?? null;
  }

  /** Persists the queued-to-running timestamp/state chosen by the reindex service/worker. */
  async markReindexRunRunning(
    reindexRunId: string,
    startedAt: Date = new Date(),
  ): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .update(searchReindexRuns)
      .set({
        status: SEARCH_REINDEX_STATUS.RUNNING,
        startedAt,
        updatedAt: startedAt,
      })
      .where(
        and(
          eq(searchReindexRuns.id, reindexRunId),
          eq(searchReindexRuns.status, SEARCH_REINDEX_STATUS.QUEUED),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Persists the running-to-completed reindex state without deciding when completion is valid. */
  async markReindexRunCompleted(
    reindexRunId: string,
    finishedAt: Date = new Date(),
  ): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .update(searchReindexRuns)
      .set({
        status: SEARCH_REINDEX_STATUS.COMPLETED,
        completedAt: finishedAt,
        errorCode: null,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(searchReindexRuns.id, reindexRunId),
          eq(searchReindexRuns.status, SEARCH_REINDEX_STATUS.RUNNING),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Marks a queued run failed when BullMQ enqueueing fails before processing can begin. */
  async markQueuedReindexRunFailed(
    reindexRunId: string,
    errorCode: string,
    failedAt: Date = new Date(),
  ): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .update(searchReindexRuns)
      .set({
        status: SEARCH_REINDEX_STATUS.FAILED,
        startedAt: failedAt,
        completedAt: failedAt,
        errorCode,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(searchReindexRuns.id, reindexRunId),
          eq(searchReindexRuns.status, SEARCH_REINDEX_STATUS.QUEUED),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Persists a stable failure code for one running reindex row. */
  async markReindexRunFailed(
    reindexRunId: string,
    errorCode: string,
    finishedAt: Date = new Date(),
  ): Promise<SearchReindexRunRow | null> {
    const [row] = await this.executor
      .update(searchReindexRuns)
      .set({
        status: SEARCH_REINDEX_STATUS.FAILED,
        completedAt: finishedAt,
        errorCode,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(searchReindexRuns.id, reindexRunId),
          eq(searchReindexRuns.status, SEARCH_REINDEX_STATUS.RUNNING),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Pages public Product IDs in stable UUID order for a bounded full-catalog reindex worker. */
  async listPublishedProductIdsForReindex(
    limit: number,
    afterProductId?: string,
  ): Promise<SearchProductIdPage> {
    const visibility = and(
      eq(products.status, PRODUCT_STATUS.ACTIVE),
      eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
      eq(stores.status, STORE_STATUS.ACTIVE),
      eq(sellers.status, SELLER_STATUS.ACTIVE),
      eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
      eq(categories.status, CATALOG_STATUS.ACTIVE),
      or(isNull(products.brandId), eq(brands.status, CATALOG_STATUS.ACTIVE)),
      afterProductId ? gt(products.id, afterProductId) : undefined,
    );

    const rows = await this.executor
      .select({ productId: products.id })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(visibility)
      .orderBy(asc(products.id))
      .limit(limit);

    return {
      productIds: rows.map((row) => row.productId),
      nextAfterProductId: rows.length === limit ? rows.at(-1)?.productId ?? null : null,
    };
  }
}

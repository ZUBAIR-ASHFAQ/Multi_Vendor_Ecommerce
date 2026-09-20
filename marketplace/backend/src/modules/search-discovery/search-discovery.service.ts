import type {
  ProductSearchDocumentRow,
  SearchReindexRunRow,
} from "../../database/schema/search-discovery.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import type { DomainEvent } from "../../common/outbox/outbox.contract.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { CatalogTaxonomyService } from "../catalog-taxonomy/catalog-taxonomy.service.js";
import type {
  AttributeResponse,
  BrandResponse,
  CategoryAttributeMappingResponse,
  CategoryTreeNodeResponse,
} from "../catalog-taxonomy/catalog-taxonomy.schema.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { ProductsService } from "../products/products.service.js";
import type { PublicProductCommerceDetailResponse } from "../products/products.schema.js";
import type { PublicStoreResponse } from "../sellers/sellers.schema.js";
import {
  SEARCH_AUDIT_ACTION,
  SEARCH_ERROR_CODE,
  SEARCH_LIMITS,
  SEARCH_OUTBOX_EVENT,
  SEARCH_PERMISSION,
  SEARCH_REINDEX_FAILURE_CODE,
  SEARCH_REINDEX_STATUS,
  SEARCH_RESOURCE_TYPE,
} from "./search-discovery.constants.js";
import { enqueueSearchReindexJob } from "./search-discovery.jobs.js";
import {
  SearchDiscoveryRepository,
  type SearchFilterableAttributes,
  type SearchProductRow,
  type SearchFacetRows,
  type SearchStoreRow,
  type UpsertProductSearchDocumentInput,
} from "./search-discovery.repository.js";
import type {
  SearchProductCardResponse,
  SearchProductsData,
  SearchProductsQuery,
  SearchReindexRunResponse,
  SearchStoresQuery,
  SearchSuggestionsQuery,
} from "./search-discovery.schema.js";

/** Runs one Search write transaction and allows focused service tests to replace the database boundary. */
export type SearchTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Public Product source boundary consumed by Search without importing Product persistence. */
export interface SearchProductIntegration {
  /** Returns a public Product aggregate only while it is currently eligible for storefront exposure. */
  findPublicProductById(productId: string): Promise<PublicProductCommerceDetailResponse | null>;

  /** Resolves one Inventory event variant back to its Product without exposing seller-private data. */
  findProductIdByVariantId(variantId: string): Promise<string | null>;
}

/** Public taxonomy source boundary consumed by Search without importing Catalog persistence. */
export interface SearchCatalogIntegration {
  /** Returns the active public category tree. */
  listCategories(context?: RequestContext | null): Promise<CategoryTreeNodeResponse[]>;

  /** Returns active public brands. */
  listBrands(context?: RequestContext | null): Promise<BrandResponse[]>;

  /** Returns active public attribute definitions and active option values. */
  listAttributes(context?: RequestContext | null): Promise<AttributeResponse[]>;

  /** Returns active category mappings used to select filterable Search attributes. */
  listCategoryAttributeMappings(
    context: RequestContext | null,
    categoryId: string,
  ): Promise<CategoryAttributeMappingResponse[]>;
}

/** Inventory boundary exposes only the availability bit Search is allowed to cache. */
export interface SearchInventoryIntegration {
  /** Returns true when at least one public Product variant has positive available quantity. */
  hasAvailableStockForVariants(variantIds: string[]): Promise<boolean>;
}

/** Optional Module 15 boundary; zero ratings are used until Reviews & Ratings exists. */
export interface SearchRatingIntegration {
  /** Returns the published aggregate that may safely appear in storefront Search. */
  getPublishedRatingAggregate(productId: string): Promise<{ average: number; count: number }>;
}

/** Queue boundary keeps BullMQ mechanics outside Search business decisions. */
export interface SearchReindexEnqueuer {
  /** Adds one retry-safe full reindex job keyed by the persisted run ID. */
  enqueue(reindexRunId: string): Promise<void>;
}

/** Explicit dependencies keep Search orchestration testable and preserve source-module service boundaries. */
export interface SearchDiscoveryServiceDependencies {
  repository?: SearchDiscoveryRepository;
  transactionRunner?: SearchTransactionRunner;
  products?: SearchProductIntegration;
  catalog?: SearchCatalogIntegration;
  inventory?: SearchInventoryIntegration;
  ratings?: SearchRatingIntegration | null;
  reindexEnqueuer?: SearchReindexEnqueuer;
  now?: () => Date;
}

/** Paginated Product Search result before the HTTP success envelope is applied. */
export interface PaginatedSearchProductsResult {
  data: SearchProductsData;
  meta: PaginationMeta;
}

/** Paginated public Store Search result before the HTTP success envelope is applied. */
export interface PaginatedSearchStoresResult {
  items: PublicStoreResponse[];
  meta: PaginationMeta;
}

/** Internal result used to make event retries observable without exposing source details over HTTP. */
export type SearchSourceEventResult = "ignored" | "synchronized" | "reindex_queued";

/** Creates one stable Module 19 error without exposing PostgreSQL/BullMQ implementation details. */
function searchError(code: string, message: string, statusCode: number, cause?: unknown): AppError {
  return new AppError({ code, message, statusCode, cause });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Converts exact non-negative decimal strings to comparable integer hundredths without floating-point money math. */
function decimalToHundredths(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

/** Compares two Product price strings using exact integer hundredths. */
function compareDecimalPrices(left: string, right: string): number {
  const leftValue = decimalToHundredths(left);
  const rightValue = decimalToHundredths(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

/** Normalizes a persisted NUMERIC string so equal values compare consistently across drivers. */
function normalizeDecimal(value: string): string {
  const [rawWhole = "0", rawFraction = ""] = value.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Returns a deterministic JSON string for the small attribute map stored in one Search document. */
function stableAttributesJson(attributes: SearchFilterableAttributes): string {
  const normalized = Object.fromEntries(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([attributeId, values]) => [attributeId, [...new Set(values)].sort()]),
  );
  return JSON.stringify(normalized);
}

/** Reads one non-blank string field from an unknown event payload. */
function payloadString(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value : null;
}

/** Default queue adapter opens a BullMQ producer only for the duration of one enqueue operation. */
const defaultReindexEnqueuer: SearchReindexEnqueuer = {
  /** Enqueues one Search reindex job using the module-owned BullMQ helper. */
  async enqueue(reindexRunId: string): Promise<void> {
    await enqueueSearchReindexJob(reindexRunId);
  },
};

/** Module 19 service for public Search, eventual document synchronization, and bounded reindex lifecycle. */
export class SearchDiscoveryService {
  private readonly repository: SearchDiscoveryRepository;
  private readonly transactionRunner: SearchTransactionRunner;
  private readonly products: SearchProductIntegration;
  private readonly catalog: SearchCatalogIntegration;
  private readonly inventory: SearchInventoryIntegration;
  private readonly ratings: SearchRatingIntegration | null;
  private readonly reindexEnqueuer: SearchReindexEnqueuer;
  private readonly now: () => Date;

  /** Stores explicit dependencies without a framework container or cross-module repository imports. */
  constructor(dependencies: SearchDiscoveryServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new SearchDiscoveryRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.products = dependencies.products ?? new ProductsService();
    this.catalog = dependencies.catalog ?? new CatalogTaxonomyService();
    this.inventory = dependencies.inventory ?? new InventoryService();
    this.ratings = dependencies.ratings ?? null;
    this.reindexEnqueuer = dependencies.reindexEnqueuer ?? defaultReindexEnqueuer;
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Searches Product cards/facets after bounded synonym expansion and hides Search infrastructure failures. */
  async searchProducts(query: SearchProductsQuery): Promise<PaginatedSearchProductsResult> {
    try {
      const repositoryQuery = await this.withExpandedProductQuery(query);
      const [result, facets] = await Promise.all([
        this.repository.searchProducts(repositoryQuery),
        this.repository.getProductFacets(repositoryQuery),
      ]);

      return {
        data: {
          items: result.items.map((row) => this.toProductCardResponse(row)),
          facets: this.toFacetResponse(facets),
        },
        meta: paginationMeta(query, result.totalItems),
      };
    } catch (error) {
      throw this.toSearchIndexUnavailable(error);
    }
  }

  /** Returns bounded autocomplete suggestions and uses active synonyms without duplicating names. */
  async searchSuggestions(query: SearchSuggestionsQuery): Promise<string[]> {
    try {
      const synonyms = await this.synonymTermsForQuery(query.q);
      const queries = [query.q, ...synonyms].slice(0, SEARCH_LIMITS.SUGGESTION_LIMIT_MAX);
      const batches = await Promise.all(
        queries.map((q) => this.repository.searchSuggestions({ ...query, q })),
      );
      const suggestions = [...new Set(batches.flat())];
      return suggestions.slice(0, query.limit);
    } catch (error) {
      throw this.toSearchIndexUnavailable(error);
    }
  }

  /** Searches only public-safe Store fields and applies the shared pagination contract. */
  async searchStores(query: SearchStoresQuery): Promise<PaginatedSearchStoresResult> {
    try {
      const result = await this.repository.searchStores(query);
      return {
        items: result.items.map((row) => this.toPublicStoreResponse(row)),
        meta: paginationMeta(query, result.totalItems),
      };
    } catch (error) {
      throw this.toSearchIndexUnavailable(error);
    }
  }

  /** Queues one privileged full-catalog reindex and rejects a duplicate active admin request. */
  async queueFullReindex(context: RequestContext): Promise<SearchReindexRunResponse> {
    const actorId = this.requireActorId(context);
    assertPermission(context, SEARCH_PERMISSION.ADMIN_MANAGE);

    try {
      if (await this.repository.findActiveReindexRun()) throw this.searchReindexRunning();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.searchIndexUnavailable(error);
    }

    let run: SearchReindexRunRow;
    try {
      run = await this.transactionRunner(async (tx) => {
        const repository = new SearchDiscoveryRepository(tx);
        const created = await repository.createReindexRun(this.now());
        await AuditService.using(tx).record({
          actorId,
          actorType: context.actorType,
          action: SEARCH_AUDIT_ACTION.REINDEX_QUEUED,
          entityType: SEARCH_RESOURCE_TYPE.REINDEX_RUN,
          entityId: created.id,
          requestId: context.requestId,
          after: this.toReindexRunResponse(created),
        });
        return created;
      });
    } catch (error) {
      if (databaseErrorCode(error) === "23505") throw this.searchReindexRunning();
      if (error instanceof AppError) throw error;
      throw this.searchIndexUnavailable(error);
    }

    try {
      await this.reindexEnqueuer.enqueue(run.id);
      return this.toReindexRunResponse(run);
    } catch (error) {
      try {
        await this.recordQueuedReindexFailure(
          run.id,
          SEARCH_REINDEX_FAILURE_CODE.QUEUE_UNAVAILABLE,
        );
      } catch (recordError) {
        throw this.searchIndexUnavailable(recordError);
      }
      throw this.searchIndexUnavailable(error);
    }
  }

  /** Reads one privileged reindex status without exposing unrelated Search internals. */
  async getReindexStatus(
    context: RequestContext,
    reindexRunId: string,
  ): Promise<SearchReindexRunResponse> {
    this.requireActorId(context);
    assertPermission(context, SEARCH_PERMISSION.ADMIN_MANAGE);
    try {
      const run = await this.repository.findReindexRunById(reindexRunId);
      if (!run) {
        throw searchError(ERROR_CODE.RESOURCE_NOT_FOUND, "Search reindex run was not found.", 404);
      }
      return this.toReindexRunResponse(run);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.searchIndexUnavailable(error);
    }
  }

  /** Re-enqueues one durable queued run after process restart without creating another reindex record. */
  async recoverQueuedReindexJob(): Promise<boolean> {
    const active = await this.repository.findActiveReindexRun();
    if (!active || active.status !== SEARCH_REINDEX_STATUS.QUEUED) return false;
    await this.reindexEnqueuer.enqueue(active.id);
    return true;
  }

  /** Synchronizes one Product document idempotently from public Product/Catalog/Inventory source services. */
  async synchronizeProductDocument(productId: string): Promise<boolean> {
    return this.synchronizeProductDocumentInternal(productId, true);
  }

  /** Routes one committed source event into a Product sync or bounded full reindex request. */
  async handleSourceEvent(event: DomainEvent): Promise<SearchSourceEventResult> {
    if (event.eventType.startsWith("search.")) return "ignored";

    if (this.isProductSourceEvent(event.eventType)) {
      const productId = payloadString(event.payload, "productId") ?? event.aggregateId ?? null;
      if (!productId) return "ignored";
      await this.synchronizeProductDocument(productId);
      return "synchronized";
    }

    if (this.isInventorySourceEvent(event.eventType)) {
      const variantId = payloadString(event.payload, "variantId");
      if (!variantId) return "ignored";
      const productId = await this.products.findProductIdByVariantId(variantId);
      if (!productId) return "ignored";
      await this.synchronizeProductDocument(productId);
      return "synchronized";
    }

    if (this.isCatalogSourceEvent(event.eventType)) {
      await this.queueSystemReindex();
      return "reindex_queued";
    }

    if (event.eventType.startsWith("review.") || event.eventType.startsWith("rating.")) {
      const productId = payloadString(event.payload, "productId");
      if (!productId) return "ignored";
      await this.synchronizeProductDocument(productId);
      return "synchronized";
    }

    return "ignored";
  }

  /** Runs or resumes one persisted full reindex in stable Product-ID batches; BullMQ retries remain idempotent. */
  async runFullReindex(reindexRunId: string): Promise<SearchReindexRunResponse> {
    let run = await this.repository.findReindexRunById(reindexRunId);
    if (!run) {
      throw searchError(ERROR_CODE.RESOURCE_NOT_FOUND, "Search reindex run was not found.", 404);
    }
    if (run.status === SEARCH_REINDEX_STATUS.COMPLETED || run.status === SEARCH_REINDEX_STATUS.FAILED) {
      return this.toReindexRunResponse(run);
    }

    if (run.status === SEARCH_REINDEX_STATUS.QUEUED) {
      run = await this.markReindexStarted(reindexRunId);
    }

    let afterProductId: string | undefined;
    do {
      const page = await this.repository.listPublishedProductIdsForReindex(
        SEARCH_LIMITS.REINDEX_BATCH_SIZE,
        afterProductId,
      );
      for (const productId of page.productIds) {
        await this.synchronizeProductDocumentInternal(productId, false);
      }
      afterProductId = page.nextAfterProductId ?? undefined;
    } while (afterProductId);

    await this.repository.deleteNonPublicProductSearchDocuments();
    return this.markReindexCompleted(reindexRunId);
  }

  /** Records the final BullMQ processing failure after all configured job attempts are exhausted. */
  async failReindexRun(
    reindexRunId: string,
    errorCode = SEARCH_REINDEX_FAILURE_CODE.PROCESSING_FAILED,
  ): Promise<void> {
    const finishedAt = this.now();
    await this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const failed = await repository.markReindexRunFailed(reindexRunId, errorCode, finishedAt);
      if (!failed) return;
      await OutboxService.using(tx).enqueue({
        eventType: SEARCH_OUTBOX_EVENT.REINDEX_FAILED,
        aggregateType: SEARCH_RESOURCE_TYPE.REINDEX_RUN,
        aggregateId: reindexRunId,
        payload: { reindexRunId, errorCode, finishedAt: finishedAt.toISOString() },
      });
    });
  }

  /** Expands active whole-word synonyms into a bounded PostgreSQL websearch OR expression. */
  private async withExpandedProductQuery(query: SearchProductsQuery): Promise<SearchProductsQuery> {
    if (!query.q) return query;
    const synonyms = await this.synonymTermsForQuery(query.q);
    if (synonyms.length === 0) return query;

    const expanded = [query.q, ...synonyms]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" OR ")
      .slice(0, SEARCH_LIMITS.EXPANDED_QUERY_MAX_LENGTH);
    return { ...query, q: expanded };
  }

  /** Reads active synonyms for normalized word tokens and returns deterministic unique synonym strings. */
  private async synonymTermsForQuery(queryText: string): Promise<string[]> {
    const terms = queryText.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const rows = await this.repository.listActiveSynonymsByTerms(terms);
    const synonyms = rows.flatMap((row) =>
      Array.isArray(row.synonyms)
        ? row.synonyms.filter((value): value is string => typeof value === "string")
        : [],
    );
    return [...new Set(synonyms.map((value) => value.trim()).filter(Boolean))].sort();
  }

  /** Builds or removes one derived Product document and emits document_updated only when persisted state changes. */
  private async synchronizeProductDocumentInternal(
    productId: string,
    emitEvent: boolean,
  ): Promise<boolean> {
    const product = await this.products.findPublicProductById(productId);
    if (!product) return this.removeProductDocument(productId, emitEvent);

    const taxonomy = await this.buildTaxonomySnapshot(product);
    if (!taxonomy) return this.removeProductDocument(productId, emitEvent);

    const variantIds = product.variants.map((variant) => variant.id);
    const [inStock, rating] = await Promise.all([
      this.inventory.hasAvailableStockForVariants(variantIds),
      this.getRatingAggregate(productId),
    ]);
    const prices = product.variants.map((variant) => variant.price).sort(compareDecimalPrices);
    if (prices.length === 0) return this.removeProductDocument(productId, emitEvent);

    const input: UpsertProductSearchDocumentInput = {
      productId,
      searchableText: this.buildSearchableText(product, taxonomy.searchTerms),
      categoryId: product.categoryId,
      categoryPath: taxonomy.categoryPath,
      brandId: product.brandId,
      brand: taxonomy.brandName,
      minPrice: prices[0]!,
      maxPrice: prices.at(-1)!,
      ratingAvg: rating.average.toFixed(2),
      ratingCount: rating.count,
      inStock,
      filterableAttributes: taxonomy.filterableAttributes,
      updatedAt: this.now(),
    };

    return this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const existing = await repository.findProductSearchDocument(productId);
      if (existing && this.searchDocumentMatches(existing, input)) return false;

      const updated = await repository.upsertProductSearchDocument(input);
      if (emitEvent) {
        await OutboxService.using(tx).enqueue({
          eventType: SEARCH_OUTBOX_EVENT.DOCUMENT_UPDATED,
          aggregateType: SEARCH_RESOURCE_TYPE.PRODUCT_DOCUMENT,
          aggregateId: productId,
          payload: {
            productId,
            action: existing ? "updated" : "created",
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      }
      return true;
    });
  }

  /** Removes a stale Search document transactionally and emits one retry-safe derived-state event when requested. */
  private async removeProductDocument(productId: string, emitEvent: boolean): Promise<boolean> {
    return this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const removed = await repository.deleteProductSearchDocument(productId);
      if (removed && emitEvent) {
        await OutboxService.using(tx).enqueue({
          eventType: SEARCH_OUTBOX_EVENT.DOCUMENT_UPDATED,
          aggregateType: SEARCH_RESOURCE_TYPE.PRODUCT_DOCUMENT,
          aggregateId: productId,
          payload: { productId, action: "removed", updatedAt: this.now().toISOString() },
        });
      }
      return removed;
    });
  }

  /** Resolves active taxonomy labels/path and only category-mapped filterable Product attributes. */
  private async buildTaxonomySnapshot(product: PublicProductCommerceDetailResponse): Promise<{
    categoryPath: string;
    brandName: string | null;
    filterableAttributes: SearchFilterableAttributes;
    searchTerms: string[];
  } | null> {
    const [categories, brands] = await Promise.all([
      this.catalog.listCategories(null),
      this.catalog.listBrands(null),
    ]);
    const categoryNames = this.findCategoryPath(categories, product.categoryId);
    if (!categoryNames) return null;

    const brandName = product.brandId
      ? brands.find((brand) => brand.id === product.brandId)?.name ?? null
      : null;
    if (product.brandId && !brandName) return null;

    const [mappings, attributes] = await Promise.all([
      this.catalog.listCategoryAttributeMappings(null, product.categoryId),
      this.catalog.listAttributes(null),
    ]);
    const filterableIds = new Set(
      mappings.filter((mapping) => mapping.isFilterable).map((mapping) => mapping.attributeId),
    );
    const attributesById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
    const filterableAttributes: SearchFilterableAttributes = {};
    const searchTerms: string[] = [...categoryNames, ...(brandName ? [brandName] : [])];

    for (const value of product.attributes) {
      if (!filterableIds.has(value.attributeId)) continue;
      const attribute = attributesById.get(value.attributeId);
      if (!attribute) continue;
      const displayValue = this.attributeDisplayValue(attribute, value);
      if (!displayValue) continue;

      const values = filterableAttributes[value.attributeId] ?? [];
      if (!values.includes(displayValue)) values.push(displayValue);
      filterableAttributes[value.attributeId] = values;
      searchTerms.push(attribute.name, displayValue);
    }

    for (const values of Object.values(filterableAttributes)) values.sort();
    return {
      categoryPath: categoryNames.join(" > "),
      brandName,
      filterableAttributes,
      searchTerms,
    };
  }

  /** Finds one active category and returns its root-to-leaf display-name path. */
  private findCategoryPath(
    nodes: CategoryTreeNodeResponse[],
    categoryId: string,
    parentNames: string[] = [],
  ): string[] | null {
    for (const node of nodes) {
      const path = [...parentNames, node.name];
      if (node.id === categoryId) return path;
      const childPath = this.findCategoryPath(node.children, categoryId, path);
      if (childPath) return childPath;
    }
    return null;
  }

  /** Converts one Product attribute value into the public text used for filter facets and Search terms. */
  private attributeDisplayValue(
    attribute: AttributeResponse,
    value: PublicProductCommerceDetailResponse["attributes"][number],
  ): string | null {
    if (value.valueId) {
      return attribute.values.find((option) => option.id === value.valueId)?.value ?? null;
    }
    if (value.valueText?.trim()) return value.valueText.trim();
    if (value.valueNumber !== null) return value.valueNumber;
    return null;
  }

  /** Builds deterministic whitespace-normalized text from fields already approved for public Product exposure. */
  private buildSearchableText(product: PublicProductCommerceDetailResponse, taxonomyTerms: string[]): string {
    const variantTerms = product.variants.flatMap((variant) => [variant.title, variant.sku]);
    return [product.name, product.slug, product.description, ...variantTerms, ...taxonomyTerms]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ");
  }

  /** Returns a validated rating aggregate or the documented zero default before Module 15 integration exists. */
  private async getRatingAggregate(productId: string): Promise<{ average: number; count: number }> {
    if (!this.ratings) return { average: 0, count: 0 };
    const aggregate = await this.ratings.getPublishedRatingAggregate(productId);
    const average = Number.isFinite(aggregate.average) && aggregate.average >= 0 && aggregate.average <= 5
      ? aggregate.average
      : 0;
    const count = Number.isInteger(aggregate.count) && aggregate.count >= 0 ? aggregate.count : 0;
    return { average, count };
  }

  /** Compares all derived business fields while deliberately ignoring the Search document update timestamp. */
  private searchDocumentMatches(
    existing: ProductSearchDocumentRow,
    input: UpsertProductSearchDocumentInput,
  ): boolean {
    return (
      existing.searchableText === input.searchableText &&
      existing.categoryId === input.categoryId &&
      existing.categoryPath === input.categoryPath &&
      existing.brandId === input.brandId &&
      existing.brand === input.brand &&
      normalizeDecimal(existing.minPrice) === normalizeDecimal(input.minPrice) &&
      normalizeDecimal(existing.maxPrice) === normalizeDecimal(input.maxPrice) &&
      normalizeDecimal(existing.ratingAvg) === normalizeDecimal(input.ratingAvg) &&
      existing.ratingCount === input.ratingCount &&
      existing.inStock === input.inStock &&
      stableAttributesJson(existing.filterableAttributes as SearchFilterableAttributes) ===
        stableAttributesJson(input.filterableAttributes)
    );
  }

  /** Creates a system-triggered reindex or reuses the active one so repeated taxonomy events stay idempotent. */
  private async queueSystemReindex(): Promise<SearchReindexRunResponse> {
    const active = await this.repository.findActiveReindexRun();
    if (active) {
      if (active.status === SEARCH_REINDEX_STATUS.QUEUED) {
        await this.reindexEnqueuer.enqueue(active.id);
      }
      return this.toReindexRunResponse(active);
    }

    let run: SearchReindexRunRow;
    try {
      run = await this.repository.createReindexRun(this.now());
    } catch (error) {
      if (databaseErrorCode(error) !== "23505") throw error;
      const raced = await this.repository.findActiveReindexRun();
      if (!raced) throw error;
      if (raced.status === SEARCH_REINDEX_STATUS.QUEUED) {
        await this.reindexEnqueuer.enqueue(raced.id);
      }
      return this.toReindexRunResponse(raced);
    }

    try {
      await this.reindexEnqueuer.enqueue(run.id);
      return this.toReindexRunResponse(run);
    } catch (error) {
      await this.recordQueuedReindexFailure(run.id, SEARCH_REINDEX_FAILURE_CODE.QUEUE_UNAVAILABLE);
      throw error;
    }
  }

  /** Persists a pre-processing queue failure and emits the required Search reindex_failed event. */
  private async recordQueuedReindexFailure(reindexRunId: string, errorCode: string): Promise<void> {
    const failedAt = this.now();
    await this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const failed = await repository.markQueuedReindexRunFailed(reindexRunId, errorCode, failedAt);
      if (!failed) return;
      await OutboxService.using(tx).enqueue({
        eventType: SEARCH_OUTBOX_EVENT.REINDEX_FAILED,
        aggregateType: SEARCH_RESOURCE_TYPE.REINDEX_RUN,
        aggregateId: reindexRunId,
        payload: { reindexRunId, errorCode, finishedAt: failedAt.toISOString() },
      });
    });
  }

  /** Transitions one queued reindex to running and emits search.reindex_started in the same transaction. */
  private async markReindexStarted(reindexRunId: string): Promise<SearchReindexRunRow> {
    const startedAt = this.now();
    return this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const running = await repository.markReindexRunRunning(reindexRunId, startedAt);
      if (!running) {
        const existing = await repository.findReindexRunById(reindexRunId);
        if (existing?.status === SEARCH_REINDEX_STATUS.RUNNING) return existing;
        throw searchError(ERROR_CODE.CONFLICT, "Search reindex cannot start from its current state.", 409);
      }
      await OutboxService.using(tx).enqueue({
        eventType: SEARCH_OUTBOX_EVENT.REINDEX_STARTED,
        aggregateType: SEARCH_RESOURCE_TYPE.REINDEX_RUN,
        aggregateId: reindexRunId,
        payload: { reindexRunId, startedAt: startedAt.toISOString() },
      });
      return running;
    });
  }

  /** Transitions one running reindex to completed and emits search.reindex_completed atomically. */
  private async markReindexCompleted(reindexRunId: string): Promise<SearchReindexRunResponse> {
    const finishedAt = this.now();
    const completed = await this.transactionRunner(async (tx) => {
      const repository = new SearchDiscoveryRepository(tx);
      const row = await repository.markReindexRunCompleted(reindexRunId, finishedAt);
      if (!row) {
        const existing = await repository.findReindexRunById(reindexRunId);
        if (existing?.status === SEARCH_REINDEX_STATUS.COMPLETED) return existing;
        throw searchError(ERROR_CODE.CONFLICT, "Search reindex cannot complete from its current state.", 409);
      }
      await OutboxService.using(tx).enqueue({
        eventType: SEARCH_OUTBOX_EVENT.REINDEX_COMPLETED,
        aggregateType: SEARCH_RESOURCE_TYPE.REINDEX_RUN,
        aggregateId: reindexRunId,
        payload: { reindexRunId, finishedAt: finishedAt.toISOString() },
      });
      return row;
    });
    return this.toReindexRunResponse(completed);
  }

  /** Returns true for Product events that can change one derived Product document. */
  private isProductSourceEvent(eventType: string): boolean {
    return new Set([
      "product.created",
      "product.updated",
      "product.price_changed",
      "product.published",
      "product.unpublished",
      "product.media_changed",
    ]).has(eventType);
  }

  /** Returns true for Inventory events that can change one Product's cached in-stock flag. */
  private isInventorySourceEvent(eventType: string): boolean {
    return new Set([
      "inventory.adjusted",
      "inventory.reserved",
      "inventory.reservation_released",
      "inventory.shipped",
    ]).has(eventType);
  }

  /** Returns true for taxonomy events whose fan-out is safely handled by one deduplicated full reindex. */
  private isCatalogSourceEvent(eventType: string): boolean {
    return new Set([
      "category.created",
      "category.updated",
      "brand.updated",
      "attribute.updated",
      "category.attributes_changed",
    ]).has(eventType);
  }

  /** Maps one repository Product row to the strict public Product-card contract. */
  private toProductCardResponse(row: SearchProductRow): SearchProductCardResponse {
    return {
      productId: row.productId,
      storeId: row.storeId,
      slug: row.slug,
      name: row.name,
      categoryId: row.categoryId,
      categoryPath: row.categoryPath,
      brandId: row.brandId,
      brand: row.brand,
      minPrice: row.minPrice,
      maxPrice: row.maxPrice,
      currency: row.currency,
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      inStock: row.inStock,
      thumbnailFileId: row.thumbnailFileId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Groups flattened attribute rows into the nested public facet response and keeps facet ordering deterministic. */
  private toFacetResponse(rows: SearchFacetRows): SearchProductsData["facets"] {
    const attributesById = new Map<
      string,
      SearchProductsData["facets"]["attributes"][number]
    >();
    for (const row of rows.attributes) {
      const existing = attributesById.get(row.attributeId) ?? {
        attributeId: row.attributeId,
        label: row.attributeLabel,
        values: [],
      };
      existing.values.push({ value: row.value, label: row.value, count: row.count });
      attributesById.set(row.attributeId, existing);
    }

    return {
      categories: rows.categories,
      brands: rows.brands,
      attributes: [...attributesById.values()],
      price:
        rows.summary.minPrice !== null && rows.summary.maxPrice !== null
          ? { min: rows.summary.minPrice, max: rows.summary.maxPrice }
          : null,
      availability: {
        inStock: rows.summary.inStockCount,
        outOfStock: rows.summary.outOfStockCount,
      },
    };
  }

  /** Maps the repository Store projection to the existing Module 4 public-safe Store response. */
  private toPublicStoreResponse(row: SearchStoreRow): PublicStoreResponse {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      logoFileId: row.logoFileId,
      defaultCurrency: row.defaultCurrency,
      supportEmail: row.supportEmail,
      seller: { id: row.sellerId, displayName: row.sellerDisplayName },
    };
  }

  /** Maps persisted reindex timestamps and error_code into the source-defined admin response terminology. */
  private toReindexRunResponse(run: SearchReindexRunRow): SearchReindexRunResponse {
    return {
      id: run.id,
      scope: "full_catalog",
      status: run.status as SearchReindexRunResponse["status"],
      requestedAt: run.requestedAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.completedAt?.toISOString() ?? null,
      errorCode: run.errorCode,
    };
  }

  /** Requires a real authenticated actor before a privileged Search administration command/read. */
  private requireActorId(context: RequestContext): string {
    if (!context.actorId) {
      throw searchError(ERROR_CODE.UNAUTHENTICATED, "Authentication is required.", 401);
    }
    return context.actorId;
  }

  /** Preserves business errors and maps unknown Search read failures to the required stable availability error. */
  private toSearchIndexUnavailable(error: unknown): AppError {
    return error instanceof AppError ? error : this.searchIndexUnavailable(error);
  }

  /** Creates the stable public Search read-model unavailable error. */
  private searchIndexUnavailable(cause?: unknown): AppError {
    return searchError(
      SEARCH_ERROR_CODE.SEARCH_INDEX_UNAVAILABLE,
      "Search is temporarily unavailable.",
      503,
      cause,
    );
  }

  /** Creates the stable duplicate-active-reindex error required by Module 19. */
  private searchReindexRunning(): AppError {
    return searchError(
      SEARCH_ERROR_CODE.SEARCH_REINDEX_RUNNING,
      "A full Search reindex is already running.",
      409,
    );
  }

  /** Creates the stable error returned when Search query validation fails. */
  searchQueryInvalid(): AppError {
    return searchError(
      SEARCH_ERROR_CODE.SEARCH_QUERY_INVALID,
      "The Search query or filters are invalid.",
      400,
    );
  }
}

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import {
  SEARCH_ERROR_CODE,
  SEARCH_PERMISSION,
  SEARCH_REINDEX_STATUS,
} from "../../src/modules/search-discovery/search-discovery.constants.js";
import { SearchDiscoveryRepository } from "../../src/modules/search-discovery/search-discovery.repository.js";
import { SearchDiscoveryService } from "../../src/modules/search-discovery/search-discovery.service.js";

/** Builds one request context with only the explicit permissions needed by a service test. */
function context(permissions: readonly PermissionCode[] = []): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: randomUUID(),
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates the small repository surface used by read/event service tests. */
function repositoryStub(
  overrides: Partial<Record<keyof SearchDiscoveryRepository, unknown>> = {},
): SearchDiscoveryRepository {
  return {
    listActiveSynonymsByTerms: vi.fn().mockResolvedValue([]),
    searchProducts: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    getProductFacets: vi.fn().mockResolvedValue({
      categories: [],
      brands: [],
      attributes: [],
      summary: { minPrice: null, maxPrice: null, inStockCount: 0, outOfStockCount: 0 },
    }),
    searchSuggestions: vi.fn().mockResolvedValue([]),
    searchStores: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    findActiveReindexRun: vi.fn().mockResolvedValue(null),
    findReindexRunById: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SearchDiscoveryRepository;
}

/** Creates a persistence-shaped queued reindex row for retry/deduplication tests. */
function queuedRun() {
  const now = new Date("2026-09-07T10:00:00.000Z");
  return {
    id: randomUUID(),
    scope: "full_catalog",
    status: SEARCH_REINDEX_STATUS.QUEUED,
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    updatedAt: now,
  };
}

describe("Module 19 service boundaries and retry-safe read behavior", () => {
  it("expands active synonyms before Product Search and still returns only public-card fields", async () => {
    const productId = randomUUID();
    const storeId = randomUUID();
    const categoryId = randomUUID();
    const repository = repositoryStub({
      listActiveSynonymsByTerms: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          term: "sneakers",
          synonyms: ["shoes", "trainers"],
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      searchProducts: vi.fn().mockResolvedValue({
        items: [
          {
            productId,
            storeId,
            slug: "running-shoe",
            name: "Running Shoe",
            categoryId,
            categoryPath: "Shoes > Running",
            brandId: null,
            brand: null,
            minPrice: "99.00",
            maxPrice: "129.00",
            minCompareAtPrice: "119.00",
            maxCompareAtPrice: "149.00",
            currency: "PKR",
            ratingAvg: "4.50",
            ratingCount: 12,
            inStock: true,
            thumbnailFileId: null,
            updatedAt: new Date("2026-09-07T10:00:00.000Z"),
          },
        ],
        totalItems: 1,
      }),
    });
    const service = new SearchDiscoveryService({ repository });

    const result = await service.searchProducts({
      q: "sneakers",
      page: 1,
      pageSize: 20,
      sort: "relevance",
    });

    expect(repository.searchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ q: "sneakers OR shoes OR trainers" }),
    );
    expect(result.data.items[0]).toMatchObject({
      productId,
      storeId,
      inStock: true,
      minCompareAtPrice: "119.00",
      maxCompareAtPrice: "149.00",
    });
    expect(result.data.items[0]).not.toHaveProperty("sellerId");
    expect(result.data.items[0]).not.toHaveProperty("publicationStatus");
  });

  it("deduplicates synonym-backed autocomplete and preserves the caller limit", async () => {
    const repository = repositoryStub({
      listActiveSynonymsByTerms: vi.fn().mockResolvedValue([
        {
          id: randomUUID(),
          term: "tv",
          synonyms: ["television"],
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      searchSuggestions: vi
        .fn()
        .mockResolvedValueOnce(["Smart TV", "OLED TV"])
        .mockResolvedValueOnce(["Smart TV", "Television Stand"]),
    });
    const service = new SearchDiscoveryService({ repository });

    await expect(service.searchSuggestions({ q: "tv", limit: 3 })).resolves.toEqual([
      "Smart TV",
      "OLED TV",
      "Television Stand",
    ]);
  });

  it("maps unexpected read-model failures to SEARCH_INDEX_UNAVAILABLE", async () => {
    const repository = repositoryStub({
      searchStores: vi.fn().mockRejectedValue(new Error("database detail that must stay private")),
    });
    const service = new SearchDiscoveryService({ repository });

    await expect(
      service.searchStores({ q: "shop", page: 1, pageSize: 20, sort: "relevance" }),
    ).rejects.toMatchObject({
      code: SEARCH_ERROR_CODE.SEARCH_INDEX_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it("routes Product and Inventory source events to one idempotent Product synchronization", async () => {
    const productId = randomUUID();
    const variantId = randomUUID();
    const products = {
      findPublicProductById: vi.fn(),
      findProductIdByVariantId: vi.fn().mockResolvedValue(productId),
    };
    const service = new SearchDiscoveryService({ repository: repositoryStub(), products });
    const synchronize = vi.spyOn(service, "synchronizeProductDocument").mockResolvedValue(false);

    await expect(
      service.handleSourceEvent({
        eventType: "product.price_changed",
        aggregateId: productId,
        payload: { productId },
      }),
    ).resolves.toBe("synchronized");
    await expect(
      service.handleSourceEvent({
        eventType: "inventory.adjusted",
        aggregateId: randomUUID(),
        payload: { variantId },
      }),
    ).resolves.toBe("synchronized");

    expect(synchronize).toHaveBeenNthCalledWith(1, productId);
    expect(products.findProductIdByVariantId).toHaveBeenCalledWith(variantId);
    expect(synchronize).toHaveBeenNthCalledWith(2, productId);
  });

  it("reuses one queued reindex for repeated taxonomy events instead of creating duplicate work", async () => {
    const run = queuedRun();
    const repository = repositoryStub({ findActiveReindexRun: vi.fn().mockResolvedValue(run) });
    const reindexEnqueuer = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const service = new SearchDiscoveryService({ repository, reindexEnqueuer });

    await expect(
      service.handleSourceEvent({
        eventType: "category.updated",
        aggregateId: randomUUID(),
        payload: {},
      }),
    ).resolves.toBe("reindex_queued");
    expect(reindexEnqueuer.enqueue).toHaveBeenCalledTimes(1);
    expect(reindexEnqueuer.enqueue).toHaveBeenCalledWith(run.id);
  });

  it("rejects privileged reindex commands without admin.search.manage before opening persistence", async () => {
    const repository = repositoryStub();
    const service = new SearchDiscoveryService({ repository });

    await expect(service.queueFullReindex(context([]))).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findActiveReindexRun).not.toHaveBeenCalled();

    const invalidQueryError = service.searchQueryInvalid();
    expect(invalidQueryError).toMatchObject({
      code: SEARCH_ERROR_CODE.SEARCH_QUERY_INVALID,
      statusCode: 400,
    });
    expect(SEARCH_PERMISSION.ADMIN_MANAGE).toBe("admin.search.manage");
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SEARCH_ERROR_CODE,
  SEARCH_LIMITS,
  SEARCH_PERMISSION,
  SEARCH_PRODUCT_SORT_VALUES,
} from "../../src/modules/search-discovery/search-discovery.constants.js";
import { searchDiscoveryOpenApiPaths } from "../../src/modules/search-discovery/search-discovery.routes.js";
import {
  queueSearchReindexBodySchema,
  searchProductsQuerySchema,
  searchSuggestionsQuerySchema,
} from "../../src/modules/search-discovery/search-discovery.schema.js";

/** Reads one OpenAPI operation object from the exact Module 19 path registry. */
function operation(path: string, method: string): Record<string, unknown> {
  const pathItem = searchDiscoveryOpenApiPaths[
    path as keyof typeof searchDiscoveryOpenApiPaths
  ] as unknown as Record<string, Record<string, unknown>>;
  return pathItem[method] ?? {};
}

describe("Module 19 Zod and OpenAPI contracts", () => {
  it("accepts only allow-listed Product filters/sorts with bounded shared pagination", () => {
    const attributeId = randomUUID();
    const parsed = searchProductsQuerySchema.parse({
      q: "  headphones  ",
      page: "2",
      pageSize: "10",
      attribute: `${attributeId}=Black`,
      minPrice: "10.00",
      maxPrice: "99.99",
      minRating: "4",
      inStock: "true",
      sort: "price_asc",
    });

    expect(parsed).toMatchObject({
      q: "headphones",
      page: 2,
      pageSize: 10,
      attribute: [`${attributeId}=Black`],
      inStock: true,
      sort: "price_asc",
    });
    expect(SEARCH_PRODUCT_SORT_VALUES).not.toContain("raw_sql" as never);
    expect(() => searchProductsQuerySchema.parse({ sort: "raw_sql" })).toThrow();
    expect(() => searchProductsQuerySchema.parse({ pageSize: "100000" })).toThrow();
    expect(() => searchProductsQuerySchema.parse({ unknownFilter: "x" })).toThrow();
  });

  it("rejects inverted exact-decimal price ranges and malformed attribute filters", () => {
    expect(() =>
      searchProductsQuerySchema.parse({ minPrice: "100.01", maxPrice: "100.00" }),
    ).toThrow(/minimum price/i);
    expect(() =>
      searchProductsQuerySchema.parse({ attribute: "not-a-uuid=Black" }),
    ).toThrow(/UUID/i);
  });

  it("bounds autocomplete and keeps reindex caller input empty/server-controlled", () => {
    expect(searchSuggestionsQuerySchema.parse({ q: "lap", limit: "5" })).toEqual({
      q: "lap",
      limit: 5,
    });
    expect(() => searchSuggestionsQuerySchema.parse({ q: "x" })).toThrow();
    expect(() =>
      searchSuggestionsQuerySchema.parse({
        q: "x".repeat(SEARCH_LIMITS.SUGGESTION_QUERY_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(queueSearchReindexBodySchema.parse({})).toEqual({});
    expect(() => queueSearchReindexBodySchema.parse({ batchSize: 5000 })).toThrow();
  });

  it("publishes exactly the five required Search routes with admin bearer security", () => {
    const expected: Record<string, string[]> = {
      "/api/v1/search/products": ["get"],
      "/api/v1/search/suggestions": ["get"],
      "/api/v1/search/stores": ["get"],
      "/api/v1/admin/search/reindex": ["post"],
      "/api/v1/admin/search/reindex/{id}": ["get"],
    };

    expect(Object.keys(searchDiscoveryOpenApiPaths).sort()).toEqual(Object.keys(expected).sort());
    for (const [path, methods] of Object.entries(expected)) {
      const pathItem = searchDiscoveryOpenApiPaths[
        path as keyof typeof searchDiscoveryOpenApiPaths
      ] as unknown as Record<string, unknown>;
      expect(Object.keys(pathItem).sort()).toEqual(methods.sort());
    }

    const reindex = operation("/api/v1/admin/search/reindex", "post") as {
      security?: Array<Record<string, unknown>>;
      responses?: Record<string, unknown>;
    };
    expect(reindex.security).toEqual([{ bearerAuth: [] }]);
    expect(reindex.responses?.["202"]).toBeTruthy();
    expect(reindex.responses?.["409"]).toBeTruthy();
    expect(reindex.responses?.["429"]).toBeTruthy();
  });

  it("keeps the required permission and stable error vocabulary fixed", () => {
    expect(SEARCH_PERMISSION).toEqual({
      PUBLIC: "search.public",
      ADMIN_MANAGE: "admin.search.manage",
    });
    expect(SEARCH_ERROR_CODE).toEqual({
      SEARCH_QUERY_INVALID: "SEARCH_QUERY_INVALID",
      SEARCH_INDEX_UNAVAILABLE: "SEARCH_INDEX_UNAVAILABLE",
      SEARCH_REINDEX_RUNNING: "SEARCH_REINDEX_RUNNING",
    });
  });
});

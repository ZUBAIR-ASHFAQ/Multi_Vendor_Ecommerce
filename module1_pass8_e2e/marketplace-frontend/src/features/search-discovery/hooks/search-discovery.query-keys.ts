import type {
  SearchProductsRouteSearch,
  SearchStoresRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Stable TanStack Query keys for all Module 19 public Search server state. */
export const searchDiscoveryQueryKeys = {
  all: ["search-discovery"] as const,
  products: (query: SearchProductsRouteSearch) => ["search-discovery", "products", query] as const,
  suggestions: (q: string, limit: number) => ["search-discovery", "suggestions", q, limit] as const,
  stores: (query: SearchStoresRouteSearch) => ["search-discovery", "stores", query] as const,
};

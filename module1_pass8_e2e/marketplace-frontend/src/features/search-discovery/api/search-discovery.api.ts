import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import type {
  SearchProductsData,
  SearchProductsRouteSearch,
  SearchStore,
  SearchStoresRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Serializes only meaningful Search values and repeats attribute keys exactly as the backend expects. */
function searchParams(value: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "" || (Array.isArray(entry) && entry.length === 0)) {
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) params.append(key, String(item));
      continue;
    }
    params.set(key, String(entry));
  }
  return params;
}

/** Unwraps one Search response that also requires standard pagination metadata. */
async function paginatedData<T>(
  request: Promise<{ data: ApiResponse<T, PaginationMeta> }>,
): Promise<{ data: T; meta: PaginationMeta }> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Search pagination metadata is missing.");
  return { data: response.data.data, meta: response.data.meta };
}

/** Unwraps one successful non-paginated Search response. */
async function one<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export const searchDiscoveryApi = {
  /** Searches the derived public Product read model with only allow-listed URL state. */
  searchProducts: (query: SearchProductsRouteSearch) =>
    paginatedData<SearchProductsData>(
      apiClient.get("/search/products", { params: searchParams(query) }),
    ),

  /** Loads bounded autocomplete text for a public Search query. */
  searchSuggestions: (q: string, limit = 8) =>
    one<string[]>(apiClient.get("/search/suggestions", { params: searchParams({ q, limit }) })),

  /** Searches the public Store projection while preserving pagination metadata. */
  searchStores: (query: SearchStoresRouteSearch) =>
    paginatedData<SearchStore[]>(
      apiClient.get("/search/stores", { params: searchParams(query) }),
    ),
};

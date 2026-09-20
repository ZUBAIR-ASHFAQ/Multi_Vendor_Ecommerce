import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchDiscoveryApi } from "../api/search-discovery.api";
import type {
  SearchProductsRouteSearch,
  SearchStoresRouteSearch,
} from "../schemas/search-discovery.schemas";
import { searchDiscoveryQueryKeys } from "./search-discovery.query-keys";

/** Delays autocomplete reads briefly so ordinary typing does not create one request per keypress. */
export function useDebouncedSearchText(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debounced;
}

/** Loads one public Product Search page and keeps the previous page visible during URL transitions. */
export function useProductSearchQuery(query: SearchProductsRouteSearch) {
  return useQuery({
    queryKey: searchDiscoveryQueryKeys.products(query),
    queryFn: () => searchDiscoveryApi.searchProducts(query),
    placeholderData: (previous) => previous,
  });
}

/** Loads bounded autocomplete suggestions only after the minimum two-character query exists. */
export function useSearchSuggestionsQuery(q: string, limit = 8) {
  const normalized = q.trim();
  return useQuery({
    queryKey: searchDiscoveryQueryKeys.suggestions(normalized, limit),
    queryFn: () => searchDiscoveryApi.searchSuggestions(normalized, limit),
    enabled: normalized.length >= 2,
    staleTime: 60_000,
  });
}

/** Loads one public Store Search page only after the required Search text exists. */
export function useStoreSearchQuery(query: SearchStoresRouteSearch) {
  return useQuery({
    queryKey: searchDiscoveryQueryKeys.stores(query),
    queryFn: () => searchDiscoveryApi.searchStores(query),
    enabled: Boolean(query.q?.trim()),
    placeholderData: (previous) => previous,
  });
}

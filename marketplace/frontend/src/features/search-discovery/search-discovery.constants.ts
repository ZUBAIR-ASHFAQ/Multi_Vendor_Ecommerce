/** Public Product Search sort choices kept in sync with the Module 19 backend allow-list. */
export const SEARCH_PRODUCT_SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Rating" },
  { value: "newest", label: "Newest" },
] as const;

/** Public Store Search sort choices kept in sync with the Module 19 backend allow-list. */
export const SEARCH_STORE_SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "name", label: "Store name" },
] as const;

/** Frontend bounds mirror the public Module 19 request contracts and never expand them. */
export const SEARCH_UI_LIMITS = {
  QUERY_MAX_LENGTH: 200,
  SUGGESTION_QUERY_MAX_LENGTH: 120,
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MAX_ATTRIBUTE_FILTERS: 20,
} as const;

/** Stable Search errors used to present focused public retry/validation states. */
export const SEARCH_ERROR_CODE = {
  QUERY_INVALID: "SEARCH_QUERY_INVALID",
  INDEX_UNAVAILABLE: "SEARCH_INDEX_UNAVAILABLE",
} as const;

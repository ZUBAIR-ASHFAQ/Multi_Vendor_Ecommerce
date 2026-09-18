/** Stable TanStack Query keys for Module 5 taxonomy server state. */
export const catalogTaxonomyQueryKeys = {
  all: ["catalog-taxonomy"] as const,
  categories: ["catalog-taxonomy", "categories"] as const,
  brands: ["catalog-taxonomy", "brands"] as const,
  attributes: ["catalog-taxonomy", "attributes"] as const,

  /** Builds the cache key for one category's authoritative attribute mapping. */
  categoryAttributes: (categoryId: string) =>
    ["catalog-taxonomy", "categories", categoryId, "attributes"] as const,
};

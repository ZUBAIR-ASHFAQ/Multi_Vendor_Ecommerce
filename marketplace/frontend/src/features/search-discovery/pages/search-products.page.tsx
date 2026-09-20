import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiClientError } from "@/lib/api-error";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import {
  SEARCH_ERROR_CODE,
  SEARCH_PRODUCT_SORT_OPTIONS,
} from "../search-discovery.constants";
import { SearchFacetsPanel } from "../components/search-facets";
import { SearchPagination } from "../components/search-pagination";
import { SearchProductCard } from "../components/search-product-card";
import { SearchFiltersForm, SearchQueryForm } from "../forms/search-filters.form";
import { useProductSearchQuery } from "../hooks/use-search-discovery";
import type {
  SearchFacets,
  SearchFiltersFormValue,
  SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Converts scalar form state into shareable URL Search state while preserving query, sort, and selected facets. */
function applyFormToSearch(
  current: SearchProductsRouteSearch,
  value: SearchFiltersFormValue,
): SearchProductsRouteSearch {
  return {
    ...current,
    minPrice: value.minPrice || undefined,
    maxPrice: value.maxPrice || undefined,
    minRating: value.minRating ? Number(value.minRating) : undefined,
    inStock: value.inStock === "all" ? undefined : value.inStock === "true",
    page: 1,
  };
}

/** Returns a focused public-safe error title for known Search API failures. */
function searchErrorTitle(error: unknown): string {
  if (error instanceof ApiClientError && error.code === SEARCH_ERROR_CODE.QUERY_INVALID) {
    return "Search filters are invalid";
  }
  if (error instanceof ApiClientError && error.code === SEARCH_ERROR_CODE.INDEX_UNAVAILABLE) {
    return "Search is temporarily unavailable";
  }
  return "Search results could not be loaded";
}

/** Counts active filters without treating query text or sorting as filters. */
function activeFilterCount(search: SearchProductsRouteSearch): number {
  return [
    search.categoryId,
    search.brandId,
    ...(search.attribute ?? []),
    search.minPrice,
    search.maxPrice,
    search.minRating,
    search.inStock === undefined ? undefined : String(search.inStock),
  ].filter(Boolean).length;
}

/** Returns the human-readable label for one selected attribute token. */
function attributeFilterLabel(token: string, facets: SearchFacets): string {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex < 1) return token;
  const attributeId = token.slice(0, separatorIndex);
  const value = token.slice(separatorIndex + 1);
  const facet = facets.attributes.find((entry) => entry.attributeId === attributeId);
  const option = facet?.values.find((entry) => entry.value === value);
  return `${facet?.label ?? "Attribute"}: ${option?.label ?? value}`;
}

/** Renders removable URL-backed filter chips above the result set. */
function ActiveFilterChips({
  facets,
  search,
  onChange,
}: {
  facets: SearchFacets;
  search: SearchProductsRouteSearch;
  onChange: (next: SearchProductsRouteSearch) => void;
}) {
  const category = facets.categories.find((entry) => entry.categoryId === search.categoryId);
  const brand = facets.brands.find((entry) => entry.brandId === search.brandId);
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];

  if (search.categoryId) {
    chips.push({
      key: "category",
      label: `Category: ${category?.label ?? "Selected"}`,
      remove: () => onChange({ ...search, categoryId: undefined, page: 1 }),
    });
  }
  if (search.brandId) {
    chips.push({
      key: "brand",
      label: `Brand: ${brand?.label ?? "Selected"}`,
      remove: () => onChange({ ...search, brandId: undefined, page: 1 }),
    });
  }
  for (const token of search.attribute ?? []) {
    chips.push({
      key: `attribute:${token}`,
      label: attributeFilterLabel(token, facets),
      remove: () => {
        const next = (search.attribute ?? []).filter((entry) => entry !== token);
        onChange({ ...search, attribute: next.length ? next : undefined, page: 1 });
      },
    });
  }
  if (search.minPrice || search.maxPrice) {
    chips.push({
      key: "price",
      label: `Price: ${search.minPrice ?? "0"} – ${search.maxPrice ?? "Any"}`,
      remove: () => onChange({ ...search, minPrice: undefined, maxPrice: undefined, page: 1 }),
    });
  }
  if (search.minRating !== undefined) {
    chips.push({
      key: "rating",
      label: `${search.minRating}+ stars`,
      remove: () => onChange({ ...search, minRating: undefined, page: 1 }),
    });
  }
  if (search.inStock !== undefined) {
    chips.push({
      key: "availability",
      label: search.inStock ? "In stock" : "Out of stock",
      remove: () => onChange({ ...search, inStock: undefined, page: 1 }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="search-discovery-active-filters" aria-label="Active filters">
      <span>Active filters</span>
      <div>
        {chips.map((chip) => (
          <button key={chip.key} type="button" onClick={chip.remove}>
            {chip.label}<span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Renders the public Product discovery experience from the derived Search read model. */
export function SearchProductsPage({
  search,
  onSearchChange,
}: {
  search: SearchProductsRouteSearch;
  onSearchChange: (next: SearchProductsRouteSearch) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const results = useProductSearchQuery(search);
  const items = results.data?.data.items ?? [];
  const productMedia = usePublicMediaQuery(items.map((product) => product.thumbnailFileId));
  const mediaById = new Map(productMedia.data?.items.map((item) => [item.fileId, item]) ?? []);
  const filterCount = activeFilterCount(search);

  return (
    <div className="search-discovery-page">
      <nav className="search-discovery-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span aria-hidden="true">/</span><span>Search</span>
      </nav>

      <section className="search-discovery-intro">
        <p>Marketplace discovery</p>
        <h1>{search.q ? <>Results for “{search.q}”</> : "Shop the marketplace"}</h1>
        <span>Discover published products from active marketplace sellers and refine results with live catalog filters.</span>
      </section>

      <SearchQueryForm
        key={search.q ?? ""}
        value={search.q}
        onSubmit={(q) => onSearchChange({ ...search, q, page: 1 })}
      />

      {results.data ? (
        <>
          <div className="search-discovery-toolbar">
            <div>
              <strong>{results.data.meta.totalItems.toLocaleString()} results</strong>
              <span>Page {results.data.meta.page} of {Math.max(results.data.meta.totalPages, 1)}</span>
            </div>
            <div className="search-discovery-toolbar-actions">
              <Button
                type="button"
                variant="outline"
                className="search-discovery-mobile-filter-button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
              >
                Filters{filterCount ? ` (${filterCount})` : ""}
              </Button>
              <label className="search-discovery-sort">
                <span>Sort by</span>
                <Select
                  aria-label="Search result sort"
                  value={search.sort}
                  onChange={(event) => onSearchChange({
                    ...search,
                    sort: event.target.value as SearchProductsRouteSearch["sort"],
                    page: 1,
                  })}
                >
                  {SEARCH_PRODUCT_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
            </div>
          </div>

          <ActiveFilterChips
            facets={results.data.data.facets}
            search={search}
            onChange={onSearchChange}
          />
        </>
      ) : null}

      {filtersOpen ? (
        <button
          type="button"
          className="search-discovery-filter-backdrop"
          aria-label="Close filters"
          onClick={() => setFiltersOpen(false)}
        />
      ) : null}

      <div className="search-discovery-layout">
        <aside className={`search-discovery-sidebar${filtersOpen ? " is-open" : ""}`} aria-label="Product filters">
          <div className="search-discovery-mobile-filter-heading">
            <strong>Filters</strong>
            <button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>×</button>
          </div>

          <SearchFiltersForm
            key={JSON.stringify({
              minPrice: search.minPrice,
              maxPrice: search.maxPrice,
              minRating: search.minRating,
              inStock: search.inStock,
            })}
            search={search}
            onApply={(value) => {
              onSearchChange(applyFormToSearch(search, value));
              setFiltersOpen(false);
            }}
            onReset={() => onSearchChange({
              q: search.q,
              sort: search.sort,
              page: 1,
              pageSize: search.pageSize,
            })}
          />

          {results.data ? (
            <SearchFacetsPanel
              facets={results.data.data.facets}
              search={search}
              onChange={onSearchChange}
            />
          ) : null}
        </aside>

        <section className="search-discovery-results" aria-label="Product Search results">
          {results.isFetching && !results.isPending ? (
            <p className="search-discovery-refreshing" role="status">Updating results…</p>
          ) : null}

          {results.isPending ? <LoadingState label="Searching products..." /> : null}
          {results.isError ? (
            <ErrorState
              title={searchErrorTitle(results.error)}
              message={results.error instanceof Error ? results.error.message : "Please try again."}
              requestId={results.error instanceof ApiClientError ? results.error.requestId : undefined}
              onRetry={() => void results.refetch()}
            />
          ) : null}

          {results.data && results.data.data.items.length === 0 ? (
            <div className="search-discovery-empty">
              <span aria-hidden="true">◇</span>
              <h2>No products found</h2>
              <p>Try a broader search or remove one of the active filters.</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSearchChange({ sort: "relevance", page: 1, pageSize: search.pageSize })}
              >
                Clear search and filters
              </Button>
            </div>
          ) : null}

          {results.data && results.data.data.items.length > 0 ? (
            <div className="search-discovery-product-grid">
              {results.data.data.items.map((product) => {
                const image = product.thumbnailFileId ? mediaById.get(product.thumbnailFileId) : undefined;
                return (
                  <SearchProductCard
                    key={product.productId}
                    product={product}
                    imageUrl={image?.url}
                    imageMimeType={image?.mimeType}
                  />
                );
              })}
            </div>
          ) : null}
        </section>
      </div>

      {results.data ? (
        <SearchPagination
          meta={results.data.meta}
          onPage={(page) => onSearchChange({ ...search, page })}
        />
      ) : null}
    </div>
  );
}

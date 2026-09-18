import { ApiClientError } from "@/lib/api-error";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { SEARCH_ERROR_CODE, SEARCH_UI_LIMITS } from "../search-discovery.constants";
import { SearchFacetsPanel } from "../components/search-facets";
import { SearchPagination } from "../components/search-pagination";
import { SearchProductCard } from "../components/search-product-card";
import { SearchFiltersForm } from "../forms/search-filters.form";
import { useProductSearchQuery } from "../hooks/use-search-discovery";
import type {
  SearchFiltersFormValue,
  SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Converts scalar form state into shareable URL Search state while preserving selected facets. */
function applyFormToSearch(
  current: SearchProductsRouteSearch,
  value: SearchFiltersFormValue,
): SearchProductsRouteSearch {
  return {
    ...current,
    q: value.q || undefined,
    minPrice: value.minPrice || undefined,
    maxPrice: value.maxPrice || undefined,
    minRating: value.minRating ? Number(value.minRating) : undefined,
    inStock: value.inStock === "all" ? undefined : value.inStock === "true",
    sort: value.sort,
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

/** Renders public Product discovery from the derived Module 19 Search read model. */
export function SearchProductsPage({
  search,
  onSearchChange,
}: {
  search: SearchProductsRouteSearch;
  onSearchChange: (next: SearchProductsRouteSearch) => void;
}) {
  const results = useProductSearchQuery(search);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Storefront discovery</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Search marketplace</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Search published Products by text, taxonomy, price, rating, and cached availability.
          Search is eventually consistent; Product detail and later checkout revalidate source data.
        </p>
      </section>

      <SearchFiltersForm
        key={JSON.stringify({
          q: search.q,
          minPrice: search.minPrice,
          maxPrice: search.maxPrice,
          minRating: search.minRating,
          inStock: search.inStock,
          sort: search.sort,
        })}
        search={search}
        onApply={(value) => onSearchChange(applyFormToSearch(search, value))}
        onReset={() => onSearchChange({
          sort: "relevance",
          page: 1,
          pageSize: SEARCH_UI_LIMITS.PAGE_SIZE,
        })}
      />

      {results.isPending ? <LoadingState label="Searching Products..." /> : null}
      {results.isError ? (
        <ErrorState
          title={searchErrorTitle(results.error)}
          message={results.error instanceof Error ? results.error.message : "Please try again."}
          requestId={results.error instanceof ApiClientError ? results.error.requestId : undefined}
          onRetry={() => void results.refetch()}
        />
      ) : null}

      {results.data ? (
        <>
          {results.isFetching && !results.isPending ? (
            <p className="rounded-md border bg-white px-4 py-2 text-sm text-slate-500" role="status">
              Refreshing Search results…
            </p>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <SearchFacetsPanel
              facets={results.data.data.facets}
              search={search}
              onChange={onSearchChange}
            />

            <section aria-label="Product Search results">
              {results.data.data.items.length === 0 ? (
                <div className="rounded-xl border bg-white p-6 shadow-sm">
                  <h2 className="font-semibold">No Products found</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Try a broader query or clear one of the active filters.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {results.data.data.items.map((product) => (
                    <SearchProductCard key={product.productId} product={product} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <SearchPagination
            meta={results.data.meta}
            onPage={(page) => onSearchChange({ ...search, page })}
          />
        </>
      ) : null}
    </div>
  );
}

import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError } from "@/features/auth/components/form-error";
import { SEARCH_PRODUCT_SORT_OPTIONS } from "../search-discovery.constants";
import {
  searchFiltersFormSchema,
  type SearchFiltersFormValue,
  type SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";
import { SearchAutocomplete } from "../components/search-autocomplete";

/** Converts current URL Search state into string-friendly TanStack Form defaults. */
function formDefaults(search: SearchProductsRouteSearch): SearchFiltersFormValue {
  return {
    q: search.q ?? "",
    minPrice: search.minPrice ?? "",
    maxPrice: search.maxPrice ?? "",
    minRating: search.minRating === undefined ? "" : String(search.minRating) as SearchFiltersFormValue["minRating"],
    inStock: search.inStock === undefined ? "all" : String(search.inStock) as SearchFiltersFormValue["inStock"],
    sort: search.sort,
  };
}

/** Collects public Search text and scalar filters with TanStack Form + Zod. */
export function SearchFiltersForm({
  search,
  onApply,
  onReset,
}: {
  search: SearchProductsRouteSearch;
  onApply: (value: SearchFiltersFormValue) => void;
  onReset: () => void;
}) {
  const form = useForm({
    defaultValues: formDefaults(search),
    validators: { onChange: searchFiltersFormSchema },
    onSubmit: ({ value }) => onApply(searchFiltersFormSchema.parse(value)),
  });

  return (
    <form
      className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm lg:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="q">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="relative block text-sm font-medium lg:col-span-2">
              Search Products
              <input
                aria-label="Marketplace search"
                autoComplete="off"
                placeholder="Search products, brands, or categories"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <SearchAutocomplete value={field.state.value} onSelect={field.handleChange} />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="minPrice">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Min price
              <input
                aria-label="Minimum price"
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="maxPrice">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <label className="text-sm font-medium">
              Max price
              <input
                aria-label="Maximum price"
                aria-invalid={Boolean(error)}
                inputMode="decimal"
                placeholder="999.99"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <form.Field name="minRating">
        {(field) => (
          <label className="text-sm font-medium">
            Minimum rating
            <select
              aria-label="Minimum rating"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as SearchFiltersFormValue["minRating"])}
            >
              <option value="">Any rating</option>
              <option value="1">1+ stars</option>
              <option value="2">2+ stars</option>
              <option value="3">3+ stars</option>
              <option value="4">4+ stars</option>
              <option value="5">5 stars</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="inStock">
        {(field) => (
          <label className="text-sm font-medium">
            Availability
            <select
              aria-label="Availability"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as SearchFiltersFormValue["inStock"])}
            >
              <option value="all">Any availability</option>
              <option value="true">In stock</option>
              <option value="false">Out of stock</option>
            </select>
          </label>
        )}
      </form.Field>

      <form.Field name="sort">
        {(field) => (
          <label className="text-sm font-medium lg:col-span-2">
            Sort results
            <select
              aria-label="Search result sort"
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as SearchFiltersFormValue["sort"])}
            >
              {SEARCH_PRODUCT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
      </form.Field>

      <div className="flex items-end gap-2 lg:col-span-4">
        <Button type="submit">Search</Button>
        <Button type="button" variant="outline" onClick={onReset}>Clear filters</Button>
      </div>
    </form>
  );
}

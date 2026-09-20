import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { firstFieldError } from "@/features/auth/components/form-error";
import {
  searchFiltersFormSchema,
  searchQueryFormSchema,
  type SearchFiltersFormValue,
  type SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";
import { SearchAutocomplete } from "../components/search-autocomplete";

/** Converts current URL Search state into string-friendly scalar-filter defaults. */
function filterDefaults(search: SearchProductsRouteSearch): SearchFiltersFormValue {
  return {
    minPrice: search.minPrice ?? "",
    maxPrice: search.maxPrice ?? "",
    minRating: search.minRating === undefined
      ? ""
      : String(search.minRating) as SearchFiltersFormValue["minRating"],
    inStock: search.inStock === undefined
      ? "all"
      : String(search.inStock) as SearchFiltersFormValue["inStock"],
  };
}

/** Search-only form used above the result grid; submitting updates the shareable URL query. */
export function SearchQueryForm({
  value,
  onSubmit,
}: {
  value: string | undefined;
  onSubmit: (query: string | undefined) => void;
}) {
  const form = useForm({
    defaultValues: { q: value ?? "" },
    validators: { onChange: searchQueryFormSchema },
    onSubmit: ({ value: next }) => {
      const parsed = searchQueryFormSchema.parse(next);
      onSubmit(parsed.q || undefined);
    },
  });

  return (
    <form
      className="search-discovery-query-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="q">
        {(field) => {
          const error = firstFieldError(field.state.meta.errors);
          return (
            <div className="search-discovery-query-field">
              <label htmlFor="marketplace-product-search">Search products</label>
              <div className="search-discovery-query-input-wrap">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
                </svg>
                <Input
                  id="marketplace-product-search"
                  aria-label="Marketplace search"
                  autoComplete="off"
                  type="search"
                  placeholder="Search products, brands, or categories"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <SearchAutocomplete value={field.state.value} onSelect={field.handleChange} />
              </div>
              {error ? <span className="search-discovery-field-error">{error}</span> : null}
            </div>
          );
        }}
      </form.Field>
      <Button type="submit" size="lg">Search</Button>
    </form>
  );
}

/** Collects scalar Product filters while category/brand/attribute facets remain independently URL-backed. */
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
    defaultValues: filterDefaults(search),
    validators: { onChange: searchFiltersFormSchema },
    onSubmit: ({ value }) => onApply(searchFiltersFormSchema.parse(value)),
  });

  return (
    <form
      className="search-discovery-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="search-discovery-sidebar-heading">
        <div>
          <p>Refine</p>
          <h2>Filters</h2>
        </div>
        <button type="button" onClick={onReset}>Clear all</button>
      </div>

      <fieldset className="search-discovery-filter-group">
        <legend>Price</legend>
        <div className="search-discovery-price-grid">
          <form.Field name="minPrice">
            {(field) => {
              const error = firstFieldError(field.state.meta.errors);
              return (
                <label>
                  <span>Minimum</span>
                  <Input
                    aria-label="Minimum price"
                    aria-invalid={Boolean(error)}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {error ? <span className="search-discovery-field-error">{error}</span> : null}
                </label>
              );
            }}
          </form.Field>

          <form.Field name="maxPrice">
            {(field) => {
              const error = firstFieldError(field.state.meta.errors);
              return (
                <label>
                  <span>Maximum</span>
                  <Input
                    aria-label="Maximum price"
                    aria-invalid={Boolean(error)}
                    inputMode="decimal"
                    placeholder="999.99"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {error ? <span className="search-discovery-field-error">{error}</span> : null}
                </label>
              );
            }}
          </form.Field>
        </div>
      </fieldset>

      <form.Field name="minRating">
        {(field) => (
          <label className="search-discovery-filter-group">
            <span className="search-discovery-filter-label">Minimum rating</span>
            <Select
              aria-label="Minimum rating"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as SearchFiltersFormValue["minRating"])}
            >
              <option value="">Any rating</option>
              <option value="4">4 stars & up</option>
              <option value="3">3 stars & up</option>
              <option value="2">2 stars & up</option>
              <option value="1">1 star & up</option>
              <option value="5">5 stars</option>
            </Select>
          </label>
        )}
      </form.Field>

      <form.Field name="inStock">
        {(field) => (
          <label className="search-discovery-filter-group">
            <span className="search-discovery-filter-label">Availability</span>
            <Select
              aria-label="Availability"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as SearchFiltersFormValue["inStock"])}
            >
              <option value="all">All products</option>
              <option value="true">In stock</option>
              <option value="false">Out of stock</option>
            </Select>
          </label>
        )}
      </form.Field>

      <Button className="w-full" type="submit">Apply filters</Button>
    </form>
  );
}

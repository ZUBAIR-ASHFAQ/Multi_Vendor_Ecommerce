import type {
  SearchFacets,
  SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Builds the stable attributeId=value token accepted by the backend Search query contract. */
function attributeToken(attributeId: string, value: string): string {
  return `${attributeId}=${value}`;
}

/** Renders category, brand, attribute, price, and availability facets returned by Search. */
export function SearchFacetsPanel({
  facets,
  search,
  onChange,
}: {
  facets: SearchFacets;
  search: SearchProductsRouteSearch;
  onChange: (next: SearchProductsRouteSearch) => void;
}) {
  const selectedAttributes = search.attribute ?? [];

  return (
    <aside className="space-y-5 rounded-xl border bg-white p-5 shadow-sm" aria-label="Search facets">
      <div>
        <h2 className="font-semibold">Categories</h2>
        <div className="mt-2 space-y-1">
          {facets.categories.length === 0 ? <p className="text-xs text-slate-500">No category facets.</p> : null}
          {facets.categories.map((facet) => (
            <button
              key={facet.categoryId}
              type="button"
              aria-pressed={search.categoryId === facet.categoryId}
              className={[
                "flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm",
                "hover:bg-slate-50 aria-pressed:bg-slate-100 aria-pressed:font-semibold",
              ].join(" ")}
              onClick={() => onChange({
                ...search,
                page: 1,
                categoryId: search.categoryId === facet.categoryId ? undefined : facet.categoryId,
              })}
            >
              <span>{facet.label}</span><span className="text-slate-500">{facet.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Brands</h2>
        <div className="mt-2 space-y-1">
          {facets.brands.length === 0 ? <p className="text-xs text-slate-500">No brand facets.</p> : null}
          {facets.brands.map((facet) => (
            <button
              key={facet.brandId}
              type="button"
              aria-pressed={search.brandId === facet.brandId}
              className={[
                "flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm",
                "hover:bg-slate-50 aria-pressed:bg-slate-100 aria-pressed:font-semibold",
              ].join(" ")}
              onClick={() => onChange({
                ...search,
                page: 1,
                brandId: search.brandId === facet.brandId ? undefined : facet.brandId,
              })}
            >
              <span>{facet.label}</span><span className="text-slate-500">{facet.count}</span>
            </button>
          ))}
        </div>
      </div>

      {facets.attributes.map((facet) => (
        <fieldset key={facet.attributeId}>
          <legend className="font-semibold">{facet.label}</legend>
          <div className="mt-2 space-y-2">
            {facet.values.map((value) => {
              const token = attributeToken(facet.attributeId, value.value);
              const checked = selectedAttributes.includes(token);
              return (
                <label key={token} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const nextAttributes = checked
                          ? selectedAttributes.filter((entry) => entry !== token)
                          : [...selectedAttributes, token];
                        onChange({
                          ...search,
                          page: 1,
                          attribute: nextAttributes.length ? nextAttributes : undefined,
                        });
                      }}
                    />
                    {value.label}
                  </span>
                  <span className="text-slate-500">{value.count}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="border-t pt-4 text-xs text-slate-600">
        <p>
          Availability: {facets.availability.inStock} in stock · {facets.availability.outOfStock} out of stock
        </p>
        {facets.price ? <p className="mt-1">Result price range: {facets.price.min}–{facets.price.max}</p> : null}
      </div>
    </aside>
  );
}

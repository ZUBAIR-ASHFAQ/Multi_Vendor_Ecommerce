import type {
  SearchFacets,
  SearchProductsRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Builds the stable attributeId=value token accepted by the backend Search query contract. */
function attributeToken(attributeId: string, value: string): string {
  return `${attributeId}=${value}`;
}

/** Renders category, brand, and attribute facets returned by Search. */
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
    <div className="search-discovery-facets" aria-label="Search facets">
      <section className="search-discovery-facet-group">
        <h3>Categories</h3>
        <div className="search-discovery-facet-options">
          {facets.categories.length === 0 ? <p>No category facets.</p> : null}
          {facets.categories.map((facet) => (
            <button
              key={facet.categoryId}
              type="button"
              aria-pressed={search.categoryId === facet.categoryId}
              className="search-discovery-facet-button"
              onClick={() => onChange({
                ...search,
                page: 1,
                categoryId: search.categoryId === facet.categoryId ? undefined : facet.categoryId,
              })}
            >
              <span>{facet.label}</span>
              <span>{facet.count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="search-discovery-facet-group">
        <h3>Brands</h3>
        <div className="search-discovery-facet-options">
          {facets.brands.length === 0 ? <p>No brand facets.</p> : null}
          {facets.brands.map((facet) => (
            <button
              key={facet.brandId}
              type="button"
              aria-pressed={search.brandId === facet.brandId}
              className="search-discovery-facet-button"
              onClick={() => onChange({
                ...search,
                page: 1,
                brandId: search.brandId === facet.brandId ? undefined : facet.brandId,
              })}
            >
              <span>{facet.label}</span>
              <span>{facet.count}</span>
            </button>
          ))}
        </div>
      </section>

      {facets.attributes.map((facet) => (
        <fieldset key={facet.attributeId} className="search-discovery-facet-group">
          <legend>{facet.label}</legend>
          <div className="search-discovery-attribute-options">
            {facet.values.map((value) => {
              const token = attributeToken(facet.attributeId, value.value);
              const checked = selectedAttributes.includes(token);
              return (
                <label key={token}>
                  <span>
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
                  <span>{value.count}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="search-discovery-facet-summary">
        <p>
          <strong>{facets.availability.inStock}</strong> in stock · {facets.availability.outOfStock} out of stock
        </p>
        {facets.price ? <p>Current result range: {facets.price.min}–{facets.price.max}</p> : null}
      </div>
    </div>
  );
}

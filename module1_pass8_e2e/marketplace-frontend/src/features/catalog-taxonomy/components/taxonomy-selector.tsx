import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  Brand,
  CatalogAttribute,
  CategoryAttributeMapping,
  CategoryOption,
  TaxonomySelection,
} from "../types/catalog-taxonomy.types";

/** Provides a reusable read-only taxonomy selector for later Product Management forms. */
export function TaxonomySelector({
  categories,
  brands,
  attributes,
  mappings,
  isMappingPending,
  mappingError,
  onCategoryChange,
  onRetryMapping,
  onSelectionChange,
}: {
  categories: CategoryOption[];
  brands: Brand[];
  attributes: CatalogAttribute[];
  mappings: CategoryAttributeMapping[];
  isMappingPending: boolean;
  mappingError: unknown;
  onCategoryChange: (categoryId: string) => void;
  onRetryMapping: () => void;
  onSelectionChange?: (selection: TaxonomySelection) => void;
}) {
  const [selection, setSelection] = useState<TaxonomySelection>({
    categoryId: "",
    brandId: "",
    attributeIds: [],
  });

  const attributeById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const scopedAttributes = [...mappings]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((mapping) => ({ mapping, attribute: attributeById.get(mapping.attributeId) }))
    .filter(
      (item): item is { mapping: CategoryAttributeMapping; attribute: CatalogAttribute } =>
        Boolean(item.attribute),
    );

  /** Updates the local selection and optionally reports it to a later consuming feature. */
  function change(next: TaxonomySelection): void {
    setSelection(next);
    onSelectionChange?.(next);
  }

  /** Changes category, clears stale attribute choices, and requests the new category mapping. */
  function changeCategory(categoryId: string): void {
    change({ ...selection, categoryId, attributeIds: [] });
    onCategoryChange(categoryId);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Category
          <select
            aria-label="Taxonomy category selector"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={selection.categoryId}
            onChange={(event) => changeCategory(event.target.value)}
          >
            <option value="">Choose category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {`${"— ".repeat(category.depth)}${category.label}`}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          Brand <span className="font-normal text-slate-500">(optional)</span>
          <select
            aria-label="Taxonomy brand selector"
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={selection.brandId}
            onChange={(event) => change({ ...selection, brandId: event.target.value })}
          >
            <option value="">No brand selected</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>{brand.name}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Category attributes</legend>
        <p className="mt-1 text-xs text-slate-500">
          Only attributes mapped to the selected category are shown. Product-specific value validation belongs to Module 6.
        </p>

        {!selection.categoryId ? (
          <p className="mt-3 rounded-md border p-4 text-sm text-slate-500">
            Choose a category to see its allowed attributes.
          </p>
        ) : isMappingPending ? (
          <p className="mt-3 rounded-md border p-4 text-sm text-slate-500">
            Loading category attributes...
          </p>
        ) : mappingError ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{mappingError instanceof Error ? mappingError.message : "Category attributes could not be loaded."}</p>
            <Button className="mt-3" type="button" variant="outline" onClick={onRetryMapping}>
              Retry category attributes
            </Button>
          </div>
        ) : scopedAttributes.length === 0 ? (
          <p className="mt-3 rounded-md border p-4 text-sm text-slate-500">
            No reusable attributes are mapped to this category.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {scopedAttributes.map(({ attribute, mapping }) => {
              const checked = selection.attributeIds.includes(attribute.id);
              return (
                <label key={attribute.id} className="rounded-md border p-3 text-sm">
                  <span className="flex items-start gap-2">
                    <input
                      aria-label={`Select taxonomy attribute ${attribute.name}`}
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const attributeIds = event.target.checked
                          ? [...selection.attributeIds, attribute.id]
                          : selection.attributeIds.filter((id) => id !== attribute.id);
                        change({ ...selection, attributeIds });
                      }}
                    />
                    <span>
                      <strong>{attribute.name}</strong>
                      <span className="block text-xs text-slate-500">
                        {attribute.code} · {attribute.dataType}
                        {attribute.isVariantAxis ? " · variant axis" : ""}
                        {mapping.isRequired ? " · required" : ""}
                        {mapping.isFilterable ? " · filterable" : ""}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </div>
  );
}

import type {
  CatalogAttribute,
  CategoryAttributeMapping,
} from "@/features/catalog-taxonomy/types/catalog-taxonomy.types";
import type { ProductAttributeInput } from "../types/products.types";

/** Reads the currently selected request value for one taxonomy attribute. */
function currentValue(
  values: ProductAttributeInput[],
  attributeId: string,
): ProductAttributeInput | undefined {
  return values.find((value) => value.attributeId === attributeId);
}

/** Replaces or removes one Product attribute value without mutating the caller's array. */
function replaceValue(
  values: ProductAttributeInput[],
  attributeId: string,
  next: ProductAttributeInput | null,
): ProductAttributeInput[] {
  const others = values.filter((value) => value.attributeId !== attributeId);
  return next ? [...others, next] : others;
}

/** Renders mapped taxonomy value controls for either Product-level or variant-axis attributes. */
export function ProductAttributeFields({
  mappings,
  attributes,
  values,
  variantAxis,
  onChange,
}: {
  mappings: CategoryAttributeMapping[];
  attributes: CatalogAttribute[];
  values: ProductAttributeInput[];
  variantAxis: boolean;
  onChange: (values: ProductAttributeInput[]) => void;
}) {
  const attributeById = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const fields = [...mappings]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((mapping) => ({ mapping, attribute: attributeById.get(mapping.attributeId) }))
    .filter(
      (entry): entry is { mapping: CategoryAttributeMapping; attribute: CatalogAttribute } =>
        Boolean(entry.attribute) && entry.attribute?.isVariantAxis === variantAxis,
    );

  if (fields.length === 0) {
    return (
      <p className="rounded-md border p-3 text-sm text-slate-500">
        No {variantAxis ? "variant" : "Product"} attributes are mapped to this category.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(({ mapping, attribute }) => {
        const selected = currentValue(values, attribute.id);
        const label = `${attribute.name}${mapping.isRequired ? " *" : ""}`;

        if (attribute.dataType === "option" || attribute.values.length > 0) {
          return (
            <label key={attribute.id} className="block text-sm font-medium">
              {label}
              <select
                aria-label={`Product attribute ${attribute.name}`}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={selected?.valueId ?? ""}
                onChange={(event) => {
                  const valueId = event.target.value;
                  onChange(
                    replaceValue(
                      values,
                      attribute.id,
                      valueId ? { attributeId: attribute.id, valueId } : null,
                    ),
                  );
                }}
              >
                <option value="">Choose value</option>
                {attribute.values
                  .filter((value) => value.status === "active")
                  .sort((left, right) => left.sortOrder - right.sortOrder)
                  .map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.value}
                    </option>
                  ))}
              </select>
            </label>
          );
        }

        if (attribute.dataType === "number") {
          return (
            <label key={attribute.id} className="block text-sm font-medium">
              {label}
              <input
                aria-label={`Product attribute ${attribute.name}`}
                className="mt-1 w-full rounded-md border px-3 py-2"
                inputMode="decimal"
                value={selected?.valueNumber ?? ""}
                onChange={(event) => {
                  const valueNumber = event.target.value.trim();
                  onChange(
                    replaceValue(
                      values,
                      attribute.id,
                      valueNumber ? { attributeId: attribute.id, valueNumber } : null,
                    ),
                  );
                }}
              />
            </label>
          );
        }

        return (
          <label key={attribute.id} className="block text-sm font-medium">
            {label}
            <input
              aria-label={`Product attribute ${attribute.name}`}
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={selected?.valueText ?? ""}
              onChange={(event) => {
                const valueText = event.target.value;
                onChange(
                  replaceValue(
                    values,
                    attribute.id,
                    valueText.trim() ? { attributeId: attribute.id, valueText } : null,
                  ),
                );
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

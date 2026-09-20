import { useAttributesQuery } from "@/features/catalog-taxonomy/hooks/use-catalog-taxonomy";
import type { CatalogAttribute } from "@/features/catalog-taxonomy/types/catalog-taxonomy.types";
import type { ProductAttributeValue, PublicProductDetail } from "../types/products.types";

/** Converts one persisted Product attribute value into its public human-readable representation. */
function displayValue(value: ProductAttributeValue, attribute: CatalogAttribute): string | null {
  if (value.valueText) return value.valueText;
  if (value.valueNumber) return value.valueNumber;
  if (value.valueId) {
    return attribute.values.find((option) => option.id === value.valueId)?.value ?? null;
  }
  return null;
}

/** Description/specification surface using the existing public taxonomy read for attribute labels. */
export function PublicProductDetailsSection({
  product,
  selectedVariantId,
}: {
  product: PublicProductDetail;
  selectedVariantId: string | null;
}) {
  const attributes = useAttributesQuery();
  const definitions = new Map((attributes.data ?? []).map((attribute) => [attribute.id, attribute]));
  const visibleAttributes = product.attributes
    .filter((value) => value.variantId === null || value.variantId === selectedVariantId)
    .flatMap((value) => {
      const definition = definitions.get(value.attributeId);
      if (!definition) return [];
      const rendered = displayValue(value, definition);
      return rendered ? [{ id: value.id, name: definition.name, value: rendered }] : [];
    });
  const selected = product.variants.find((variant) => variant.id === selectedVariantId) ?? product.variants[0];

  return (
    <section className="product-detail-information" aria-labelledby="product-information-heading">
      <div>
        <p className="product-detail-section-kicker">Product information</p>
        <h2 id="product-information-heading">Details that matter</h2>
      </div>
      <div className="product-detail-information-grid">
        <article>
          <h3>Description</h3>
          <p>{product.description}</p>
        </article>
        <article>
          <h3>Specifications</h3>
          <dl>
            <div><dt>Category</dt><dd>{product.category.name}</dd></div>
            {product.brand ? <div><dt>Brand</dt><dd>{product.brand.name}</dd></div> : null}
            {selected ? <div><dt>Variant</dt><dd>{selected.title}</dd></div> : null}
            {selected?.weight ? <div><dt>Weight</dt><dd>{selected.weight}</dd></div> : null}
            {visibleAttributes.map((item) => (
              <div key={item.id}><dt>{item.name}</dt><dd>{item.value}</dd></div>
            ))}
          </dl>
        </article>
      </div>
    </section>
  );
}

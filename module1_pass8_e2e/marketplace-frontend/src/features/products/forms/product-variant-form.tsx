import { useMemo } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  useAttributesQuery,
  useCategoryAttributesQuery,
} from "@/features/catalog-taxonomy/hooks/use-catalog-taxonomy";
import { ProductAttributeFields } from "../components/product-attribute-fields";
import { productVariantFormSchema } from "../schemas/products.schemas";
import type {
  CreateProductVariantInput,
  ProductAttributeInput,
  ProductDetail,
  ProductVariant,
  UpdateProductVariantInput,
} from "../types/products.types";

interface ProductVariantFormProps {
  product: ProductDetail;
  variant?: ProductVariant;
  defaultCurrency: string;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateProductVariantInput | UpdateProductVariantInput) => Promise<void>;
}

/** Collects one SKU/variant and only variant-axis taxonomy attributes for the Product category. */
export function ProductVariantForm({
  product,
  variant,
  defaultCurrency,
  submitLabel,
  isPending,
  error,
  onSubmit,
}: ProductVariantFormProps) {
  const initialAttributes = useMemo(
    () =>
      product.attributes
        .filter((value) => value.variantId === variant?.id)
        .map<ProductAttributeInput>((value) => ({
          attributeId: value.attributeId,
          ...(value.valueText ? { valueText: value.valueText } : {}),
          ...(value.valueNumber ? { valueNumber: value.valueNumber } : {}),
          ...(value.valueId ? { valueId: value.valueId } : {}),
        })),
    [product.attributes, variant?.id],
  );
  const mappings = useCategoryAttributesQuery(product.categoryId);
  const attributes = useAttributesQuery();
  const form = useForm({
    defaultValues: {
      sku: variant?.sku ?? "",
      title: variant?.title ?? "",
      price: variant?.price ?? "",
      compareAtPrice: variant?.compareAtPrice ?? "",
      currency: variant?.currency ?? defaultCurrency,
      status: variant?.status ?? ("active" as const),
      weight: variant?.weight ?? "",
      attributes: initialAttributes,
    },
    validators: { onChange: productVariantFormSchema },
    onSubmit: async ({ value }) => {
      const normalized = {
        sku: value.sku.trim(),
        title: value.title.trim(),
        price: value.price.trim(),
        compareAtPrice: value.compareAtPrice.trim() || null,
        currency: value.currency.trim().toUpperCase(),
        status: value.status,
        weight: value.weight.trim() || null,
        attributes: value.attributes,
      };

      try {
        await onSubmit(normalized);
        if (!variant) form.reset();
      } catch {
        // TanStack Query owns the normalized request error rendered by FormError below.
      }
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="sku">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                SKU
                <input
                  aria-label={variant ? `Variant SKU ${variant.id}` : "Variant SKU"}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="title">
          {(field) => (
            <label className="block text-sm font-medium">
              Variant title
              <input
                aria-label={variant ? `Variant title ${variant.id}` : "Variant title"}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="price">
          {(field) => (
            <label className="block text-sm font-medium">
              Price
              <input
                aria-label={variant ? `Variant price ${variant.id}` : "Variant price"}
                inputMode="decimal"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>

        <form.Field name="compareAtPrice">
          {(field) => (
            <label className="block text-sm font-medium">
              Compare-at price
              <input
                aria-label={variant ? `Variant compare price ${variant.id}` : "Variant compare price"}
                inputMode="decimal"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>

        <form.Field name="currency">
          {(field) => (
            <label className="block text-sm font-medium">
              Currency
              <input
                aria-label={variant ? `Variant currency ${variant.id}` : "Variant currency"}
                className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
                maxLength={3}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
              />
            </label>
          )}
        </form.Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="status">
          {(field) => (
            <label className="block text-sm font-medium">
              Variant status
              <select
                aria-label={variant ? `Variant status ${variant.id}` : "Variant status"}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "active" | "inactive")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="weight">
          {(field) => (
            <label className="block text-sm font-medium">
              Weight <span className="font-normal text-slate-500">(optional)</span>
              <input
                aria-label={variant ? `Variant weight ${variant.id}` : "Variant weight"}
                inputMode="decimal"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">Variant attributes</legend>
        <form.Field name="attributes">
          {(field) =>
            mappings.isPending || attributes.isPending ? (
              <p className="text-sm text-slate-500">Loading variant attributes...</p>
            ) : mappings.isError || attributes.isError ? (
              <p className="text-sm text-red-700">Variant attributes could not be loaded.</p>
            ) : (
              <ProductAttributeFields
                mappings={mappings.data ?? []}
                attributes={attributes.data ?? []}
                values={field.state.value}
                variantAxis
                onChange={field.handleChange}
              />
            )
          }
        </form.Field>
      </fieldset>

      <FormError error={error} />
      <Button disabled={isPending || mappings.isPending || attributes.isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}

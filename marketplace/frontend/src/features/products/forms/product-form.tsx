import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { flattenCategoryTree } from "@/features/catalog-taxonomy/components/category-tree";
import {
  useAttributesQuery,
  useBrandsQuery,
  useCategoriesQuery,
  useCategoryAttributesQuery,
} from "@/features/catalog-taxonomy/hooks/use-catalog-taxonomy";
import { ProductAttributeFields } from "../components/product-attribute-fields";
import { productEditorFormSchema } from "../schemas/products.schemas";
import type {
  CreateProductInput,
  ProductAttributeInput,
  ProductDetail,
  UpdateProductInput,
} from "../types/products.types";

interface ProductFormProps {
  stores: Array<{ id: string; name: string; status: string; defaultCurrency: string }>;
  product?: ProductDetail;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateProductInput | UpdateProductInput) => Promise<void>;
}

/** Collects Product basics and non-variant taxonomy attributes using the authoritative Module 5 read contracts. */
export function ProductForm({
  stores,
  product,
  submitLabel,
  isPending,
  error,
  onSubmit,
}: ProductFormProps) {
  const initialProductAttributes = useMemo(
    () =>
      (product?.attributes ?? [])
        .filter((value) => value.variantId === null)
        .map<ProductAttributeInput>((value) => ({
          attributeId: value.attributeId,
          ...(value.valueText ? { valueText: value.valueText } : {}),
          ...(value.valueNumber ? { valueNumber: value.valueNumber } : {}),
          ...(value.valueId ? { valueId: value.valueId } : {}),
        })),
    [product],
  );
  const initialCategoryId = product?.categoryId ?? "";
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId);
  const categories = useCategoriesQuery();
  const brands = useBrandsQuery();
  const attributes = useAttributesQuery();
  const mappings = useCategoryAttributesQuery(selectedCategoryId, Boolean(selectedCategoryId));

  const form = useForm({
    defaultValues: {
      storeId: product?.storeId ?? stores[0]?.id ?? "",
      categoryId: initialCategoryId,
      brandId: product?.brandId ?? "",
      slug: product?.slug ?? "",
      name: product?.name ?? "",
      description: product?.description ?? "",
      attributes: initialProductAttributes,
    },
    validators: { onChange: productEditorFormSchema },
    onSubmit: async ({ value }) => {
      const normalized = {
        categoryId: value.categoryId,
        brandId: value.brandId || null,
        slug: value.slug.trim().toLowerCase(),
        name: value.name.trim(),
        description: value.description.trim(),
        attributes: value.attributes,
      };

      try {
        if (product) {
          await onSubmit(normalized);
        } else {
          await onSubmit({ storeId: value.storeId, ...normalized });
        }
      } catch {
        // TanStack Query owns the normalized request error rendered by FormError below.
      }
    },
  });

  const categoryOptions = categories.data ? flattenCategoryTree(categories.data) : [];
  const activeBrands = brands.data?.filter((brand) => brand.status === "active") ?? [];
  const productStore = product ? stores.find((store) => store.id === product.storeId) : undefined;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Basic information</p>
          <h2 className="text-lg font-bold">Listing details</h2>
          <p className="text-sm text-slate-600">Name the Product clearly, use a stable URL slug, and write the customer-facing description.</p>
        </div>

        {!product ? (
          <form.Field name="storeId">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="block text-sm font-medium">
                  Store
                  <select
                    aria-label="Product store"
                    className="mt-1 w-full rounded-md border px-3 py-2"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    <option value="">Choose store</option>
                    {stores
                      .filter((store) => store.status === "active")
                      .map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.defaultCurrency ? `${store.name} · ${store.defaultCurrency}` : store.name}
                        </option>
                      ))}
                  </select>
                  {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
                </label>
              );
            }}
          </form.Field>
        ) : (
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <strong className="block text-slate-900">{productStore?.name ?? "Assigned store"}</strong>
            <span>Store ownership is fixed after creation{productStore?.defaultCurrency ? ` · ${productStore.defaultCurrency}` : ""}.</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="block text-sm font-medium">
                  Product name
                  <input
                    aria-label="Product name"
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

          <form.Field name="slug">
            {(field) => {
              const fieldError = firstFieldError(field.state.meta.errors);
              return (
                <label className="block text-sm font-medium">
                  Product slug
                  <input
                    aria-label="Product slug"
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
        </div>

        <form.Field name="description">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Description
                <textarea
                  aria-label="Product description"
                  className="mt-1 min-h-32 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </section>

      <section className="space-y-4 border-t pt-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Organization</p>
          <h2 className="text-lg font-bold">Category, brand & attributes</h2>
          <p className="text-sm text-slate-600">Choose an admin-approved category and optional brand, then complete the mapped Product attributes. The server revalidates every value.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="categoryId">
            {(field) => (
              <label className="block text-sm font-medium">
                Category
                <select
                  aria-label="Product category"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onChange={(event) => {
                    const categoryId = event.target.value;
                    field.handleChange(categoryId);
                    form.setFieldValue("attributes", []);
                    setSelectedCategoryId(categoryId);
                  }}
                >
                  <option value="">Choose category</option>
                  {categoryOptions
                    .filter((category) => category.status === "active")
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {`${"— ".repeat(category.depth)}${category.label}`}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </form.Field>

          <form.Field name="brandId">
            {(field) => (
              <label className="block text-sm font-medium">
                Brand <span className="font-normal text-slate-500">(optional)</span>
                <select
                  aria-label="Product brand"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">No brand</option>
                  {activeBrands.map((brand) => (
                    <option key={brand.id} value={brand.id}>{brand.name}</option>
                  ))}
                </select>
              </label>
            )}
          </form.Field>
        </div>

        <form.Field name="attributes">
          {(field) =>
            !selectedCategoryId ? (
              <p className="rounded-md border p-3 text-sm text-slate-500">Choose a category to enter Product attributes.</p>
            ) : mappings.isPending || attributes.isPending ? (
              <p className="rounded-md border p-3 text-sm text-slate-500">Loading Product attributes...</p>
            ) : mappings.isError || attributes.isError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Product attributes could not be loaded. Try again before saving.
              </p>
            ) : (
              <ProductAttributeFields
                mappings={mappings.data ?? []}
                attributes={attributes.data ?? []}
                values={field.state.value}
                variantAxis={false}
                onChange={field.handleChange}
              />
            )
          }
        </form.Field>
      </section>

      <div className="sticky bottom-4 z-10 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Lifecycle state is controlled by the separate publication action.</p>
          <Button disabled={isPending || categories.isPending || brands.isPending || attributes.isPending}>
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </div>
        <FormError error={error} />
      </div>
    </form>
  );
}

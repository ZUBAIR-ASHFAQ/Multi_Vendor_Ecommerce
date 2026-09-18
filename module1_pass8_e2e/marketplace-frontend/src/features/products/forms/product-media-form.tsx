import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { productMediaFormSchema } from "../schemas/products.schemas";
import type { ProductVariant, UploadProductMediaInput } from "../types/products.types";

/** Uploads one Product image through the Module 21 signed-upload flow and Module 6 media-link command. */
export function ProductMediaForm({
  productId,
  variants,
  isPending,
  error,
  onSubmit,
}: {
  productId: string;
  variants: ProductVariant[];
  isPending: boolean;
  error: unknown;
  onSubmit: (input: UploadProductMediaInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      file: null as File | null,
      variantId: "",
      altText: "",
      sortOrder: 0,
    },
    validators: { onChange: productMediaFormSchema },
    onSubmit: async ({ value }) => {
      if (!(value.file instanceof File)) return;
      try {
        await onSubmit({
          productId,
          file: value.file,
          variantId: value.variantId || null,
          altText: value.altText.trim() || null,
          sortOrder: value.sortOrder,
        });
        form.reset();
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
      <form.Field name="file">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Image file
              <input
                aria-label="Product media file"
                type="file"
                accept="image/*"
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.files?.[0] ?? null)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="variantId">
          {(field) => (
            <label className="block text-sm font-medium">
              Variant <span className="font-normal text-slate-500">(optional)</span>
              <select
                aria-label="Product media variant"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Product-level media</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>{variant.title} · {variant.sku}</option>
                ))}
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="altText">
          {(field) => (
            <label className="block text-sm font-medium">
              Alt text
              <input
                aria-label="Product media alt text"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>

        <form.Field name="sortOrder">
          {(field) => (
            <label className="block text-sm font-medium">
              Sort order
              <input
                aria-label="Product media sort order"
                type="number"
                min={0}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(Number(event.target.value))}
              />
            </label>
          )}
        </form.Field>
      </div>

      <FormError error={error} />
      <Button disabled={isPending}>{isPending ? "Uploading..." : "Upload and link media"}</Button>
    </form>
  );
}

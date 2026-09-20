import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { brandFormSchema } from "../schemas/catalog-taxonomy.schemas";
import type { CreateBrandInput } from "../types/catalog-taxonomy.types";

/** Creates one brand using only fields accepted by the approved Module 5 command. */
export function BrandForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateBrandInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { slug: "", name: "", status: "active" as const },
    validators: { onChange: brandFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit({
          slug: value.slug.trim().toLowerCase(),
          name: value.name.trim(),
          status: value.status,
        });
        form.reset();
      } catch {
        // TanStack Query owns the safe request error rendered below.
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
      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="name">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Brand name
                <input
                  aria-label="Brand name"
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
                Brand slug
                <input
                  aria-label="Brand slug"
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

        <form.Field name="status">
          {(field) => (
            <label className="block text-sm font-medium">
              Status
              <select
                aria-label="Brand status"
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
      </div>

      <FormError error={error} />
      <Button disabled={isPending}>{isPending ? "Creating..." : "Create brand"}</Button>
    </form>
  );
}

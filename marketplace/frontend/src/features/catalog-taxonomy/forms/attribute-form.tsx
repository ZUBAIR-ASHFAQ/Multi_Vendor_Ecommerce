import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import {
  attributeFormSchema,
  attributeValueLines,
} from "../schemas/catalog-taxonomy.schemas";
import type { CreateAttributeInput } from "../types/catalog-taxonomy.types";

/** Creates one reusable attribute and optional value options without inventing a data-type allow-list. */
export function AttributeForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: CreateAttributeInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      code: "",
      name: "",
      dataType: "",
      isVariantAxis: false,
      status: "active" as const,
      valuesText: "",
    },
    validators: { onChange: attributeFormSchema },
    onSubmit: async ({ value }) => {
      const values = attributeValueLines(value.valuesText);
      try {
        await onSubmit({
          code: value.code.trim().toLowerCase(),
          name: value.name.trim(),
          dataType: value.dataType.trim().toLowerCase(),
          isVariantAxis: value.isVariantAxis,
          status: value.status,
          values: values.map((item, index) => ({
            value: item,
            sortOrder: index,
            status: "active",
          })),
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
                Attribute name
                <input
                  aria-label="Attribute name"
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

        <form.Field name="code">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Attribute code
                <input
                  aria-label="Attribute code"
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

        <form.Field name="dataType">
          {(field) => {
            const fieldError = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Data type
                <input
                  aria-label="Attribute data type"
                  placeholder="text"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Use <code>option</code> for variant-axis attributes. The backend remains authoritative for compatibility.
                </span>
                {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>

      <form.Field name="valuesText">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Allowed values <span className="font-normal text-slate-500">(one per line)</span>
              <textarea
                aria-label="Attribute values"
                className="mt-1 min-h-28 w-full rounded-md border px-3 py-2"
                placeholder={"Small\nMedium\nLarge"}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <div className="flex flex-wrap gap-5">
        <form.Field name="isVariantAxis">
          {(field) => (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                aria-label="Variant axis"
                type="checkbox"
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
              />
              Use as variant axis
            </label>
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Attribute status"
                className="ml-2 rounded-md border px-3 py-2"
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
      <Button disabled={isPending}>{isPending ? "Creating..." : "Create attribute"}</Button>
    </form>
  );
}

import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { categoryEditorFormSchema } from "../schemas/catalog-taxonomy.schemas";
import type {
  Category,
  CategoryOption,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "../types/catalog-taxonomy.types";

type SharedCategoryFormProps = {
  parentOptions: CategoryOption[];
  excludedParentIds?: Set<string>;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
};

type CreateCategoryFormProps = SharedCategoryFormProps & {
  category?: undefined;
  onSubmit: (input: CreateCategoryInput) => Promise<void>;
};

type EditCategoryFormProps = SharedCategoryFormProps & {
  category: Category;
  onSubmit: (input: UpdateCategoryInput) => Promise<void>;
};

type CategoryFormProps = CreateCategoryFormProps | EditCategoryFormProps;

/** Collects category fields while keeping server-owned hierarchy validation authoritative. */
export function CategoryForm(props: CategoryFormProps) {
  const form = useForm({
    defaultValues: {
      parentId: props.category?.parentId ?? "",
      slug: props.category?.slug ?? "",
      name: props.category?.name ?? "",
      status: props.category?.status ?? ("active" as const),
      sortOrder: props.category?.sortOrder ?? 0,
    },
    validators: { onChange: categoryEditorFormSchema },
    onSubmit: async ({ value }) => {
      const input = {
        parentId: value.parentId || null,
        slug: value.slug.trim().toLowerCase(),
        name: value.name.trim(),
        status: value.status,
        sortOrder: value.sortOrder,
      };

      try {
        await props.onSubmit(input);
      } catch {
        // TanStack Query owns the safe request error rendered below.
      }
    },
  });

  const availableParents = props.parentOptions.filter(
    (option) => !props.excludedParentIds?.has(option.id),
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="name">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Category name
                <input
                  aria-label={props.category ? `Category name ${props.category.id}` : "Category name"}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="slug">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="block text-sm font-medium">
                Category slug
                <input
                  aria-label={props.category ? `Category slug ${props.category.id}` : "Category slug"}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="parentId">
          {(field) => (
            <label className="block text-sm font-medium">
              Parent category
              <select
                aria-label={props.category ? `Category parent ${props.category.id}` : "Category parent"}
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                <option value="">Root category</option>
                {availableParents.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${"— ".repeat(option.depth)}${option.label}${option.status === "inactive" ? " (inactive)" : ""}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <label className="block text-sm font-medium">
              Status
              <select
                aria-label={props.category ? `Category status ${props.category.id}` : "Category status"}
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

        <form.Field name="sortOrder">
          {(field) => (
            <label className="block text-sm font-medium">
              Sort order
              <input
                aria-label={props.category ? `Category sort order ${props.category.id}` : "Category sort order"}
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

      <FormError error={props.error} />
      <Button disabled={props.isPending}>
        {props.isPending ? "Saving..." : props.submitLabel}
      </Button>
    </form>
  );
}

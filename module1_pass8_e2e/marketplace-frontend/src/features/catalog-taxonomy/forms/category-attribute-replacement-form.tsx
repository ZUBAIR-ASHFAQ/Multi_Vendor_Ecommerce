import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { firstFieldError, FormError } from "@/features/auth/components/form-error";
import { categoryAttributeReplacementFormSchema } from "../schemas/catalog-taxonomy.schemas";
import type {
  CatalogAttribute,
  CategoryAttributeMapping,
  CategoryOption,
  ReplaceCategoryAttributesInput,
} from "../types/catalog-taxonomy.types";

type MappingDraft = {
  attributeId: string;
  selected: boolean;
  isRequired: boolean;
  isFilterable: boolean;
  sortOrder: number;
};

/** Builds editable rows from the authoritative mapping returned by the server. */
function attributeDrafts(
  attributes: CatalogAttribute[],
  mappings: CategoryAttributeMapping[] = [],
): MappingDraft[] {
  const mappingByAttributeId = new Map(
    mappings.map((mapping) => [mapping.attributeId, mapping]),
  );

  return attributes.map((attribute, index) => {
    const mapping = mappingByAttributeId.get(attribute.id);
    return {
      attributeId: attribute.id,
      selected: Boolean(mapping),
      isRequired: mapping?.isRequired ?? false,
      isFilterable: mapping?.isFilterable ?? false,
      sortOrder: mapping?.sortOrder ?? index,
    };
  });
}

/** Edits one category's complete mapping after first loading the current server state. */
export function CategoryAttributeReplacementForm({
  categories,
  attributes,
  selectedCategoryId,
  mappings,
  isMappingPending,
  mappingError,
  isPending,
  error,
  onCategoryChange,
  onRetryMapping,
  onSubmit,
}: {
  categories: CategoryOption[];
  attributes: CatalogAttribute[];
  selectedCategoryId: string;
  mappings: CategoryAttributeMapping[] | undefined;
  isMappingPending: boolean;
  mappingError: unknown;
  isPending: boolean;
  error: unknown;
  onCategoryChange: (categoryId: string) => void;
  onRetryMapping: () => void;
  onSubmit: (categoryId: string, input: ReplaceCategoryAttributesInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: {
      categoryId: selectedCategoryId,
      attributes: attributeDrafts(attributes),
      confirmReplacement: false,
    },
    validators: { onChange: categoryAttributeReplacementFormSchema },
    onSubmit: async ({ value }) => {
      const input: ReplaceCategoryAttributesInput = {
        attributes: value.attributes
          .filter((mapping) => mapping.selected)
          .map((mapping) => ({
            attributeId: mapping.attributeId,
            isRequired: mapping.isRequired,
            isFilterable: mapping.isFilterable,
            sortOrder: mapping.sortOrder,
          })),
      };

      try {
        await onSubmit(value.categoryId, input);
        form.setFieldValue("confirmReplacement", false);
      } catch {
        // TanStack Query owns the safe request error rendered below.
      }
    },
  });

  const visibleAttributeIds = new Set(attributes.map((attribute) => attribute.id));
  const hiddenMappingCount =
    mappings?.filter((mapping) => !visibleAttributeIds.has(mapping.attributeId)).length ?? 0;
  const canSubmit =
    selectedCategoryId.length > 0 &&
    mappings !== undefined &&
    !isMappingPending &&
    !mappingError &&
    hiddenMappingCount === 0 &&
    attributes.length > 0;

  /** Rehydrates the editable rows whenever the selected category's server mapping changes. */
  useEffect(() => {
    if (!selectedCategoryId || mappings === undefined) return;
    form.setFieldValue("categoryId", selectedCategoryId);
    form.setFieldValue("attributes", attributeDrafts(attributes, mappings));
    form.setFieldValue("confirmReplacement", false);
  }, [attributes, form, mappings, selectedCategoryId]);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="categoryId">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              Category
              <select
                aria-label="Mapping category"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => {
                  const categoryId = event.target.value;
                  field.handleChange(categoryId);
                  form.setFieldValue("attributes", attributeDrafts(attributes));
                  form.setFieldValue("confirmReplacement", false);
                  onCategoryChange(categoryId);
                }}
              >
                <option value="">Choose category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {`${"— ".repeat(category.depth)}${category.label}${category.status === "inactive" ? " (inactive)" : ""}`}
                  </option>
                ))}
              </select>
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      {!selectedCategoryId ? (
        <p className="rounded-md border p-4 text-sm text-slate-500">
          Choose a category to load its current attribute mapping.
        </p>
      ) : isMappingPending ? (
        <p className="rounded-md border p-4 text-sm text-slate-500">
          Loading current category mapping...
        </p>
      ) : mappingError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{mappingError instanceof Error ? mappingError.message : "Current mapping could not be loaded."}</p>
          <Button className="mt-3" type="button" variant="outline" onClick={onRetryMapping}>
            Retry mapping load
          </Button>
        </div>
      ) : hiddenMappingCount > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          This category contains {hiddenMappingCount} mapped attribute{hiddenMappingCount === 1 ? "" : "s"} that
          your current attribute read cannot display. Replacement is disabled so hidden mappings cannot be removed
          accidentally.
        </div>
      ) : null}

      <form.Field name="attributes">
        {(field) => (
          <div className="space-y-3">
            {attributes.length === 0 ? (
              <p className="rounded-md border p-4 text-sm text-slate-500">
                Create at least one reusable attribute before defining category mappings.
              </p>
            ) : (
              attributes.map((attribute, index) => {
                const draft = field.state.value[index];
                if (!draft) return null;

                /** Replaces one draft row while preserving the rest of the complete mapping form. */
                const updateDraft = (next: Partial<MappingDraft>) => {
                  field.handleChange(
                    field.state.value.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...next } : item,
                    ),
                  );
                };

                return (
                  <article key={attribute.id} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          aria-label={`Map attribute ${attribute.name}`}
                          type="checkbox"
                          disabled={!canSubmit}
                          checked={draft.selected}
                          onChange={(event) => updateDraft({ selected: event.target.checked })}
                        />
                        {attribute.name}
                      </label>
                      <span className="text-xs text-slate-500">{attribute.code}</span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          aria-label={`Required ${attribute.name}`}
                          type="checkbox"
                          disabled={!canSubmit || !draft.selected}
                          checked={draft.isRequired}
                          onChange={(event) => updateDraft({ isRequired: event.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          aria-label={`Filterable ${attribute.name}`}
                          type="checkbox"
                          disabled={!canSubmit || !draft.selected}
                          checked={draft.isFilterable}
                          onChange={(event) => updateDraft({ isFilterable: event.target.checked })}
                        />
                        Filterable
                      </label>
                      <label className="text-sm">
                        Sort order
                        <input
                          aria-label={`Mapping sort order ${attribute.name}`}
                          type="number"
                          min={0}
                          disabled={!canSubmit || !draft.selected}
                          className="ml-2 w-24 rounded-md border px-2 py-1"
                          value={draft.sortOrder}
                          onChange={(event) => updateDraft({ sortOrder: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
      </form.Field>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <strong>Full replacement command.</strong> The current server mapping is loaded before editing so unchanged
        mappings are preserved unless you deliberately remove them.
      </div>

      <form.Field name="confirmReplacement">
        {(field) => {
          const fieldError = firstFieldError(field.state.meta.errors);
          return (
            <label className="block text-sm font-medium">
              <span className="flex items-start gap-2">
                <input
                  aria-label="Confirm complete mapping replacement"
                  type="checkbox"
                  disabled={!canSubmit}
                  checked={field.state.value}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
                I understand this replaces the category&apos;s complete attribute mapping.
              </span>
              {fieldError ? <span className="mt-1 block text-xs text-red-600">{fieldError}</span> : null}
            </label>
          );
        }}
      </form.Field>

      <FormError error={error} />
      <Button disabled={!canSubmit || isPending}>
        {isPending ? "Replacing..." : "Replace category mapping"}
      </Button>
    </form>
  );
}

import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { CatalogTaxonomyLayout, RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { CategoryTreeEditor, flattenCategoryTree } from "../components/category-tree";
import { CategoryForm } from "../forms/category-form";
import { useCategoriesQuery, useCreateCategoryMutation } from "../hooks/use-catalog-taxonomy";
import type { CreateCategoryInput } from "../types/catalog-taxonomy.types";

/** Loads the admin category hierarchy and exposes controlled create/edit workflows. */
function AdminCategoriesContent() {
  const categories = useCategoriesQuery();
  const create = useCreateCategoryMutation();

  /** Creates one category and leaves hierarchy-cycle validation authoritative on the backend. */
  async function createCategory(input: CreateCategoryInput): Promise<void> {
    await create.mutateAsync(input);
  }

  if (categories.isPending) return <LoadingState label="Loading category hierarchy..." />;
  if (categories.isError) {
    return (
      <ErrorState
        title="Categories could not be loaded"
        message={categories.error instanceof Error ? categories.error.message : "Please try again."}
        onRetry={() => void categories.refetch()}
      />
    );
  }

  const parentOptions = flattenCategoryTree(categories.data);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalog · Categories"
        title="Category hierarchy"
        description="Maintain the marketplace category tree without flattening parent/child relationships. Cycle prevention and hierarchy validation remain server-authoritative."
      />

      <Surface>
        <SectionHeader
          title="Create category"
          description="Add a root category or place a new node under an existing category."
        />
        <div className="mt-5">
          <CategoryForm
            parentOptions={parentOptions}
            submitLabel="Create category"
            isPending={create.isPending}
            error={create.error}
            onSubmit={createCategory}
          />
        </div>
      </Surface>

      <Surface>
        <SectionHeader
          title="Category tree"
          description={`${parentOptions.length} categor${parentOptions.length === 1 ? "y" : "ies"} in the current hierarchy.`}
        />
        <div className="mt-5">
          {categories.data.length === 0 ? (
            <EmptyState
              title="No categories exist yet."
              description="Create the first root category above to begin the hierarchy."
            />
          ) : (
            <CategoryTreeEditor nodes={categories.data} />
          )}
        </div>
      </Surface>
    </div>
  );
}

/** Protects the category editor with the required manage-categories permission. */
export function AdminCategoriesPage() {
  return (
    <CatalogTaxonomyLayout>
      {(user) => (
        <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.MANAGE_CATEGORIES}>
          <AdminCategoriesContent />
        </RequireCatalogPermission>
      )}
    </CatalogTaxonomyLayout>
  );
}

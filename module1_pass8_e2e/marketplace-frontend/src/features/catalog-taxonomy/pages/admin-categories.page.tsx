import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
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
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Category tree editor</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create hierarchy nodes, change parent relationships, ordering, and active/inactive state.
          The API remains authoritative for cycle prevention.
        </p>
        <div className="mt-5">
          <CategoryForm
            parentOptions={parentOptions}
            submitLabel="Create category"
            isPending={create.isPending}
            error={create.error}
            onSubmit={createCategory}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Category hierarchy</h2>
        {categories.data.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
            No categories exist yet.
          </p>
        ) : (
          <CategoryTreeEditor nodes={categories.data} />
        )}
      </section>
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

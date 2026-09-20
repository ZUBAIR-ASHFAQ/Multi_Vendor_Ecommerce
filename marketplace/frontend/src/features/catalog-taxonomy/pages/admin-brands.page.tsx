import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { CatalogTaxonomyLayout, RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { BrandForm } from "../forms/brand-form";
import { useBrandsQuery, useCreateBrandMutation } from "../hooks/use-catalog-taxonomy";
import type { CreateBrandInput } from "../types/catalog-taxonomy.types";

/** Loads brands and exposes the approved create-only brand administration workflow. */
function AdminBrandsContent() {
  const brands = useBrandsQuery();
  const create = useCreateBrandMutation();

  /** Creates one brand through the approved Module 5 command. */
  async function createBrand(input: CreateBrandInput): Promise<void> {
    await create.mutateAsync(input);
  }

  if (brands.isPending) return <LoadingState label="Loading brands..." />;
  if (brands.isError) {
    return (
      <ErrorState
        title="Brands could not be loaded"
        message={brands.error instanceof Error ? brands.error.message : "Please try again."}
        onRetry={() => void brands.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Brand manager</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create normalized brand definitions. The current approved API does not define brand
          update/delete routes, so this screen does not invent them.
        </p>
        <div className="mt-5">
          <BrandForm isPending={create.isPending} error={create.error} onSubmit={createBrand} />
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Brands</h2>
        {brands.data.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No brands exist yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="pb-2">Name</th><th className="pb-2">Slug</th><th className="pb-2">Status</th></tr></thead>
              <tbody>
                {brands.data.map((brand) => (
                  <tr key={brand.id} className="border-t">
                    <td className="py-3 font-medium">{brand.name}</td>
                    <td className="py-3 text-slate-600">{brand.slug}</td>
                    <td className="py-3">{brand.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Protects brand administration with the required manage-brands permission. */
export function AdminBrandsPage() {
  return (
    <CatalogTaxonomyLayout>
      {(user) => (
        <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.MANAGE_BRANDS}>
          <AdminBrandsContent />
        </RequireCatalogPermission>
      )}
    </CatalogTaxonomyLayout>
  );
}

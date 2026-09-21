import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalog · Brands"
        title="Brands"
        description="Create normalized marketplace brand definitions using the existing create-only catalog contract."
      />

      <Surface>
        <SectionHeader
          title="Create brand"
          description="The current API does not expose brand update or delete commands, so this screen intentionally does not invent them."
        />
        <div className="mt-5">
          <BrandForm isPending={create.isPending} error={create.error} onSubmit={createBrand} />
        </div>
      </Surface>

      <Surface padding="none" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4 md:px-6">
          <SectionHeader title="Brand directory" description={`${brands.data.length} brand${brands.data.length === 1 ? "" : "s"} currently visible.`} />
        </div>
        {brands.data.length === 0 ? (
          <div className="p-5 md:p-6">
            <EmptyState title="No brands exist yet." description="Create the first brand above to populate the catalog directory." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Slug</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {brands.data.map((brand) => (
                  <tr key={brand.id} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-3 font-medium text-foreground">{brand.name}</td>
                    <td className="px-4 py-3 text-foreground-muted">/{brand.slug}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={brand.status === "active" ? "positive" : "neutral"}>{brand.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
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

import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { CatalogTaxonomyLayout, RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { flattenCategoryTree } from "../components/category-tree";
import { CategoryAttributeReplacementForm } from "../forms/category-attribute-replacement-form";
import {
  useAttributesQuery,
  useCategoriesQuery,
  useCategoryAttributesQuery,
  useReplaceCategoryAttributesMutation,
} from "../hooks/use-catalog-taxonomy";
import type { ReplaceCategoryAttributesInput } from "../types/catalog-taxonomy.types";

/** Loads taxonomy sources plus the selected category's authoritative mapping for safe editing. */
function AdminCategoryAttributesContent() {
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const categories = useCategoriesQuery();
  const attributes = useAttributesQuery();
  const mappings = useCategoryAttributesQuery(
    selectedCategoryId,
    selectedCategoryId.length > 0,
  );
  const replace = useReplaceCategoryAttributesMutation();

  /** Sends one deliberate complete category mapping to the approved PUT command. */
  async function replaceMapping(
    categoryId: string,
    input: ReplaceCategoryAttributesInput,
  ): Promise<void> {
    await replace.mutateAsync({ categoryId, input });
  }

  if (categories.isPending || attributes.isPending) {
    return <LoadingState label="Loading category mapping sources..." />;
  }
  if (categories.isError || attributes.isError) {
    const error = categories.error ?? attributes.error;
    return (
      <ErrorState
        title="Category mapping sources could not be loaded"
        message={error instanceof Error ? error.message : "Please try again."}
        onRetry={() => {
          void categories.refetch();
          void attributes.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalog · Category mapping"
        title="Category attribute mapping"
        description="Review the current mapping, edit the complete desired state, and submit one deliberate replacement command."
      />

      <Surface>
        <SectionHeader
          title="Mapping editor"
          description="Category hierarchy and reusable attribute definitions remain sourced from the existing catalog APIs."
        />
        <div className="mt-5">
          <CategoryAttributeReplacementForm
            categories={flattenCategoryTree(categories.data)}
            attributes={attributes.data}
            selectedCategoryId={selectedCategoryId}
            mappings={mappings.data}
            isMappingPending={mappings.isPending && selectedCategoryId.length > 0}
            mappingError={mappings.error}
            isPending={replace.isPending}
            error={replace.error}
            onCategoryChange={setSelectedCategoryId}
            onRetryMapping={() => void mappings.refetch()}
            onSubmit={replaceMapping}
          />
        </div>
      </Surface>

      {replace.data ? (
        <Surface>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Last accepted replacement</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                Server returned {replace.data.length} mapped attribute{replace.data.length === 1 ? "" : "s"}.
              </p>
            </div>
            <StatusPill tone="positive">Saved</StatusPill>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}

/** Protects category mapping replacement with the required manage-categories permission. */
export function AdminCategoryAttributesPage() {
  return (
    <CatalogTaxonomyLayout>
      {(user) => (
        <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.MANAGE_CATEGORIES}>
          <AdminCategoryAttributesContent />
        </RequireCatalogPermission>
      )}
    </CatalogTaxonomyLayout>
  );
}

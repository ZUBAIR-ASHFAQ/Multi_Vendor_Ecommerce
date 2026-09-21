import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { CatalogTaxonomyLayout, RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { AttributeForm } from "../forms/attribute-form";
import { useAttributesQuery, useCreateAttributeMutation } from "../hooks/use-catalog-taxonomy";
import type { CreateAttributeInput } from "../types/catalog-taxonomy.types";

/** Loads reusable attributes and exposes the approved create workflow. */
function AdminAttributesContent() {
  const attributes = useAttributesQuery();
  const create = useCreateAttributeMutation();

  /** Creates one attribute definition and its optional allowed values. */
  async function createAttribute(input: CreateAttributeInput): Promise<void> {
    await create.mutateAsync(input);
  }

  if (attributes.isPending) return <LoadingState label="Loading attributes..." />;
  if (attributes.isError) {
    return (
      <ErrorState
        title="Attributes could not be loaded"
        message={attributes.error instanceof Error ? attributes.error.message : "Please try again."}
        onRetry={() => void attributes.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalog · Attributes"
        title="Attributes"
        description="Define reusable product attributes and allowed values while keeping data-type and variant-axis compatibility server-authoritative."
      />

      <Surface>
        <SectionHeader title="Create attribute" description="Create one reusable definition and its optional fixed values." />
        <div className="mt-5">
          <AttributeForm isPending={create.isPending} error={create.error} onSubmit={createAttribute} />
        </div>
      </Surface>

      <div className="space-y-3">
        <SectionHeader title="Attribute definitions" description={`${attributes.data.length} reusable definition${attributes.data.length === 1 ? "" : "s"}.`} />
        {attributes.data.length === 0 ? (
          <EmptyState title="No attributes exist yet." description="Create the first attribute above to make it available for category mapping." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {attributes.data.map((attribute) => (
              <Surface key={attribute.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">{attribute.name}</h3>
                    <p className="mt-1 text-xs text-foreground-muted">{attribute.code} · {attribute.dataType}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={attribute.status === "active" ? "positive" : "neutral"}>{attribute.status}</StatusPill>
                    <StatusPill tone={attribute.isVariantAxis ? "info" : "neutral"}>
                      {attribute.isVariantAxis ? "Variant axis" : "Reusable"}
                    </StatusPill>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {attribute.values.length === 0 ? (
                    <span className="text-sm text-foreground-muted">No fixed values</span>
                  ) : (
                    attribute.values.map((value) => (
                      <span key={value.id} className="rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-foreground">
                        {value.value}
                      </span>
                    ))
                  )}
                </div>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Protects attribute administration with the required manage-attributes permission. */
export function AdminAttributesPage() {
  return (
    <CatalogTaxonomyLayout>
      {(user) => (
        <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.MANAGE_ATTRIBUTES}>
          <AdminAttributesContent />
        </RequireCatalogPermission>
      )}
    </CatalogTaxonomyLayout>
  );
}

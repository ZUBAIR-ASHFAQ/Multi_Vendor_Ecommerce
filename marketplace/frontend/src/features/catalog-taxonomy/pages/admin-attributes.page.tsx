import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
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
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Attribute manager</h1>
        <p className="mt-1 text-sm text-slate-600">
          Define reusable attributes and allowed values. Data-type compatibility remains
          server-authoritative because the guide does not enumerate concrete type tokens.
        </p>
        <div className="mt-5">
          <AttributeForm isPending={create.isPending} error={create.error} onSubmit={createAttribute} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Attribute definitions</h2>
        {attributes.data.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No attributes exist yet.</p>
        ) : (
          attributes.data.map((attribute) => (
            <article key={attribute.id} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{attribute.name}</h3>
                  <p className="text-xs text-slate-500">{attribute.code} · {attribute.dataType}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>{attribute.status}</p>
                  <p>{attribute.isVariantAxis ? "Variant axis" : "Reusable attribute"}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {attribute.values.length === 0 ? (
                  <span className="text-sm text-slate-500">No fixed values</span>
                ) : (
                  attribute.values.map((value) => (
                    <span key={value.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                      {value.value}
                    </span>
                  ))
                )}
              </div>
            </article>
          ))
        )}
      </section>
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

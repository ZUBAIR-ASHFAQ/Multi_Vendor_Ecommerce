import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { SellerLayout } from "@/features/sellers/components/seller-layout";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { flattenCategoryTree } from "../components/category-tree";
import { TaxonomySelector } from "../components/taxonomy-selector";
import {
  useAttributesQuery,
  useBrandsQuery,
  useCategoriesQuery,
  useCategoryAttributesQuery,
} from "../hooks/use-catalog-taxonomy";

/** Provides a read-only reference for the admin-managed taxonomy available to products. */
function SellerTaxonomySelectorContent() {
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const categories = useCategoriesQuery();
  const brands = useBrandsQuery();
  const attributes = useAttributesQuery();
  const mappings = useCategoryAttributesQuery(
    selectedCategoryId,
    selectedCategoryId.length > 0,
  );

  if (categories.isPending || brands.isPending || attributes.isPending) {
    return <LoadingState label="Loading seller taxonomy..." />;
  }
  if (categories.isError || brands.isError || attributes.isError) {
    const error = categories.error ?? brands.error ?? attributes.error;
    return (
      <ErrorState
        title="Taxonomy could not be loaded"
        message={error instanceof Error ? error.message : "Please try again."}
        onRetry={() => {
          void categories.refetch();
          void brands.refetch();
          void attributes.refetch();
        }}
      />
    );
  }

  const parentOptions = flattenCategoryTree(categories.data);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Product setup</p>
        <h1 className="mt-1 text-2xl font-bold">Approved catalog reference</h1>
        <p className="mt-1 text-sm text-slate-600">
          Categories, subcategories, brands, attributes, and their mappings are created by marketplace
          administrators. Sellers can only select active options while creating or editing a product.
        </p>
        <div className="mt-4">
          <Button asChild><Link to="/seller/products/new">Add product</Link></Button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Preview available product taxonomy</h2>
        <p className="mt-1 text-sm text-slate-600">
          Review the active category, optional brand, and administrator-mapped attributes available to product drafts.
        </p>
        <div className="mt-5">
          <TaxonomySelector
            categories={parentOptions}
            brands={brands.data}
            attributes={attributes.data}
            mappings={mappings.data ?? []}
            isMappingPending={mappings.isPending && selectedCategoryId.length > 0}
            mappingError={mappings.error}
            onCategoryChange={setSelectedCategoryId}
            onRetryMapping={() => void mappings.refetch()}
          />
        </div>
      </section>
    </div>
  );
}

/** Protects seller taxonomy with seller workspace layout plus server-derived catalog permissions. */
export function SellerTaxonomySelectorPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.READ}>
          <SellerTaxonomySelectorContent />
        </RequireCatalogPermission>
      )}
    </SellerLayout>
  );
}

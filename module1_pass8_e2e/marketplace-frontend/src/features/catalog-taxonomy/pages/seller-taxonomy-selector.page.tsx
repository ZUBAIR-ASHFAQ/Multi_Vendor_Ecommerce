import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CATALOG_PERMISSION } from "../catalog-taxonomy.constants";
import { CatalogTaxonomyLayout, RequireCatalogPermission } from "../components/catalog-taxonomy-layout";
import { flattenCategoryTree } from "../components/category-tree";
import { TaxonomySelector } from "../components/taxonomy-selector";
import {
  useAttributesQuery,
  useBrandsQuery,
  useCategoriesQuery,
  useCategoryAttributesQuery,
} from "../hooks/use-catalog-taxonomy";

/** Loads active seller-readable taxonomy and the selected category's allowed attribute mapping. */
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

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-bold">Seller taxonomy selector</h1>
      <p className="mt-1 text-sm text-slate-600">
        Choose an active category and brand, then use only the attributes mapped to that category.
      </p>
      <div className="mt-5">
        <TaxonomySelector
          categories={flattenCategoryTree(categories.data)}
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
  );
}

/** Protects the seller selector with seller account type plus catalog.read. */
export function SellerTaxonomySelectorPage() {
  return (
    <CatalogTaxonomyLayout>
      {(user) => {
        if (user.accountType !== "seller") {
          return <ErrorState title="Seller account required" message="This taxonomy selector is reserved for seller product workflows." />;
        }
        return (
          <RequireCatalogPermission user={user} permission={CATALOG_PERMISSION.READ}>
            <SellerTaxonomySelectorContent />
          </RequireCatalogPermission>
        );
      }}
    </CatalogTaxonomyLayout>
  );
}

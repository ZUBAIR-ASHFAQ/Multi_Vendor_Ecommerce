import { useNavigate } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { SellerLayout, RequireSellerPermission } from "@/features/sellers/components/seller-layout";
import { useMySellerQuery } from "@/features/sellers/hooks/use-sellers";
import { ProductForm } from "../forms/product-form";
import { useCreateProductMutation } from "../hooks/use-products";
import { PRODUCT_PERMISSION } from "../products.constants";
import type { CreateProductInput, UpdateProductInput } from "../types/products.types";

/** Builds readable store choices from Module 4 data or the authenticated store scope as a fallback. */
function storeOptions(
  scopedStoreIds: string[],
  stores: Array<{ id: string; name: string; status: string; defaultCurrency: string }> | undefined,
) {
  if (stores && stores.length > 0) return stores;
  return scopedStoreIds.map((id) => ({
    id,
    name: `Store ${id.slice(0, 8)}`,
    status: "active",
    defaultCurrency: "",
  }));
}

/** Creates one draft Product, then moves the seller into the Product edit workflow. */
export function SellerProductCreatePage() {
  const navigate = useNavigate();

  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={PRODUCT_PERMISSION.SELLER_CREATE}>
          <SellerProductCreateContent
            storeIds={user.scopes.storeIds}
            canReadSellerProfile={user.permissions.includes("seller.profile.read")}
            onCreated={(productId) => navigate({ to: "/seller/products/$productId", params: { productId } })}
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

/** Owns the Product create form and optional Module 4 store-name lookup. */
function SellerProductCreateContent({
  storeIds,
  canReadSellerProfile,
  onCreated,
}: {
  storeIds: string[];
  canReadSellerProfile: boolean;
  onCreated: (productId: string) => void;
}) {
  const seller = useMySellerQuery(canReadSellerProfile);
  const create = useCreateProductMutation();

  if (canReadSellerProfile && seller.isPending) return <LoadingState label="Loading seller stores..." />;
  if (canReadSellerProfile && seller.isError) {
    return (
      <ErrorState
        title="Seller stores could not be loaded"
        message={seller.error instanceof Error ? seller.error.message : "Please try again."}
        onRetry={() => void seller.refetch()}
      />
    );
  }

  const stores = storeOptions(storeIds, seller.data?.stores);
  if (stores.length === 0) {
    return (
      <ErrorState
        title="No store scope available"
        message="A Product must be created inside one seller store. Ask a seller owner or administrator to assign store access."
      />
    );
  }

  /** Sends only the create contract and opens the returned Product after the transaction commits. */
  async function createProduct(input: CreateProductInput | UpdateProductInput): Promise<void> {
    if (!("storeId" in input)) return;
    const product = await create.mutateAsync(input);
    onCreated(product.id);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog</p>
        <h1 className="mt-1 text-2xl font-bold">Create Product</h1>
        <p className="mt-1 text-sm text-slate-600">
          Start with the listing information and organization. The Product remains a draft until variants, media, inventory, and publication are ready.
        </p>
      </section>
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <ProductForm
          stores={stores}
          submitLabel="Create draft Product"
          isPending={create.isPending}
          error={create.error}
          onSubmit={createProduct}
        />
      </section>
    </div>
  );
}

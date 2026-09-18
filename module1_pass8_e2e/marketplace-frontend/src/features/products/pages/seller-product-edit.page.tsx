import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormError } from "@/features/auth/components/form-error";
import { DOCUMENT_AUDIT_PERMISSION } from "@/features/documents-audit/documents-audit.constants";
import { SellerLayout, RequireSellerPermission } from "@/features/sellers/components/seller-layout";
import { useMySellerQuery } from "@/features/sellers/hooks/use-sellers";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ProductStatusBadge } from "../components/product-status-badge";
import { ProductForm } from "../forms/product-form";
import { ProductMediaForm } from "../forms/product-media-form";
import { ProductVariantForm } from "../forms/product-variant-form";
import {
  useAddProductVariantMutation,
  usePublishProductMutation,
  useSellerProductQuery,
  useUnpublishProductMutation,
  useUpdateProductMutation,
  useUpdateProductVariantMutation,
  useUploadProductMediaMutation,
} from "../hooks/use-products";
import { PRODUCT_PERMISSION, PRODUCT_PUBLICATION_STATUS } from "../products.constants";
import type {
  CreateProductInput,
  CreateProductVariantInput,
  ProductDetail,
  ProductVariant,
  UpdateProductInput,
  UpdateProductVariantInput,
  UploadProductMediaInput,
} from "../types/products.types";

/** Renders one variant with a simple inline editor and immutable price-history-safe update command. */
function VariantEditor({
  product,
  variant,
  defaultCurrency,
  canManageInventory,
}: {
  product: ProductDetail;
  variant: ProductVariant;
  defaultCurrency: string;
  canManageInventory: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateProductVariantMutation(product.id, variant.id);

  /** Sends the update contract and closes the editor after the server accepts it. */
  async function saveVariant(input: CreateProductVariantInput | UpdateProductVariantInput): Promise<void> {
    await update.mutateAsync(input);
    setEditing(false);
  }

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{variant.title}</h3>
          <p className="text-xs text-slate-500">SKU {variant.sku} · {variant.status}</p>
          <p className="mt-2 font-bold">{formatMoney(variant.price, variant.currency)}</p>
        </div>
        <div className="flex gap-2">
          {canManageInventory ? (
            <Button size="sm" variant="outline" asChild>
              <Link
                to="/seller/inventory/$variantId/manage"
                params={{ variantId: variant.id }}
              >
                Manage inventory
              </Link>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
            {editing ? "Close editor" : "Edit variant"}
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="mt-4 border-t pt-4">
          <ProductVariantForm
            product={product}
            variant={variant}
            defaultCurrency={defaultCurrency}
            submitLabel="Save variant"
            isPending={update.isPending}
            error={update.error}
            onSubmit={saveVariant}
          />
        </div>
      ) : null}
    </article>
  );
}

/** Renders explicit publish/unpublish commands without allowing arbitrary lifecycle editing. */
function PublicationPanel({ product }: { product: ProductDetail }) {
  const publish = usePublishProductMutation(product.id);
  const unpublish = useUnpublishProductMutation(product.id);
  const canPublish =
    product.publicationStatus === PRODUCT_PUBLICATION_STATUS.DRAFT ||
    product.publicationStatus === PRODUCT_PUBLICATION_STATUS.UNPUBLISHED;
  const canUnpublish =
    product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PUBLISHED ||
    product.publicationStatus === PRODUCT_PUBLICATION_STATUS.PENDING_APPROVAL;

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Publication</h2>
          <div className="mt-2"><ProductStatusBadge status={product.publicationStatus} /></div>
          <p className="mt-2 text-sm text-slate-600">
            Publish revalidates seller/store eligibility, active variants, supported currency, and required taxonomy on the server.
          </p>
        </div>
        <div className="flex gap-2">
          {canPublish ? (
            <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? "Publishing..." : "Publish / submit"}
            </Button>
          ) : null}
          {canUnpublish ? (
            <Button variant="outline" disabled={unpublish.isPending} onClick={() => unpublish.mutate()}>
              {unpublish.isPending ? "Unpublishing..." : "Unpublish"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-2"><FormError error={publish.error} /><FormError error={unpublish.error} /></div>
    </section>
  );
}

/** Loads and renders the complete seller Product editing workflow. */
function SellerProductEditContent({
  productId,
  canUpdate,
  canPublish,
  canUploadMedia,
  canReadSellerProfile,
  canManageInventory,
}: {
  productId: string;
  canUpdate: boolean;
  canPublish: boolean;
  canUploadMedia: boolean;
  canReadSellerProfile: boolean;
  canManageInventory: boolean;
}) {
  const product = useSellerProductQuery(productId);
  const seller = useMySellerQuery(canReadSellerProfile);
  const update = useUpdateProductMutation(productId);
  const addVariant = useAddProductVariantMutation(productId);
  const uploadMedia = useUploadProductMediaMutation();

  if (product.isPending) return <LoadingState label="Loading Product..." />;
  if (product.isError) {
    return (
      <ErrorState
        title="Product could not be loaded"
        message={product.error instanceof Error ? product.error.message : "Please try again."}
        onRetry={() => void product.refetch()}
      />
    );
  }

  const store = seller.data?.stores.find((entry) => entry.id === product.data.storeId);
  const defaultCurrency = store?.defaultCurrency ?? product.data.variants[0]?.currency ?? "USD";
  const storeOptions = store
    ? [store]
    : [{ id: product.data.storeId, name: `Store ${product.data.storeId.slice(0, 8)}`, status: "active", defaultCurrency }];

  /** Sends editable Product fields while preserving command-owned lifecycle state. */
  async function saveProduct(input: CreateProductInput | UpdateProductInput): Promise<void> {
    if ("storeId" in input) return;
    await update.mutateAsync(input);
  }

  /** Adds one new SKU/variant to the current Product. */
  async function addProductVariant(input: CreateProductVariantInput | UpdateProductVariantInput): Promise<void> {
    await addVariant.mutateAsync(input as CreateProductVariantInput);
  }

  /** Completes the signed upload and Product media-link workflow. */
  async function addProductMedia(input: UploadProductMediaInput): Promise<void> {
    await uploadMedia.mutateAsync(input);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{product.data.name}</h1>
              <ProductStatusBadge status={product.data.status} />
              <ProductStatusBadge status={product.data.publicationStatus} />
            </div>
            <p className="mt-1 text-sm text-slate-500">/{product.data.slug}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild><Link to="/seller/products">Back to Products</Link></Button>
            {product.data.publicationStatus === "published" ? (
              <Button variant="outline" asChild><Link to="/products/$slug" params={{ slug: product.data.slug }}>Public view</Link></Button>
            ) : null}
          </div>
        </div>
      </section>

      {canUpdate ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Edit Product</h2>
          <div className="mt-5">
            <ProductForm
              stores={storeOptions}
              product={product.data}
              submitLabel="Save Product"
              isPending={update.isPending}
              error={update.error}
              onSubmit={saveProduct}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Variants / SKUs</h2>
        <p className="mt-1 text-sm text-slate-600">Inventory quantities are intentionally not edited here; Module 7 owns stock.</p>
        {canUpdate ? (
          <div className="mt-5 rounded-lg border bg-slate-50 p-4">
            <h3 className="font-semibold">Add variant</h3>
            <div className="mt-4">
              <ProductVariantForm
                product={product.data}
                defaultCurrency={defaultCurrency}
                submitLabel="Add variant"
                isPending={addVariant.isPending}
                error={addVariant.error}
                onSubmit={addProductVariant}
              />
            </div>
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          {product.data.variants.length === 0 ? (
            <p className="rounded-md border p-3 text-sm text-slate-500">No variants have been created yet.</p>
          ) : product.data.variants.map((variant) =>
            canUpdate ? (
              <VariantEditor
                key={variant.id}
                product={product.data}
                variant={variant}
                defaultCurrency={defaultCurrency}
                canManageInventory={canManageInventory}
              />
            ) : (
              <article key={variant.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
                <div>
                  <strong>{variant.title}</strong>
                  <span className="block text-xs text-slate-500">{variant.sku} · {variant.status}</span>
                </div>
                {canManageInventory ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to="/seller/inventory/$variantId/manage"
                      params={{ variantId: variant.id }}
                    >
                      Manage inventory
                    </Link>
                  </Button>
                ) : null}
              </article>
            ),
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Media manager</h2>
        <p className="mt-1 text-sm text-slate-600">
          Media is uploaded through short-lived Module 21 signed URLs, then linked to this Product.
        </p>
        {canUploadMedia ? (
          <div className="mt-5">
            <ProductMediaForm
              productId={product.data.id}
              variants={product.data.variants}
              isPending={uploadMedia.isPending}
              error={uploadMedia.error}
              onSubmit={addProductMedia}
            />
          </div>
        ) : canUpdate ? (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            Media upload needs seller.products.update plus documents.upload and documents.read permissions.
          </p>
        ) : null}
        <ul className="mt-4 space-y-2">
          {product.data.media.length === 0 ? (
            <li className="rounded-md border p-3 text-sm text-slate-500">No media has been linked yet.</li>
          ) : product.data.media
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((media) => (
                <li key={media.id} className="rounded-md border p-3 text-sm">
                  <strong>{media.altText ?? "Product media"}</strong>
                  <span className="block text-xs text-slate-500">{media.mediaType} · file {media.fileId} · sort {media.sortOrder}</span>
                </li>
              ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Pricing history</h2>
        <p className="mt-1 text-sm text-slate-600">History is append-only. Product edits never rewrite old prices.</p>
        {product.data.priceHistory?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Variant</th>
                  <th className="px-3 py-2">Old</th>
                  <th className="px-3 py-2">New</th>
                  <th className="px-3 py-2">Changed</th>
                </tr>
              </thead>
              <tbody>
                {product.data.priceHistory.map((entry) => {
                  const variant = product.data.variants.find((item) => item.id === entry.variantId);
                  const currency = variant?.currency ?? defaultCurrency;
                  return (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{variant?.sku ?? entry.variantId}</td>
                      <td className="px-3 py-2">{formatMoney(entry.oldPrice, currency)}</td>
                      <td className="px-3 py-2">{formatMoney(entry.newPrice, currency)}</td>
                      <td className="px-3 py-2">{formatDateTime(entry.changedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-md border p-3 text-sm text-slate-500">No price changes have been recorded yet.</p>
        )}
      </section>

      {canPublish ? <PublicationPanel product={product.data} /> : null}
    </div>
  );
}

/** Protects Product edit/detail with seller read permission and derives optional write capabilities from server permissions. */
export function SellerProductEditPage() {
  const { productId } = useParams({ strict: false }) as { productId: string };

  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={PRODUCT_PERMISSION.SELLER_READ}>
          <SellerProductEditContent
            productId={productId}
            canUpdate={user.permissions.includes(PRODUCT_PERMISSION.SELLER_UPDATE)}
            canPublish={user.permissions.includes(PRODUCT_PERMISSION.SELLER_PUBLISH)}
            canUploadMedia={
              user.permissions.includes(PRODUCT_PERMISSION.SELLER_UPDATE) &&
              user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD) &&
              user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ)
            }
            canReadSellerProfile={user.permissions.includes("seller.profile.read")}
            canManageInventory={user.permissions.includes("inventory.adjust")}
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

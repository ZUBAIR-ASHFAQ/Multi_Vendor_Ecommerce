import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { DOCUMENT_AUDIT_PERMISSION } from "@/features/documents-audit/documents-audit.constants";
import { SellerLayout, RequireSellerPermission } from "../components/seller-layout";
import { StoreLogoUpload } from "../components/store-logo-upload";
import { StoreForm } from "../forms/store-form";
import { useCreateStoreMutation, useMySellerQuery, useUpdateStoreMutation } from "../hooks/use-sellers";
import { SELLER_PERMISSION } from "../sellers.constants";
import type { CreateStoreInput, SellerStore, UpdateStoreInput } from "../types/sellers.types";

/** Renders one seller-owned store with safe active/inactive editing and admin-suspension awareness. */
function StoreEditor({ store, canManageAssets }: { store: SellerStore; canManageAssets: boolean }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateStoreMutation(store.id);
  const isSuspended = store.status === "suspended";

  /** Saves editable store fields and seller-controlled lifecycle status through one scoped command. */
  async function saveStore(input: UpdateStoreInput): Promise<void> {
    await update.mutateAsync(input);
    setEditing(false);
  }

  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{store.name}</h2>
          <p className="text-sm text-slate-600">/{store.slug} · {store.status}</p>
          <p className="mt-1 text-xs text-slate-500">Currency: {store.defaultCurrency}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isSuspended}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Close editor" : "Edit store"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/stores/$slug" params={{ slug: store.slug }}>Public view</Link>
          </Button>
        </div>
      </div>
      {isSuspended ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          This store is suspended by an administrator. Seller edits remain blocked until the platform resolves the suspension.
        </p>
      ) : null}
      {editing ? (
        <div className="mt-5">
          <StoreForm
            store={store}
            submitLabel="Save store"
            isPending={update.isPending}
            error={update.error}
            onSubmit={saveStore}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">{store.description ?? "No store description yet."}</p>
      )}
      {canManageAssets && !isSuspended ? (
        <div className="mt-5">
          <StoreLogoUpload store={store} />
        </div>
      ) : null}
    </article>
  );
}

/** Loads seller stores and provides the create/update/store-asset workflows. */
function SellerStoresContent({ canManageAssets }: { canManageAssets: boolean }) {
  const seller = useMySellerQuery();
  const create = useCreateStoreMutation();

  /** Creates one store through the current seller scope. */
  async function createStore(input: CreateStoreInput): Promise<void> {
    await create.mutateAsync(input);
  }

  if (seller.isPending) return <LoadingState label="Loading seller stores..." />;
  if (seller.isError) {
    return (
      <ErrorState
        title="Stores could not be loaded"
        message={seller.error instanceof Error ? seller.error.message : "Please try again."}
        onRetry={() => void seller.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Store setup</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create stores with a supported marketplace currency. Existing stores can be activated or
          deactivated here; admin suspension stays protected.
        </p>
        <div className="mt-5">
          <StoreForm
            submitLabel="Create store"
            isPending={create.isPending}
            error={create.error}
            onSubmit={createStore}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">My stores</h2>
        {seller.data.stores.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No stores have been created yet.</p>
        ) : (
          seller.data.stores.map((store) => (
            <StoreEditor key={store.id} store={store} canManageAssets={canManageAssets} />
          ))
        )}
      </section>
    </div>
  );
}

/** Protects store setup with the seller store-management permission. */
export function SellerStoresPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={SELLER_PERMISSION.STORE_MANAGE}>
          <SellerStoresContent
            canManageAssets={
              user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD) &&
              user.permissions.includes(DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK)
            }
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

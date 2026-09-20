import { useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { StoreReviewsSection } from "@/features/reviews/components/public-reviews-section";
import { usePublicStoreQuery } from "../hooks/use-sellers";

/** Loads and renders only the public-safe store projection returned by Module 4. */
export function PublicStorePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const store = usePublicStoreQuery(slug);

  if (store.isPending) return <LoadingState label="Loading store..." />;
  if (store.isError) {
    return (
      <ErrorState
        title="Store unavailable"
        message={store.error instanceof Error ? store.error.message : "The store could not be loaded."}
        onRetry={() => void store.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <article className="rounded-xl border bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Storefront</p>
      <h1 className="mt-1 text-3xl font-bold">{store.data.name}</h1>
      <p className="mt-1 text-sm text-slate-500">Sold by {store.data.seller.displayName}</p>
      <p className="mt-5 leading-7 text-slate-700">{store.data.description ?? "This store has not added a description yet."}</p>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div><dt className="text-xs uppercase text-slate-500">Currency</dt><dd>{store.data.defaultCurrency}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Support</dt><dd>{store.data.supportEmail ?? "Not published"}</dd></div>
      </dl>
      {store.data.logoFileId ? (
        <p className="mt-5 text-xs text-slate-500">
          A store logo asset is configured. Signed/public media delivery remains owned by the document/storage boundary.
        </p>
      ) : null}
      </article>
      <StoreReviewsSection storeId={store.data.id} />
    </div>
  );
}

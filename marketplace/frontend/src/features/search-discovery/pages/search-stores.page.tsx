import { Link } from "@tanstack/react-router";
import { ApiClientError } from "@/lib/api-error";
import { useForm } from "@tanstack/react-form";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { usePublicMediaQuery } from "@/features/public-media/hooks/use-public-media";
import { firstFieldError } from "@/features/auth/components/form-error";
import { SEARCH_STORE_SORT_OPTIONS } from "../search-discovery.constants";
import { SearchPagination } from "../components/search-pagination";
import { useStoreSearchQuery } from "../hooks/use-search-discovery";
import {
  searchStoresFormSchema,
  type SearchStoresRouteSearch,
} from "../schemas/search-discovery.schemas";

/** Renders public Store discovery using only the safe Store projection returned by Module 19. */
export function SearchStoresPage({
  search,
  onSearchChange,
}: {
  search: SearchStoresRouteSearch;
  onSearchChange: (next: SearchStoresRouteSearch) => void;
}) {
  const stores = useStoreSearchQuery(search);
  const logos = usePublicMediaQuery(stores.data?.data.map((store) => store.logoFileId) ?? []);
  const logoById = new Map(logos.data?.items.map((item) => [item.fileId, item]) ?? []);
  const form = useForm({
    defaultValues: { q: search.q ?? "", sort: search.sort },
    validators: { onChange: searchStoresFormSchema },
    onSubmit: ({ value }) => {
      const parsed = searchStoresFormSchema.parse(value);
      onSearchChange({
        q: parsed.q,
        sort: parsed.sort,
        page: 1,
        pageSize: search.pageSize,
      });
    },
  });

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Storefront discovery</p>
        <h1 className="mt-1 text-3xl font-bold">Search stores</h1>
        <p className="mt-2 text-sm text-slate-600">Find active public marketplace stores without exposing seller-private data.</p>
      </section>

      <form
        className="grid gap-3 rounded-xl border bg-white p-5 shadow-sm sm:grid-cols-[1fr_200px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="q">
          {(field) => {
            const error = firstFieldError(field.state.meta.errors);
            return (
              <label className="text-sm font-medium">
                Store search
                <input
                  aria-label="Store search"
                  placeholder="Search store name"
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
              </label>
            );
          }}
        </form.Field>

        <form.Field name="sort">
          {(field) => (
            <label className="text-sm font-medium">
              Sort stores
              <select
                aria-label="Store search sort"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "relevance" | "name")}
              >
                {SEARCH_STORE_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </form.Field>
        <Button className="self-end">Search stores</Button>
      </form>

      {!search.q ? (
        <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
          Enter a store name to begin discovery.
        </p>
      ) : null}
      {stores.isPending && search.q ? <LoadingState label="Searching stores..." /> : null}
      {stores.isError ? (
        <ErrorState
          title="Stores could not be searched"
          message={stores.error instanceof Error ? stores.error.message : "Please try again."}
          requestId={stores.error instanceof ApiClientError ? stores.error.requestId : undefined}
          onRetry={() => void stores.refetch()}
        />
      ) : null}
      {stores.data ? (
        <>
          {stores.data.data.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">No public stores match this search.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stores.data.data.map((store) => {
                const logo = store.logoFileId ? logoById.get(store.logoFileId) : undefined;
                return (
                  <article key={store.id} className="rounded-xl border bg-white p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      {logo?.mimeType.startsWith("image/") ? (
                        <img
                          src={logo.url}
                          alt={`${store.name} logo`}
                          className="h-12 w-12 shrink-0 rounded-lg border object-cover"
                          loading="lazy"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold">{store.name}</h2>
                        <p className="mt-1 text-sm text-slate-500">Sold by {store.seller.displayName}</p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm text-slate-600">{store.description ?? "No public description yet."}</p>
                    <Button className="mt-4" size="sm" variant="outline" asChild>
                      <Link to="/stores/$slug" params={{ slug: store.slug }}>View store</Link>
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
          <SearchPagination meta={stores.data.meta} onPage={(page) => onSearchChange({ ...search, page })} />
        </>
      ) : null}
    </div>
  );
}

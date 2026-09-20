import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { ProductPagination } from "../components/product-pagination";
import { PUBLIC_PRODUCT_SORT_OPTIONS } from "../products.constants";
import { usePublicProductsQuery } from "../hooks/use-products";
import type { PublicProductListParams } from "../types/products.types";

/** Displays the public Product catalog using only the published public-safe Product API. */
export function PublicProductsPage() {
  const [params, setParams] = useState<PublicProductListParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    direction: "desc",
  });
  const products = usePublicProductsQuery(params);
  const filterForm = useForm({
    defaultValues: { q: "", sort: "createdAt" as const, direction: "desc" as const },
    onSubmit: async ({ value }) => {
      setParams((current) => ({
        ...current,
        page: 1,
        q: value.q.trim() || undefined,
        sort: value.sort,
        direction: value.direction,
      }));
    },
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Storefront</p>
        <h1 className="mt-1 text-2xl font-bold">Products</h1>
        <p className="mt-1 text-sm text-slate-600">
          Browse published Products. Price and availability will be revalidated by later commerce modules.
        </p>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void filterForm.handleSubmit();
          }}
        >
          <filterForm.Field name="q">
            {(field) => (
              <input
                aria-label="Search Products"
                placeholder="Search by Product name"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            )}
          </filterForm.Field>
          <filterForm.Field name="sort">
            {(field) => (
              <select
                aria-label="Public Product sort"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "createdAt" | "name")}
              >
                {PUBLIC_PRODUCT_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </filterForm.Field>
          <filterForm.Field name="direction">
            {(field) => (
              <select
                aria-label="Public Product sort direction"
                className="rounded-md border px-3 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value as "asc" | "desc")}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            )}
          </filterForm.Field>
          <Button>Apply</Button>
        </form>
      </section>

      {products.isPending ? <LoadingState label="Loading Products..." /> : null}
      {products.isError ? (
        <ErrorState
          title="Products could not be loaded"
          message={products.error instanceof Error ? products.error.message : "Please try again."}
          onRetry={() => void products.refetch()}
        />
      ) : null}
      {products.data ? (
        <>
          {products.data.items.length === 0 ? (
            <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
              No published Products match these filters.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.data.items.map((product) => (
                <article key={product.id} className="rounded-xl border bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-bold">{product.name}</h2>
                  <p className="mt-2 line-clamp-3 text-sm text-slate-600">{product.description}</p>
                  <Button className="mt-4" size="sm" variant="outline" asChild>
                    <Link to="/products/$slug" params={{ slug: product.slug }}>View Product</Link>
                  </Button>
                </article>
              ))}
            </div>
          )}
          <ProductPagination
            meta={products.data.meta}
            onPageChange={(page) => setParams((current) => ({ ...current, page }))}
          />
        </>
      ) : null}
    </div>
  );
}

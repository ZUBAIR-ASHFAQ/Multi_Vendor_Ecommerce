import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { SearchProductCard as SearchProductCardValue } from "../schemas/search-discovery.schemas";

/** Formats a Search price range without converting the authoritative decimal strings into arithmetic values. */
function priceLabel(product: SearchProductCardValue): string {
  return product.minPrice === product.maxPrice
    ? `${product.currency} ${product.minPrice}`
    : `${product.currency} ${product.minPrice}–${product.maxPrice}`;
}

/** Renders one public-safe Search Product card and links to Module 6 authoritative Product detail. */
export function SearchProductCard({ product }: { product: SearchProductCardValue }) {
  return (
    <article className="flex h-full flex-col rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{product.categoryPath}</p>
          <h2 className="mt-1 text-lg font-bold">{product.name}</h2>
          {product.brand ? <p className="text-sm text-slate-500">{product.brand}</p> : null}
        </div>
        <span
          className={[
            "rounded-full px-2 py-1 text-xs font-medium",
            product.inStock
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {product.inStock ? "In stock" : "Out of stock"}
        </span>
      </div>

      <div className="mt-5 space-y-1 text-sm">
        <p className="font-semibold">{priceLabel(product)}</p>
        <p className="text-slate-600">
          {product.ratingCount > 0
            ? `${product.ratingAvg.toFixed(1)} / 5 · ${product.ratingCount} ratings`
            : "No ratings yet"}
        </p>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Search price and stock are discovery hints. Product detail and later checkout flows re-read source data.
      </p>

      <Button className="mt-5 self-start" size="sm" variant="outline" asChild>
        <Link to="/products/$slug" params={{ slug: product.slug }}>View Product</Link>
      </Button>
    </article>
  );
}

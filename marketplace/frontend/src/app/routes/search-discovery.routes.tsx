import { createRoute } from "@tanstack/react-router";
import { SearchProductsPage } from "@/features/search-discovery/pages/search-products.page";
import { SearchStoresPage } from "@/features/search-discovery/pages/search-stores.page";
import {
  searchProductsRouteSearchSchema,
  searchStoresRouteSearchSchema,
} from "@/features/search-discovery/schemas/search-discovery.schemas";
import { rootRoute } from "./root.route";

/** Connects typed Product Search URL state to the pure Search page component. */
function SearchProductsRoutePage() {
  const search = searchProductsRoute.useSearch();
  const navigate = searchProductsRoute.useNavigate();
  return (
    <SearchProductsPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  );
}

/** Connects typed Store Search URL state to the pure Store discovery page component. */
function SearchStoresRoutePage() {
  const search = searchStoresRoute.useSearch();
  const navigate = searchStoresRoute.useNavigate();
  return (
    <SearchStoresPage
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  );
}

export const searchProductsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search) => searchProductsRouteSearchSchema.parse(search),
  component: SearchProductsRoutePage,
});

export const searchStoresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search/stores",
  validateSearch: (search) => searchStoresRouteSearchSchema.parse(search),
  component: SearchStoresRoutePage,
});

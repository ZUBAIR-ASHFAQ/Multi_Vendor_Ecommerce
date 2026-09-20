import { createRoute } from "@tanstack/react-router";
import { AdminAttributesPage } from "@/features/catalog-taxonomy/pages/admin-attributes.page";
import { AdminBrandsPage } from "@/features/catalog-taxonomy/pages/admin-brands.page";
import { AdminCategoriesPage } from "@/features/catalog-taxonomy/pages/admin-categories.page";
import { AdminCategoryAttributesPage } from "@/features/catalog-taxonomy/pages/admin-category-attributes.page";
import { SellerTaxonomySelectorPage } from "@/features/catalog-taxonomy/pages/seller-taxonomy-selector.page";
import { rootRoute } from "./root.route";

/** Administration route for category hierarchy management. */
export const adminCatalogCategoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/catalog/categories",
  component: AdminCategoriesPage,
});

/** Administration route for brand definitions. */
export const adminCatalogBrandsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/catalog/brands",
  component: AdminBrandsPage,
});

/** Administration route for reusable attribute definitions. */
export const adminCatalogAttributesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/catalog/attributes",
  component: AdminAttributesPage,
});

/** Administration route for complete category-to-attribute replacement commands. */
export const adminCatalogCategoryAttributesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/catalog/category-attributes",
  component: AdminCategoryAttributesPage,
});

/** Seller read-only taxonomy selector prepared for Module 6 Product Management. */
export const sellerCatalogTaxonomyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/catalog-taxonomy",
  component: SellerTaxonomySelectorPage,
});

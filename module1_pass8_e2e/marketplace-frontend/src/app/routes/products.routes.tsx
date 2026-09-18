import { createRoute } from "@tanstack/react-router";
import { PublicProductDetailPage } from "@/features/products/pages/public-product-detail.page";
import { PublicProductsPage } from "@/features/products/pages/public-products.page";
import { SellerProductCreatePage } from "@/features/products/pages/seller-product-create.page";
import { SellerProductEditPage } from "@/features/products/pages/seller-product-edit.page";
import { SellerProductsPage } from "@/features/products/pages/seller-products.page";
import { rootRoute } from "./root.route";

export const publicProductsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products",
  component: PublicProductsPage,
});

export const publicProductDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/products/$slug",
  component: PublicProductDetailPage,
});

export const sellerProductsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/products",
  component: SellerProductsPage,
});

export const sellerProductCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/products/new",
  component: SellerProductCreatePage,
});

export const sellerProductEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/products/$productId",
  component: SellerProductEditPage,
});

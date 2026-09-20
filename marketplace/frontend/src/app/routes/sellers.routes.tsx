import { createRoute } from "@tanstack/react-router";
import { AdminSellerApplicationsPage } from "@/features/sellers/pages/admin-seller-applications.page";
import { AdminSellerSuspensionPage } from "@/features/sellers/pages/admin-seller-suspension.page";
import { PublicStorePage } from "@/features/sellers/pages/public-store.page";
import { SellerApplicationPage } from "@/features/sellers/pages/seller-application.page";
import { SellerProfilePage } from "@/features/sellers/pages/seller-profile.page";
import { SellerStaffPage } from "@/features/sellers/pages/seller-staff.page";
import { SellerStoresPage } from "@/features/sellers/pages/seller-stores.page";
import { rootRoute } from "./root.route";

export const sellerApplicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/apply",
  component: SellerApplicationPage,
});

export const sellerProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/profile",
  component: SellerProfilePage,
});

export const sellerStoresRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/stores",
  component: SellerStoresPage,
});

export const sellerStaffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/staff",
  component: SellerStaffPage,
});

export const publicStoreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stores/$slug",
  component: PublicStorePage,
});

export const adminSellerApplicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/seller-applications",
  component: AdminSellerApplicationsPage,
});

export const adminSellerSuspensionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/sellers/suspend",
  component: AdminSellerSuspensionPage,
});

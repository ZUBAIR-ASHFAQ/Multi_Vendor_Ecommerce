import { createRoute } from "@tanstack/react-router";
import { AdminPromotionsPage } from "@/features/promotions/pages/admin-promotions.page";
import { SellerPromotionsPage } from "@/features/promotions/pages/seller-promotions.page";
import { rootRoute } from "./root.route";

/** Platform Promotion list/editor route. */
export const adminPromotionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/promotions",
  component: AdminPromotionsPage,
});

/** Seller-funded Promotion creation route. */
export const sellerPromotionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/promotions",
  component: SellerPromotionsPage,
});

import { createRoute } from "@tanstack/react-router";
import { SellerInventoryMovementsPage } from "@/features/inventory/pages/seller-inventory-movements.page";
import { SellerInventoryPage } from "@/features/inventory/pages/seller-inventory.page";
import { SellerInventoryVariantPage } from "@/features/inventory/pages/seller-inventory-variant.page";
import { rootRoute } from "./root.route";

export const sellerInventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/inventory",
  component: SellerInventoryPage,
});

export const sellerInventoryVariantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/inventory/$variantId/manage",
  component: SellerInventoryVariantPage,
});

export const sellerInventoryMovementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/inventory/$variantId/movements",
  component: SellerInventoryMovementsPage,
});

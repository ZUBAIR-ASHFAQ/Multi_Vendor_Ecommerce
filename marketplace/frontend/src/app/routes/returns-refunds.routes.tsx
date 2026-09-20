import { createRoute } from "@tanstack/react-router";
import { AdminReturnsPage } from "@/features/returns-refunds/pages/admin-returns.page";
import { CustomerCreateReturnPage } from "@/features/returns-refunds/pages/customer-create-return.page";
import { CustomerReturnsPage } from "@/features/returns-refunds/pages/customer-returns.page";
import { SellerReturnsPage } from "@/features/returns-refunds/pages/seller-returns.page";
import { rootRoute } from "./root.route";

/** Customer Return history route. */
export const customerReturnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/returns",
  component: CustomerReturnsPage,
});

/** Customer Return Request route scoped to one parent Order and Seller Order. */
export const customerCreateReturnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$orderId/returns/$sellerOrderId/new",
  component: CustomerCreateReturnPage,
});

/** Seller Return review/inspection queue route. */
export const sellerReturnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/returns",
  component: SellerReturnsPage,
});

/** Admin/support Return and dispute review route. */
export const adminReturnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/returns",
  component: AdminReturnsPage,
});

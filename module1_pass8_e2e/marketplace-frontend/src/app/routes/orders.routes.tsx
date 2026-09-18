import { createRoute } from "@tanstack/react-router";
import { AdminOrdersPage } from "@/features/orders/pages/admin-orders.page";
import { CustomerOrderDetailPage } from "@/features/orders/pages/customer-order-detail.page";
import { CustomerOrdersPage } from "@/features/orders/pages/customer-orders.page";
import { SellerOrderDetailPage } from "@/features/orders/pages/seller-order-detail.page";
import { SellerOrdersPage } from "@/features/orders/pages/seller-orders.page";
import { rootRoute } from "./root.route";

/** Customer parent Order history route. */
export const customerOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders",
  component: CustomerOrdersPage,
});

/** Customer-owned parent Order detail route. */
export const customerOrderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$orderId",
  component: CustomerOrderDetailPage,
});

/** Seller-scoped fulfillment queue route. */
export const sellerOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/orders",
  component: SellerOrdersPage,
});

/** Seller-scoped Seller Order detail route. */
export const sellerOrderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/orders/$sellerOrderId",
  component: SellerOrderDetailPage,
});

/** Privileged parent Order search/support route. */
export const adminOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/orders",
  component: AdminOrdersPage,
});

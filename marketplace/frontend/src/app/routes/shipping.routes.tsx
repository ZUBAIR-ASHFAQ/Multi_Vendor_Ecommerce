import { createRoute } from "@tanstack/react-router";
import { CustomerOrderShippingPage } from "@/features/shipping/pages/customer-order-shipping.page";
import { SellerOrderShippingPage } from "@/features/shipping/pages/seller-order-shipping.page";
import { SellerShipmentsPage } from "@/features/shipping/pages/seller-shipments.page";
import { rootRoute } from "./root.route";

/** Seller-wide Shipment fulfillment queue route. */
export const sellerShipmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/shipments",
  component: SellerShipmentsPage,
});

/** Seller Order-specific Shipment creation, tracking, and lifecycle route. */
export const sellerOrderShippingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/orders/$sellerOrderId/shipping",
  component: SellerOrderShippingPage,
});

/** Customer/support-safe Shipment tracking route for one parent Order. */
export const customerOrderShippingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$orderId/shipping",
  component: CustomerOrderShippingPage,
});

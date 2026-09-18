import { createRoute } from "@tanstack/react-router";
import { AdminPaymentDetailPage } from "@/features/payments/pages/admin-payment-detail.page";
import { AdminPaymentsPage } from "@/features/payments/pages/admin-payments.page";
import { PaymentStatusPage } from "@/features/payments/pages/payment-status.page";
import { rootRoute } from "./root.route";

/** Customer provider-authoritative Payment status route for one parent Order. */
export const paymentStatusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/payments/orders/$orderId",
  component: PaymentStatusPage,
});

/** Finance Payment search route protected inside the page by admin.payments.read. */
export const adminPaymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/payments",
  component: AdminPaymentsPage,
});

/** Finance Payment detail/timeline route protected by the same read permission. */
export const adminPaymentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/payments/$paymentId",
  component: AdminPaymentDetailPage,
});

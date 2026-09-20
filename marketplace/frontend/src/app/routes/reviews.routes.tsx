import { createRoute } from "@tanstack/react-router";
import { AdminReviewsPage } from "@/features/reviews/pages/admin-reviews.page";
import { CustomerCreateReviewPage } from "@/features/reviews/pages/customer-create-review.page";
import { rootRoute } from "./root.route";

/** Customer verified-purchase Review editor route scoped to one known Order Item. */
export const customerCreateReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$orderId/reviews/$orderItemId/new",
  component: CustomerCreateReviewPage,
});


/** Admin Review moderation queue route protected again inside the page by RBAC. */
export const adminReviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/reviews",
  component: AdminReviewsPage,
});

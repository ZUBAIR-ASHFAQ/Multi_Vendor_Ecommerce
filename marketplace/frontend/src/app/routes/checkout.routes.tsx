import { createRoute } from "@tanstack/react-router";
import { CheckoutPage } from "@/features/checkout/pages/checkout.page";
import { checkoutRouteSearchSchema } from "@/features/checkout/schemas/checkout.schemas";
import { rootRoute } from "./root.route";

/** Customer-owned Module 10 Checkout page route. */
export const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checkout",
  validateSearch: (search) => checkoutRouteSearchSchema.parse(search),
  component: CheckoutPage,
});

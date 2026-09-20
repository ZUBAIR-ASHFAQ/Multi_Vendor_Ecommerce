import { createRoute } from "@tanstack/react-router";
import { CartPage } from "@/features/cart-wishlist/pages/cart.page";
import { WishlistPage } from "@/features/cart-wishlist/pages/wishlist.page";
import { rootRoute } from "./root.route";

/** Customer-owned Cart page route. */
export const cartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cart",
  component: CartPage,
});

/** Customer-owned default Wishlist page route. */
export const wishlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/wishlist",
  component: WishlistPage,
});

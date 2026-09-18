import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  CART_WISHLIST_PERMISSION,
  hasCartWishlistPermission,
} from "../cart-wishlist.constants";
import { useCartQuery } from "../hooks/use-cart-wishlist";

/** Loads Cart state on protected Module 8 pages so the global mini Cart stays current. */
function CartCacheLoader() {
  useCartQuery();
  return null;
}

/** Renders customer Cart/Wishlist navigation after the server actor has been authenticated. */
function CartWishlistNavigation({ user }: { user: AuthenticatedUser }) {
  const isCustomer = user.accountType === "customer";
  const canUseCart =
    isCustomer &&
    hasCartWishlistPermission(
      user.permissions,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );
  const canUseWishlist =
    isCustomer &&
    hasCartWishlistPermission(
      user.permissions,
      CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
    );

  return (
    <>
      {canUseCart ? <CartCacheLoader /> : null}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Customer Commerce
          </p>
          <p className="mt-1 font-semibold">{user.displayName}</p>
        </div>
        <nav
          className="mt-4 flex flex-wrap gap-2"
          aria-label="Cart and Wishlist navigation"
        >
          {canUseCart ? (
            <Link
              to="/cart"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Cart
            </Link>
          ) : null}
          {canUseWishlist ? (
            <Link
              to="/wishlist"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Wishlist
            </Link>
          ) : null}
          <Link
            to="/products"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Continue shopping
          </Link>
        </nav>
      </section>
    </>
  );
}

/** Protects one Module 8 page with customer account type plus the required server permission. */
function RequireCartWishlistPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (
    user.accountType !== "customer" ||
    !hasCartWishlistPermission(user.permissions, permission)
  ) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to use this customer Cart or Wishlist feature."
      />
    );
  }
  return <>{children}</>;
}

/** Shared authenticated shell for Cart and Wishlist pages. */
export function CartWishlistLayout({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <div className="space-y-6">
          <CartWishlistNavigation user={user} />
          <RequireCartWishlistPermission user={user} permission={permission}>
            {children}
          </RequireCartWishlistPermission>
        </div>
      )}
    </AuthenticatedPanel>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CHECKOUT_PERMISSION } from "../checkout.constants";

/** Returns true when the authenticated customer can create/read their own Checkout quote. */
function canUseCheckout(user: AuthenticatedUser): boolean {
  return (
    user.accountType === "customer" &&
    user.permissions.includes(CHECKOUT_PERMISSION.CREATE_OWN)
  );
}

/** Shared customer-commerce navigation for the Checkout page. */
function CheckoutNavigation({ user }: { user: AuthenticatedUser }) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Customer Commerce
        </p>
        <p className="mt-1 font-semibold">{user.displayName}</p>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Checkout navigation">
        <Link
          to="/cart"
          className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Cart
        </Link>
        <Link
          to="/checkout"
          className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
        >
          Checkout
        </Link>
        <Link
          to="/customer/addresses"
          className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Addresses
        </Link>
      </nav>
    </section>
  );
}

/** Protects Checkout with account type plus the required frontend convenience permission check. */
function CheckoutPermissionGate({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  if (!canUseCheckout(user)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to create a customer Checkout quote."
      />
    );
  }
  return <>{children}</>;
}

/** Authenticated Checkout shell that exposes the actor to the page without storing it globally. */
export function CheckoutLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <div className="space-y-6">
          <CheckoutNavigation user={user} />
          <CheckoutPermissionGate user={user}>{children(user)}</CheckoutPermissionGate>
        </div>
      )}
    </AuthenticatedPanel>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CUSTOMER_PERMISSION, hasCustomerPermission } from "../customers.constants";

/** Renders customer self-service navigation from server-provided permissions. */
function CustomerNavigation({ user }: { user: AuthenticatedUser }) {
  const isCustomer = user.accountType === "customer";
  const canReadProfile =
    isCustomer && hasCustomerPermission(user.permissions, CUSTOMER_PERMISSION.PROFILE_READ_OWN);
  const canManageAddresses =
    isCustomer && hasCustomerPermission(user.permissions, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN);

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Management</p>
          <p className="mt-1 font-semibold">{user.displayName}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        <Button asChild variant="ghost">
          <Link to="/account">Account</Link>
        </Button>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Customer navigation">
        {canReadProfile && (
          <Link
            to="/customer/profile"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            My profile
          </Link>
        )}
        {isCustomer && (
          <Link
            to="/seller/apply"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Become a seller
          </Link>
        )}
        {canManageAddresses && (
          <Link
            to="/customer/addresses"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Address book
          </Link>
        )}
      </nav>
    </section>
  );
}

/** Protects a customer page and supplies the authenticated actor to its child content. */
export function CustomerLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <div className="space-y-6">
          <CustomerNavigation user={user} />
          {children(user)}
        </div>
      )}
    </AuthenticatedPanel>
  );
}

/** Renders a clear permission state when the actor cannot use one customer workflow. */
export function RequireCustomerPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (user.accountType !== "customer" || !hasCustomerPermission(user.permissions, permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to use this customer feature."
      />
    );
  }
  return <>{children}</>;
}

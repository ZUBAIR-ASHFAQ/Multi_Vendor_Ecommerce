import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CART_WISHLIST_PERMISSION } from "@/features/cart-wishlist/cart-wishlist.constants";
import { NOTIFICATIONS_PERMISSION } from "@/features/notifications/notifications.constants";
import { ORDERS_PERMISSION } from "@/features/orders/orders.constants";
import { RETURNS_PERMISSION } from "@/features/returns-refunds/returns-refunds.constants";
import { CUSTOMER_PERMISSION } from "../customers.constants";

const navClass =
  "block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950";
const activeClass = "bg-slate-950 text-white hover:bg-slate-950 hover:text-white";

/** Returns whether the server-derived actor may see one customer self-service destination. */
function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  return user.permissions.includes(permission);
}

/** Renders the shared customer self-service navigation without replacing feature-level authorization. */
export function CustomerAccountShell({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  if (user.accountType !== "customer") return <>{children}</>;

  const links = [
    { label: "Overview", to: "/account", visible: true, exact: true },
    {
      label: "Orders",
      to: "/orders",
      exact: false,
      visible: hasPermission(user, ORDERS_PERMISSION.READ_OWN),
    },
    {
      label: "Returns",
      to: "/returns",
      exact: false,
      visible: hasPermission(user, RETURNS_PERMISSION.READ_OWN),
    },
    {
      label: "Wishlist",
      to: "/wishlist",
      exact: false,
      visible: hasPermission(user, CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN),
    },
    {
      label: "Profile",
      to: "/customer/profile",
      exact: false,
      visible: hasPermission(user, CUSTOMER_PERMISSION.PROFILE_READ_OWN),
    },
    {
      label: "Addresses",
      to: "/customer/addresses",
      exact: false,
      visible: hasPermission(user, CUSTOMER_PERMISSION.ADDRESS_MANAGE_OWN),
    },
    {
      label: "Notifications",
      to: "/notifications",
      exact: true,
      visible: hasPermission(user, NOTIFICATIONS_PERMISSION.READ_OWN),
    },
    {
      label: "Notification settings",
      to: "/notifications/preferences",
      exact: false,
      visible: hasPermission(user, NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN),
    },
  ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
      <aside className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:sticky lg:top-24">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">My account</p>
          <p className="mt-1 truncate font-semibold text-slate-950">{user.displayName}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
        </div>

        <nav
          className="mt-3 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
          aria-label="Customer account navigation"
        >
          {links
            .filter((item) => item.visible)
            .map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={navClass}
                activeOptions={{ exact: item.exact }}
                activeProps={{ className: activeClass }}
              >
                {item.label}
              </Link>
            ))}
        </nav>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <Link
            to="/seller/apply"
            className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
          >
            Sell on Marketplace
          </Link>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Loads the current actor once and adds the customer shell only for customer accounts. */
export function CustomerAccountLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <CustomerAccountShell user={user}>{children(user)}</CustomerAccountShell>
      )}
    </AuthenticatedPanel>
  );
}

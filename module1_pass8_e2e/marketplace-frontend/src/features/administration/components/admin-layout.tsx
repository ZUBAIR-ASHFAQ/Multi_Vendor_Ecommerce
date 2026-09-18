import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { useLogoutMutation } from "@/features/auth/hooks/use-auth";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { ADMIN_PERMISSION, hasPermission } from "../administration.constants";
import { DOCUMENT_AUDIT_PERMISSION } from "@/features/documents-audit/documents-audit.constants";
import { CUSTOMER_PERMISSION } from "@/features/customers/customers.constants";
import { SELLER_PERMISSION } from "@/features/sellers/sellers.constants";
import { PROMOTION_PERMISSION } from "@/features/promotions/promotions.constants";
import { ORDERS_PERMISSION } from "@/features/orders/orders.constants";
import { PAYMENTS_PERMISSION } from "@/features/payments/payments.constants";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { REVIEWS_PERMISSION } from "@/features/reviews/reviews.constants";
import { NOTIFICATIONS_PERMISSION } from "@/features/notifications/notifications.constants";
import { REPORTS_PERMISSION } from "@/features/reports/reports.constants";

/** Returns true when an admin actor can use any Reports & Analytics surface. */
function canOpenReports(user: AuthenticatedUser): boolean {
  return [
    REPORTS_PERMISSION.SALES_READ,
    REPORTS_PERMISSION.INVENTORY_READ,
    REPORTS_PERMISSION.FINANCE_READ,
    REPORTS_PERMISSION.SELLER_READ,
    REPORTS_PERMISSION.EXPORT,
  ].some((permission) => user.permissions.includes(permission));
}

/** Renders Module 2 navigation filtered by server-provided permissions. */
function Layout({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  const navigate = useNavigate();
  const logout = useLogoutMutation();
  const links = [
    { to: "/admin/users" as const, label: "Users", permission: ADMIN_PERMISSION.USERS_READ },
    { to: "/admin/roles" as const, label: "Roles", permission: ADMIN_PERMISSION.ROLES_READ },
    {
      to: "/admin/settings" as const,
      label: "Settings",
      permission: ADMIN_PERMISSION.SETTINGS_MANAGE,
    },
    {
      to: "/admin/customers" as const,
      label: "Customers",
      permission: CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ,
    },
    {
      to: "/admin/seller-applications" as const,
      label: "Seller applications",
      permission: SELLER_PERMISSION.ADMIN_REVIEW,
    },
    {
      to: "/admin/sellers/suspend" as const,
      label: "Suspend seller",
      permission: SELLER_PERMISSION.ADMIN_SUSPEND,
    },
    {
      to: "/admin/catalog/categories" as const,
      label: "Catalog",
      permission: "catalog.manage_categories",
    },
    {
      to: "/admin/promotions" as const,
      label: "Promotions",
      permission: PROMOTION_PERMISSION.ADMIN_MANAGE,
    },
    {
      to: "/admin/orders" as const,
      label: "Orders",
      permission: ORDERS_PERMISSION.ADMIN_READ,
    },
    {
      to: "/admin/payments" as const,
      label: "Payments",
      permission: PAYMENTS_PERMISSION.ADMIN_READ,
    },
    {
      to: "/admin/commissions/rules" as const,
      label: "Commission rules",
      permission: COMMISSIONS_PERMISSION.ADMIN_READ,
    },
    {
      to: "/admin/commissions/entries" as const,
      label: "Commission ledger",
      permission: COMMISSIONS_PERMISSION.ADMIN_READ,
    },
    {
      to: "/admin/returns" as const,
      label: "Returns",
      permission: "admin.returns.manage",
    },
    {
      to: "/admin/payouts" as const,
      label: "Payouts",
      permission: WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ,
    },
    {
      to: "/admin/reviews" as const,
      label: "Reviews",
      permission: REVIEWS_PERMISSION.ADMIN_MODERATE,
    },
    {
      to: "/admin/notification-deliveries" as const,
      label: "Notification failures",
      permission: NOTIFICATIONS_PERMISSION.ADMIN_READ,
    },
    {
      to: "/reports" as const,
      label: "Reports",
      permission: null,
    },
    {
      to: "/documents" as const,
      label: "Documents",
      permission: DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    },
    {
      to: "/audit" as const,
      label: "Audit",
      permission: DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Administration & Security
            </p>
            <p className="mt-1 font-semibold">{user.displayName}</p>
            <p className="text-xs text-slate-500">
              {user.email} · {user.accountType}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/account">Account</Link>
            </Button>
            <Button
              variant="outline"
              disabled={logout.isPending}
              onClick={() => {
                void logout.mutateAsync().then(() => navigate({ to: "/login" }));
              }}
            >
              Sign out
            </Button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2">
          {links
            .filter((link) =>
              link.to === "/reports"
                ? canOpenReports(user)
                : link.permission !== null && hasPermission(user.permissions, link.permission),
            )
            .map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
        </nav>
      </section>
      {children}
    </div>
  );
}

/** Protects an administration page and supplies the current authenticated actor. */
export function AdminLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return <AuthenticatedPanel>{(user) => <Layout user={user}>{children(user)}</Layout>}</AuthenticatedPanel>;
}

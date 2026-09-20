import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { REPORTS_PERMISSION } from "../reports.constants";

/** Returns true when the actor can open at least one interactive Reports page. */
function canReadAnyReport(user: AuthenticatedUser): boolean {
  return [
    REPORTS_PERMISSION.SALES_READ,
    REPORTS_PERMISSION.SELLER_READ,
    REPORTS_PERMISSION.INVENTORY_READ,
    REPORTS_PERMISSION.FINANCE_READ,
  ].some((permission) => user.permissions.includes(permission));
}

/** Renders report navigation from the server-derived permission set. */
function ReportsNavigation({ user }: { user: AuthenticatedUser }) {
  const links = [
    { to: "/reports" as const, label: "Catalog", permission: null },
    { to: "/reports/sales" as const, label: "Sales", permission: REPORTS_PERMISSION.SALES_READ },
    { to: "/reports/sellers" as const, label: "Sellers", permission: REPORTS_PERMISSION.SELLER_READ },
    { to: "/reports/inventory" as const, label: "Inventory", permission: REPORTS_PERMISSION.INVENTORY_READ },
    { to: "/reports/refunds" as const, label: "Refunds", permission: REPORTS_PERMISSION.FINANCE_READ },
    { to: "/reports/commissions" as const, label: "Commissions", permission: REPORTS_PERMISSION.FINANCE_READ },
    { to: "/reports/payouts" as const, label: "Payouts", permission: REPORTS_PERMISSION.FINANCE_READ },
  ];

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reports & Analytics</p>
      <p className="mt-1 font-semibold">{user.displayName}</p>
      <p className="text-xs text-slate-500">Permission-safe operational and financial reporting</p>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Reports navigation">
        {links
          .filter((link) => !link.permission || user.permissions.includes(link.permission))
          .map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              {link.label}
            </Link>
          ))}
      </nav>
    </section>
  );
}

/** Protects Reports pages and supplies the current authenticated actor. */
export function ReportsLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => {
        if (!canReadAnyReport(user) && !user.permissions.includes(REPORTS_PERMISSION.EXPORT)) {
          return (
            <ErrorState
              title="Access denied"
              message="Your account does not have permission to use Reports & Analytics."
            />
          );
        }

        return (
          <div className="space-y-6">
            <ReportsNavigation user={user} />
            {children(user)}
          </div>
        );
      }}
    </AuthenticatedPanel>
  );
}

/** Renders a clear page-level denial when one report permission is missing. */
export function RequireReportPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (!user.permissions.includes(permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to view this report."
      />
    );
  }
  return <>{children}</>;
}

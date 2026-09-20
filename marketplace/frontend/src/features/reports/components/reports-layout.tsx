import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import {
  WORKSPACE_NAV_ACTIVE_CLASS,
  WORKSPACE_NAV_LINK_CLASS,
  WorkspaceNavGroup,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@/components/workspace/workspace-shell";
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
    <WorkspaceSidebar
      ariaLabel="Reports navigation"
      kicker="Reports & Analytics"
      title={user.displayName}
      subtitle="Permission-safe operational and financial reporting"
      footer={(
        <>
          <strong>Live source data</strong>
          <p>Reports retain the existing server-side scoping, export ownership, and permission checks.</p>
          <div className="workspace-account-actions">
            <Link to="/account" className={WORKSPACE_NAV_LINK_CLASS}>Account <span>›</span></Link>
          </div>
        </>
      )}
    >
      <WorkspaceNavGroup label="Reports">
        {links
          .filter((link) => !link.permission || user.permissions.includes(link.permission))
          .map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={WORKSPACE_NAV_LINK_CLASS}
              activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}
            >
              {link.label} <span>›</span>
            </Link>
          ))}
      </WorkspaceNavGroup>
    </WorkspaceSidebar>
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

        return <WorkspaceShell sidebar={<ReportsNavigation user={user} />}>{children(user)}</WorkspaceShell>;
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

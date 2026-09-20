import type { ReactNode } from "react";

export const WORKSPACE_NAV_LINK_CLASS = "workspace-nav-link";
export const WORKSPACE_NAV_ACTIVE_CLASS = "workspace-nav-link workspace-nav-link-active";

interface WorkspaceShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

/** Shared structural shell for seller, admin, dashboard, reporting, and audit workspaces. */
export function WorkspaceShell({ sidebar, children }: WorkspaceShellProps) {
  return (
    <div className="workspace-frame">
      {sidebar}
      <div className="workspace-main">{children}</div>
    </div>
  );
}

interface WorkspaceSidebarProps {
  ariaLabel: string;
  kicker: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared workspace sidebar frame. Permission-aware link decisions remain in each feature owner. */
export function WorkspaceSidebar({
  ariaLabel,
  kicker,
  title,
  subtitle,
  children,
  footer,
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar" aria-label={ariaLabel}>
      <div className="workspace-sidebar-header">
        <p className="workspace-sidebar-kicker">{kicker}</p>
        <h2 className="workspace-sidebar-title">{title}</h2>
        {subtitle ? <p className="workspace-sidebar-subtitle">{subtitle}</p> : null}
      </div>

      {children}

      {footer ? <div className="workspace-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

interface WorkspaceNavGroupProps {
  label: string;
  children: ReactNode;
}

/** Groups one feature-owned set of workspace destinations under consistent navigation styling. */
export function WorkspaceNavGroup({ label, children }: WorkspaceNavGroupProps) {
  return (
    <div className="workspace-nav-group">
      <p className="workspace-nav-label">{label}</p>
      <nav className="workspace-nav-list" aria-label={label}>
        {children}
      </nav>
    </div>
  );
}

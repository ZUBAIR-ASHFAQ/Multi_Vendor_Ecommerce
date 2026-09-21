import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  WORKSPACE_NAV_ACTIVE_CLASS,
  WORKSPACE_NAV_LINK_CLASS,
  WorkspaceNavGroup,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@/components/workspace/workspace-shell";
import { AdminNavigation } from "@/features/administration/components/admin-layout";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  DOCUMENT_AUDIT_PERMISSION,
  hasDocumentPermission,
} from "../documents-audit.constants";

/** Renders Module 21 navigation for non-admin actors from server-derived permissions. */
function DocumentsAuditNavigation({ user }: { user: AuthenticatedUser }) {
  const canUseDocuments = [
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
  ].some((permission) => hasDocumentPermission(user.permissions, permission));
  const canReadAudit = hasDocumentPermission(
    user.permissions,
    DOCUMENT_AUDIT_PERMISSION.AUDIT_READ,
  );

  return (
    <WorkspaceSidebar
      ariaLabel="Documents and audit navigation"
      kicker="Documents & Audit"
      title={user.displayName}
      subtitle={user.email}
      footer={(
        <>
          <strong>Controlled evidence</strong>
          <p>Upload, link, download, and audit access continue to use the existing backend permission checks.</p>
          <div className="workspace-account-actions">
            <Link to="/account" className={WORKSPACE_NAV_LINK_CLASS}>Account <span>›</span></Link>
          </div>
        </>
      )}
    >
      <WorkspaceNavGroup label="Operations">
        {canUseDocuments ? (
          <Link
            to="/documents"
            className={WORKSPACE_NAV_LINK_CLASS}
            activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}
          >
            Documents <span>›</span>
          </Link>
        ) : null}
        {canReadAudit ? (
          <Link
            to="/audit"
            className={WORKSPACE_NAV_LINK_CLASS}
            activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}
          >
            Audit log <span>›</span>
          </Link>
        ) : null}
      </WorkspaceNavGroup>
    </WorkspaceSidebar>
  );
}

/** Protects a Module 21 page and keeps platform-admin routes inside the shared admin workspace. */
export function DocumentsAuditLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <WorkspaceShell
          sidebar={
            user.accountType === "platform_admin" ? (
              <AdminNavigation user={user} />
            ) : (
              <DocumentsAuditNavigation user={user} />
            )
          }
        >
          {children(user)}
        </WorkspaceShell>
      )}
    </AuthenticatedPanel>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import {
  DOCUMENT_AUDIT_PERMISSION,
  hasDocumentPermission,
} from "../documents-audit.constants";

/** Renders Module 21 navigation using only permissions supplied by the authenticated backend context. */
function Layout({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
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
    <div className="space-y-6">
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Documents & Audit
            </p>
            <p className="mt-1 font-semibold">{user.displayName}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
          <Button asChild variant="ghost">
            <Link to="/account">Account</Link>
          </Button>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Documents and audit navigation">
          {canUseDocuments && (
            <Link
              to="/documents"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Documents
            </Link>
          )}
          {canReadAudit && (
            <Link
              to="/audit"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Audit log
            </Link>
          )}
        </nav>
      </section>
      {children}
    </div>
  );
}

/** Protects a Module 21 page and provides the current authenticated actor. */
export function DocumentsAuditLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => <Layout user={user}>{children(user)}</Layout>}
    </AuthenticatedPanel>
  );
}

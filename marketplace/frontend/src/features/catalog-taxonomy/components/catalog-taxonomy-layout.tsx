import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { AdminNavigation } from "@/features/administration/components/admin-layout";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CATALOG_PERMISSION, hasCatalogPermission } from "../catalog-taxonomy.constants";

/** Renders Module 5 navigation for non-admin actors using only server-derived permission codes. */
function CatalogNavigation({ user }: { user: AuthenticatedUser }) {
  const canManageCategories = hasCatalogPermission(
    user.permissions,
    CATALOG_PERMISSION.MANAGE_CATEGORIES,
  );
  const canManageBrands = hasCatalogPermission(
    user.permissions,
    CATALOG_PERMISSION.MANAGE_BRANDS,
  );
  const canManageAttributes = hasCatalogPermission(
    user.permissions,
    CATALOG_PERMISSION.MANAGE_ATTRIBUTES,
  );
  const canReadSellerTaxonomy =
    user.accountType === "seller" &&
    hasCatalogPermission(user.permissions, CATALOG_PERMISSION.READ);

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Catalog Taxonomy
          </p>
          <p className="mt-1 font-semibold text-foreground">{user.displayName}</p>
          <p className="text-xs text-foreground-muted">{user.email}</p>
        </div>
        <Button asChild variant="ghost">
          <Link to="/account">Account</Link>
        </Button>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Catalog taxonomy navigation">
        {canManageCategories ? (
          <Link
            to="/admin/catalog/categories"
            className="rounded-control px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
          >
            Categories
          </Link>
        ) : null}
        {canManageBrands ? (
          <Link
            to="/admin/catalog/brands"
            className="rounded-control px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
          >
            Brands
          </Link>
        ) : null}
        {canManageAttributes ? (
          <Link
            to="/admin/catalog/attributes"
            className="rounded-control px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
          >
            Attributes
          </Link>
        ) : null}
        {canManageCategories ? (
          <Link
            to="/admin/catalog/category-attributes"
            className="rounded-control px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
          >
            Category mappings
          </Link>
        ) : null}
        {canReadSellerTaxonomy ? (
          <Link
            to="/seller/catalog-taxonomy"
            className="rounded-control px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted"
            activeProps={{ className: "bg-primary text-primary-foreground hover:bg-primary" }}
          >
            Seller taxonomy selector
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

/** Protects Module 5 pages and keeps platform-admin catalog routes inside the shared admin workspace. */
export function CatalogTaxonomyLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) =>
        user.accountType === "platform_admin" ? (
          <WorkspaceShell sidebar={<AdminNavigation user={user} />}>{children(user)}</WorkspaceShell>
        ) : (
          <div className="space-y-6">
            <CatalogNavigation user={user} />
            {children(user)}
          </div>
        )
      }
    </AuthenticatedPanel>
  );
}

/** Renders a clear permission state when one taxonomy workflow is unavailable. */
export function RequireCatalogPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (!hasCatalogPermission(user.permissions, permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your account does not have permission to use this catalog taxonomy feature."
      />
    );
  }
  return <>{children}</>;
}

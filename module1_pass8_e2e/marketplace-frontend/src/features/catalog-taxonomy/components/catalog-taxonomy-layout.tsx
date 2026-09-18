import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CATALOG_PERMISSION, hasCatalogPermission } from "../catalog-taxonomy.constants";

/** Renders Module 5 navigation using only server-derived permission codes. */
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
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Catalog Taxonomy
          </p>
          <p className="mt-1 font-semibold">{user.displayName}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        <Button asChild variant="ghost">
          <Link to="/account">Account</Link>
        </Button>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Catalog taxonomy navigation">
        {canManageCategories ? (
          <Link
            to="/admin/catalog/categories"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Categories
          </Link>
        ) : null}
        {canManageBrands ? (
          <Link
            to="/admin/catalog/brands"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Brands
          </Link>
        ) : null}
        {canManageAttributes ? (
          <Link
            to="/admin/catalog/attributes"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Attributes
          </Link>
        ) : null}
        {canManageCategories ? (
          <Link
            to="/admin/catalog/category-attributes"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Category mappings
          </Link>
        ) : null}
        {canReadSellerTaxonomy ? (
          <Link
            to="/seller/catalog-taxonomy"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Seller taxonomy selector
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

/** Protects Module 5 pages and supplies the authenticated actor to child content. */
export function CatalogTaxonomyLayout({
  children,
}: {
  children: (user: AuthenticatedUser) => ReactNode;
}) {
  return (
    <AuthenticatedPanel>
      {(user) => (
        <div className="space-y-6">
          <CatalogNavigation user={user} />
          {children(user)}
        </div>
      )}
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

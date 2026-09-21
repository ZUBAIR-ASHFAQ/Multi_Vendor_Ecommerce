import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  WORKSPACE_NAV_ACTIVE_CLASS,
  WORKSPACE_NAV_LINK_CLASS,
  WorkspaceNavGroup,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@/components/workspace/workspace-shell";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { useLogoutMutation } from "@/features/auth/hooks/use-auth";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { CATALOG_PERMISSION } from "@/features/catalog-taxonomy/catalog-taxonomy.constants";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { CUSTOMER_PERMISSION } from "@/features/customers/customers.constants";
import { DOCUMENT_AUDIT_PERMISSION } from "@/features/documents-audit/documents-audit.constants";
import { NOTIFICATIONS_PERMISSION } from "@/features/notifications/notifications.constants";
import { ORDERS_PERMISSION } from "@/features/orders/orders.constants";
import { PAYMENTS_PERMISSION } from "@/features/payments/payments.constants";
import { PRODUCT_PERMISSION } from "@/features/products/products.constants";
import { PROMOTION_PERMISSION } from "@/features/promotions/promotions.constants";
import { REPORTS_PERMISSION } from "@/features/reports/reports.constants";
import { REVIEWS_PERMISSION } from "@/features/reviews/reviews.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { SELLER_PERMISSION } from "@/features/sellers/sellers.constants";
import { ADMIN_PERMISSION, hasPermission } from "../administration.constants";

/** Returns true when an admin actor can use any Reports & Analytics surface. */
function canOpenReports(user: AuthenticatedUser): boolean {
  return [REPORTS_PERMISSION.SALES_READ, REPORTS_PERMISSION.INVENTORY_READ, REPORTS_PERMISSION.FINANCE_READ, REPORTS_PERMISSION.SELLER_READ, REPORTS_PERMISSION.EXPORT]
    .some((permission) => user.permissions.includes(permission));
}

/** Returns whether the current admin actor owns one permission. */
function permitted(user: AuthenticatedUser, permission: string): boolean {
  return hasPermission(user.permissions, permission);
}

/** Premium admin control-center navigation filtered by server-provided permissions. */
export function AdminNavigation({ user }: { user: AuthenticatedUser }) {
  const navigate = useNavigate();
  const logout = useLogoutMutation();

  const canUseCommerce = [
    ORDERS_PERMISSION.ADMIN_READ,
    PAYMENTS_PERMISSION.ADMIN_READ,
    "admin.returns.manage",
    REVIEWS_PERMISSION.ADMIN_MODERATE,
  ].some((permission) => permitted(user, permission));
  const canUseMarketplace = [
    SELLER_PERMISSION.ADMIN_REVIEW,
    SELLER_PERMISSION.ADMIN_SUSPEND,
    CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ,
    PRODUCT_PERMISSION.ADMIN_REVIEW,
    PROMOTION_PERMISSION.ADMIN_MANAGE,
  ].some((permission) => permitted(user, permission));
  const canUseCatalog = [
    CATALOG_PERMISSION.MANAGE_CATEGORIES,
    CATALOG_PERMISSION.MANAGE_BRANDS,
    CATALOG_PERMISSION.MANAGE_ATTRIBUTES,
  ].some((permission) => permitted(user, permission));
  const canUseFinance = permitted(user, COMMISSIONS_PERMISSION.ADMIN_READ)
    || permitted(user, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ);
  const canUseDocuments = [
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_UPLOAD,
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ,
    DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_LINK,
  ].some((permission) => permitted(user, permission));
  const canUseOperations = canOpenReports(user)
    || canUseDocuments
    || permitted(user, DOCUMENT_AUDIT_PERMISSION.AUDIT_READ)
    || permitted(user, NOTIFICATIONS_PERMISSION.ADMIN_READ);
  const canUseAccess = [
    ADMIN_PERMISSION.USERS_READ,
    ADMIN_PERMISSION.ROLES_READ,
    ADMIN_PERMISSION.SETTINGS_MANAGE,
  ].some((permission) => permitted(user, permission));

  return (
    <WorkspaceSidebar
      ariaLabel="Administration navigation"
      kicker="Marketplace control center"
      title={user.displayName}
      subtitle={<>{user.email} · {user.accountType}</>}
      footer={(
        <>
          <strong>● Platform healthy</strong>
          <p>Operational navigation stays permission-aware and backed by your current API authorization model.</p>
          <div className="workspace-account-actions">
            <Button variant="outline" size="sm" asChild><Link to="/account">Account</Link></Button>
            <Button variant="outline" size="sm" disabled={logout.isPending} onClick={() => { void logout.mutateAsync().then(() => navigate({ to: "/login" })); }}>Sign out</Button>
          </div>
        </>
      )}
    >
      {user.permissions.includes("dashboard.read") ? (
        <WorkspaceNavGroup label="Overview">
          <Link to="/dashboard" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Dashboard <span>⌂</span></Link>
        </WorkspaceNavGroup>
      ) : null}

      {canUseCommerce ? (
        <WorkspaceNavGroup label="Commerce">
          {permitted(user, ORDERS_PERMISSION.ADMIN_READ) ? <Link to="/admin/orders" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Orders <span>›</span></Link> : null}
          {permitted(user, PAYMENTS_PERMISSION.ADMIN_READ) ? <Link to="/admin/payments" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Payments <span>›</span></Link> : null}
          {permitted(user, "admin.returns.manage") ? <Link to="/admin/returns" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Returns & refunds <span>›</span></Link> : null}
          {permitted(user, REVIEWS_PERMISSION.ADMIN_MODERATE) ? <Link to="/admin/reviews" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Reviews <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}

      {canUseMarketplace ? (
        <WorkspaceNavGroup label="Marketplace">
          {permitted(user, SELLER_PERMISSION.ADMIN_REVIEW) ? <Link to="/admin/seller-applications" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Seller applications <span>›</span></Link> : null}
          {permitted(user, SELLER_PERMISSION.ADMIN_SUSPEND) ? <Link to="/admin/sellers/suspend" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Seller controls <span>›</span></Link> : null}
          {permitted(user, CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ) ? <Link to="/admin/customers" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Customers <span>›</span></Link> : null}
          {permitted(user, PRODUCT_PERMISSION.ADMIN_REVIEW) ? <Link to="/admin/products" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Product approvals <span>›</span></Link> : null}
          {permitted(user, PROMOTION_PERMISSION.ADMIN_MANAGE) ? <Link to="/admin/promotions" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Promotions <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}

      {canUseCatalog ? (
        <WorkspaceNavGroup label="Catalog">
          {permitted(user, CATALOG_PERMISSION.MANAGE_CATEGORIES) ? <Link to="/admin/catalog/categories" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Categories & subcategories <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_BRANDS) ? <Link to="/admin/catalog/brands" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Brands <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_ATTRIBUTES) ? <Link to="/admin/catalog/attributes" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Attributes <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_CATEGORIES) ? <Link to="/admin/catalog/category-attributes" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Category attribute mapping <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}

      {canUseFinance ? (
        <WorkspaceNavGroup label="Finance">
          {permitted(user, COMMISSIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/commissions/rules" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Commission rules <span>›</span></Link> : null}
          {permitted(user, COMMISSIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/commissions/entries" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Commission ledger <span>›</span></Link> : null}
          {permitted(user, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ) ? <Link to="/admin/payouts" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Payouts <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}

      {canUseOperations ? (
        <WorkspaceNavGroup label="Operations">
          {permitted(user, NOTIFICATIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/notification-deliveries" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Notification failures <span>›</span></Link> : null}
          {canOpenReports(user) ? <Link to="/reports" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Reports <span>›</span></Link> : null}
          {canUseDocuments ? <Link to="/documents" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Documents <span>›</span></Link> : null}
          {permitted(user, DOCUMENT_AUDIT_PERMISSION.AUDIT_READ) ? <Link to="/audit" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Audit <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}

      {canUseAccess ? (
        <WorkspaceNavGroup label="Access">
          {permitted(user, ADMIN_PERMISSION.USERS_READ) ? <Link to="/admin/users" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Users <span>›</span></Link> : null}
          {permitted(user, ADMIN_PERMISSION.ROLES_READ) ? <Link to="/admin/roles" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Roles <span>›</span></Link> : null}
          {permitted(user, ADMIN_PERMISSION.SETTINGS_MANAGE) ? <Link to="/admin/settings" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Settings <span>›</span></Link> : null}
        </WorkspaceNavGroup>
      ) : null}
    </WorkspaceSidebar>
  );
}

/** Protects an administration page and supplies the current authenticated actor. */
export function AdminLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => <WorkspaceShell sidebar={<AdminNavigation user={user} />}>{children(user)}</WorkspaceShell>}
    </AuthenticatedPanel>
  );
}

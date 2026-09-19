import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { useLogoutMutation } from "@/features/auth/hooks/use-auth";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { CATALOG_PERMISSION } from "@/features/catalog-taxonomy/catalog-taxonomy.constants";
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

const navClass = "workspace-nav-link";
const activeClass = "workspace-nav-link workspace-nav-link-active";

/** Returns true when an admin actor can use any Reports & Analytics surface. */
function canOpenReports(user: AuthenticatedUser): boolean {
  return [REPORTS_PERMISSION.SALES_READ, REPORTS_PERMISSION.INVENTORY_READ, REPORTS_PERMISSION.FINANCE_READ, REPORTS_PERMISSION.SELLER_READ, REPORTS_PERMISSION.EXPORT]
    .some((permission) => user.permissions.includes(permission));
}

function permitted(user: AuthenticatedUser, permission: string): boolean {
  return hasPermission(user.permissions, permission);
}

/** Premium admin control-center navigation filtered by server-provided permissions. */
function AdminNavigation({ user }: { user: AuthenticatedUser }) {
  const navigate = useNavigate();
  const logout = useLogoutMutation();

  return (
    <aside className="workspace-sidebar" aria-label="Administration navigation">
      <div className="workspace-sidebar-header">
        <p className="workspace-sidebar-kicker">Marketplace control center</p>
        <h2 className="workspace-sidebar-title">{user.displayName}</h2>
        <p className="workspace-sidebar-subtitle">{user.email} · {user.accountType}</p>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Control center</p>
        <nav className="workspace-nav-list">
          {user.permissions.includes("dashboard.read") ? <Link to="/dashboard" className={navClass} activeProps={{ className: activeClass }}>Dashboard <span>⌂</span></Link> : null}
          {permitted(user, ORDERS_PERMISSION.ADMIN_READ) ? <Link to="/admin/orders" className={navClass} activeProps={{ className: activeClass }}>Orders <span>›</span></Link> : null}
          {permitted(user, SELLER_PERMISSION.ADMIN_REVIEW) ? <Link to="/admin/seller-applications" className={navClass} activeProps={{ className: activeClass }}>Seller applications <span>›</span></Link> : null}
          {permitted(user, CUSTOMER_PERMISSION.ADMIN_CUSTOMERS_READ) ? <Link to="/admin/customers" className={navClass} activeProps={{ className: activeClass }}>Customers <span>›</span></Link> : null}
          {permitted(user, SELLER_PERMISSION.ADMIN_SUSPEND) ? <Link to="/admin/sellers/suspend" className={navClass} activeProps={{ className: activeClass }}>Seller controls <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Commerce</p>
        <nav className="workspace-nav-list">
          {permitted(user, PAYMENTS_PERMISSION.ADMIN_READ) ? <Link to="/admin/payments" className={navClass} activeProps={{ className: activeClass }}>Payments <span>›</span></Link> : null}
          {permitted(user, "admin.returns.manage") ? <Link to="/admin/returns" className={navClass} activeProps={{ className: activeClass }}>Returns & refunds <span>›</span></Link> : null}
          {permitted(user, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ) ? <Link to="/admin/payouts" className={navClass} activeProps={{ className: activeClass }}>Payouts <span>›</span></Link> : null}
          {permitted(user, COMMISSIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/commissions/entries" className={navClass} activeProps={{ className: activeClass }}>Commission ledger <span>›</span></Link> : null}
          {permitted(user, COMMISSIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/commissions/rules" className={navClass} activeProps={{ className: activeClass }}>Commission rules <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Catalog</p>
        <nav className="workspace-nav-list">
          {permitted(user, PRODUCT_PERMISSION.ADMIN_REVIEW) ? <Link to="/admin/products" className={navClass} activeProps={{ className: activeClass }}>Product approvals <span>â€º</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_CATEGORIES) ? <Link to="/admin/catalog/categories" className={navClass} activeProps={{ className: activeClass }}>Categories & subcategories <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_BRANDS) ? <Link to="/admin/catalog/brands" className={navClass} activeProps={{ className: activeClass }}>Brands <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_ATTRIBUTES) ? <Link to="/admin/catalog/attributes" className={navClass} activeProps={{ className: activeClass }}>Attributes <span>›</span></Link> : null}
          {permitted(user, CATALOG_PERMISSION.MANAGE_CATEGORIES) ? <Link to="/admin/catalog/category-attributes" className={navClass} activeProps={{ className: activeClass }}>Category attribute mapping <span>›</span></Link> : null}
          {permitted(user, PROMOTION_PERMISSION.ADMIN_MANAGE) ? <Link to="/admin/promotions" className={navClass} activeProps={{ className: activeClass }}>Promotions <span>›</span></Link> : null}
          {permitted(user, REVIEWS_PERMISSION.ADMIN_MODERATE) ? <Link to="/admin/reviews" className={navClass} activeProps={{ className: activeClass }}>Reviews <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Platform</p>
        <nav className="workspace-nav-list">
          {permitted(user, ADMIN_PERMISSION.USERS_READ) ? <Link to="/admin/users" className={navClass} activeProps={{ className: activeClass }}>Users <span>›</span></Link> : null}
          {permitted(user, ADMIN_PERMISSION.ROLES_READ) ? <Link to="/admin/roles" className={navClass} activeProps={{ className: activeClass }}>Roles <span>›</span></Link> : null}
          {canOpenReports(user) ? <Link to="/reports" className={navClass} activeProps={{ className: activeClass }}>Reports <span>›</span></Link> : null}
          {permitted(user, DOCUMENT_AUDIT_PERMISSION.DOCUMENTS_READ) ? <Link to="/documents" className={navClass} activeProps={{ className: activeClass }}>Documents <span>›</span></Link> : null}
          {permitted(user, DOCUMENT_AUDIT_PERMISSION.AUDIT_READ) ? <Link to="/audit" className={navClass} activeProps={{ className: activeClass }}>Audit <span>›</span></Link> : null}
          {permitted(user, NOTIFICATIONS_PERMISSION.ADMIN_READ) ? <Link to="/admin/notification-deliveries" className={navClass} activeProps={{ className: activeClass }}>Notification failures <span>›</span></Link> : null}
          {permitted(user, ADMIN_PERMISSION.SETTINGS_MANAGE) ? <Link to="/admin/settings" className={navClass} activeProps={{ className: activeClass }}>Settings <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-sidebar-footer">
        <strong>● Platform healthy</strong>
        <p>Operational navigation stays permission-aware and backed by your current API authorization model.</p>
        <div className="workspace-account-actions">
          <Button variant="outline" size="sm" asChild><Link to="/account">Account</Link></Button>
          <Button variant="outline" size="sm" disabled={logout.isPending} onClick={() => { void logout.mutateAsync().then(() => navigate({ to: "/login" })); }}>Sign out</Button>
        </div>
      </div>
    </aside>
  );
}

function Layout({ user, children }: { user: AuthenticatedUser; children: ReactNode }) {
  return <div className="workspace-frame"><AdminNavigation user={user} /><div className="workspace-main">{children}</div></div>;
}

/** Protects an administration page and supplies the current authenticated actor. */
export function AdminLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return <AuthenticatedPanel>{(user) => <Layout user={user}>{children(user)}</Layout>}</AuthenticatedPanel>;
}

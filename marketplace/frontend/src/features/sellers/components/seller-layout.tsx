import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { REPORTS_PERMISSION } from "@/features/reports/reports.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { hasSellerPermission, SELLER_PERMISSION } from "../sellers.constants";

const navClass = "workspace-nav-link";
const activeClass = "workspace-nav-link workspace-nav-link-active";

/** Renders seller self-service navigation from the server-derived permission set. */
function SellerNavigation({ user }: { user: AuthenticatedUser }) {
  const canReadProfile = hasSellerPermission(user.permissions, SELLER_PERMISSION.PROFILE_READ);
  const canManageStores = hasSellerPermission(user.permissions, SELLER_PERMISSION.STORE_MANAGE);
  const canManageStaff = hasSellerPermission(user.permissions, SELLER_PERMISSION.STAFF_MANAGE);
  const canReadProducts = user.permissions.includes("seller.products.read");
  const canReadInventory = user.permissions.includes("inventory.read");
  const canManagePromotions = user.permissions.includes("seller.promotions.manage");
  const canReadOrders = user.permissions.includes("seller.orders.read");
  const canReadShipments = user.permissions.includes("seller.shipping.read");
  const canManageReturns = user.permissions.includes("seller.returns.manage");
  const canReadCommissions = user.permissions.includes(COMMISSIONS_PERMISSION.SELLER_READ);
  const canReadWallet = user.permissions.includes(WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ);
  const canReadReports = user.permissions.includes(REPORTS_PERMISSION.SELLER_READ);

  return (
    <aside className="workspace-sidebar" aria-label="Seller workspace navigation">
      <div className="workspace-sidebar-header">
        <p className="workspace-sidebar-kicker">Seller workspace</p>
        <h2 className="workspace-sidebar-title">{user.displayName}</h2>
        <p className="workspace-sidebar-subtitle">{user.email}</p>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Overview</p>
        <nav className="workspace-nav-list">
          {user.permissions.includes("dashboard.read") ? <Link to="/dashboard" className={navClass} activeProps={{ className: activeClass }}>Dashboard <span>⌂</span></Link> : null}
          {canReadOrders ? <Link to="/seller/orders" className={navClass} activeProps={{ className: activeClass }}>Orders <span>›</span></Link> : null}
          {canReadProducts ? <Link to="/seller/products" className={navClass} activeProps={{ className: activeClass }}>Products <span>›</span></Link> : null}
          {canReadInventory ? <Link to="/seller/inventory" className={navClass} activeProps={{ className: activeClass }}>Inventory <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Growth & fulfillment</p>
        <nav className="workspace-nav-list">
          {canManagePromotions ? <Link to="/seller/promotions" className={navClass} activeProps={{ className: activeClass }}>Offers & promotions <span>›</span></Link> : null}
          {canReadShipments ? <Link to="/seller/shipments" className={navClass} activeProps={{ className: activeClass }}>Shipping <span>›</span></Link> : null}
          {canManageReturns ? <Link to="/seller/returns" className={navClass} activeProps={{ className: activeClass }}>Returns <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Finance</p>
        <nav className="workspace-nav-list">
          {canReadWallet ? <Link to="/seller/wallet" className={navClass} activeProps={{ className: activeClass }}>Wallet <span>›</span></Link> : null}
          {canReadWallet ? <Link to="/seller/payouts" className={navClass} activeProps={{ className: activeClass }}>Payouts <span>›</span></Link> : null}
          {canReadCommissions ? <Link to="/seller/commissions" className={navClass} activeProps={{ className: activeClass }}>Commissions <span>›</span></Link> : null}
          {canReadReports ? <Link to="/reports" className={navClass} activeProps={{ className: activeClass }}>Reports <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-nav-group">
        <p className="workspace-nav-label">Workspace</p>
        <nav className="workspace-nav-list">
          {canManageStores ? <Link to="/seller/stores" className={navClass} activeProps={{ className: activeClass }}>Stores <span>›</span></Link> : null}
          {canManageStaff ? <Link to="/seller/staff" className={navClass} activeProps={{ className: activeClass }}>Staff access <span>›</span></Link> : null}
          {canReadProfile ? <Link to="/seller/profile" className={navClass} activeProps={{ className: activeClass }}>Seller profile <span>›</span></Link> : null}
        </nav>
      </div>

      <div className="workspace-sidebar-footer">
        <strong>● Platform healthy</strong>
        <p>Orders, payments, inventory and payouts remain connected to their existing source modules.</p>
        <div className="workspace-account-actions"><Button asChild variant="outline" size="sm"><Link to="/account">Account</Link></Button></div>
      </div>
    </aside>
  );
}

/** Protects seller self-service pages and supplies the current seller actor. */
export function SellerLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => {
        if (user.accountType !== "seller") {
          return <ErrorState title="Seller account required" message="This page is available after a seller application has been approved and the account has seller access." />;
        }
        return <div className="workspace-frame"><SellerNavigation user={user} /><div className="workspace-main">{children(user)}</div></div>;
      }}
    </AuthenticatedPanel>
  );
}

/** Renders a clear permission state when one seller workflow is unavailable. */
export function RequireSellerPermission({ user, permission, children }: { user: AuthenticatedUser; permission: string; children: ReactNode }) {
  if (!hasSellerPermission(user.permissions, permission)) {
    return <ErrorState title="Access denied" message="Your seller account does not have permission to use this feature." />;
  }
  return <>{children}</>;
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import {
  WORKSPACE_NAV_ACTIVE_CLASS,
  WORKSPACE_NAV_LINK_CLASS,
  WorkspaceNavGroup,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@/components/workspace/workspace-shell";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { REPORTS_PERMISSION } from "@/features/reports/reports.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { hasSellerPermission, SELLER_PERMISSION } from "../sellers.constants";

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
    <WorkspaceSidebar
      ariaLabel="Seller workspace navigation"
      kicker="Seller workspace"
      title={user.displayName}
      subtitle={user.email}
      footer={(
        <>
          <strong>● Platform healthy</strong>
          <p>Orders, payments, inventory and payouts remain connected to their existing source modules.</p>
          <div className="workspace-account-actions">
            <Button asChild variant="outline" size="sm"><Link to="/account">Account</Link></Button>
          </div>
        </>
      )}
    >
      <WorkspaceNavGroup label="Overview">
        {user.permissions.includes("dashboard.read") ? <Link to="/dashboard" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Dashboard <span>⌂</span></Link> : null}
        {canReadOrders ? <Link to="/seller/orders" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Orders <span>›</span></Link> : null}
        {canReadProducts ? <Link to="/seller/products" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Products <span>›</span></Link> : null}
        {canReadInventory ? <Link to="/seller/inventory" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Inventory <span>›</span></Link> : null}
      </WorkspaceNavGroup>

      <WorkspaceNavGroup label="Growth & fulfillment">
        {canManagePromotions ? <Link to="/seller/promotions" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Offers & promotions <span>›</span></Link> : null}
        {canReadShipments ? <Link to="/seller/shipments" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Shipping <span>›</span></Link> : null}
        {canManageReturns ? <Link to="/seller/returns" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Returns <span>›</span></Link> : null}
      </WorkspaceNavGroup>

      <WorkspaceNavGroup label="Finance">
        {canReadWallet ? <Link to="/seller/wallet" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Wallet <span>›</span></Link> : null}
        {canReadWallet ? <Link to="/seller/payouts" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Payouts <span>›</span></Link> : null}
        {canReadCommissions ? <Link to="/seller/commissions" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Commissions <span>›</span></Link> : null}
        {canReadReports ? <Link to="/reports" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Reports <span>›</span></Link> : null}
      </WorkspaceNavGroup>

      <WorkspaceNavGroup label="Workspace">
        {canManageStores ? <Link to="/seller/stores" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Stores <span>›</span></Link> : null}
        {canManageStaff ? <Link to="/seller/staff" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Staff access <span>›</span></Link> : null}
        {canReadProfile ? <Link to="/seller/profile" className={WORKSPACE_NAV_LINK_CLASS} activeProps={{ className: WORKSPACE_NAV_ACTIVE_CLASS }}>Seller profile <span>›</span></Link> : null}
      </WorkspaceNavGroup>
    </WorkspaceSidebar>
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
        return <WorkspaceShell sidebar={<SellerNavigation user={user} />}>{children(user)}</WorkspaceShell>;
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

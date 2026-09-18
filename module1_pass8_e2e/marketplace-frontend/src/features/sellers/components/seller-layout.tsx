import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { COMMISSIONS_PERMISSION } from "@/features/commissions/commissions.constants";
import { WALLET_PAYOUT_PERMISSION } from "@/features/seller-wallet-payouts/seller-wallet-payouts.constants";
import { REPORTS_PERMISSION } from "@/features/reports/reports.constants";
import { hasSellerPermission, SELLER_PERMISSION } from "../sellers.constants";

/** Renders seller self-service navigation from the server-derived permission set. */
function SellerNavigation({ user }: { user: AuthenticatedUser }) {
  const canReadProfile = hasSellerPermission(user.permissions, SELLER_PERMISSION.PROFILE_READ);
  const canManageStores = hasSellerPermission(user.permissions, SELLER_PERMISSION.STORE_MANAGE);
  const canManageStaff = hasSellerPermission(user.permissions, SELLER_PERMISSION.STAFF_MANAGE);
  const canReadCatalog = user.permissions.includes("catalog.read");
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
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Seller & Store Management</p>
          <p className="mt-1 font-semibold">{user.displayName}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        <Button asChild variant="ghost">
          <Link to="/account">Account</Link>
        </Button>
      </div>
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Seller navigation">
        {canReadProfile ? (
          <Link
            to="/seller/profile"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Seller profile
          </Link>
        ) : null}
        {canManageStores ? (
          <Link
            to="/seller/stores"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Stores
          </Link>
        ) : null}
        {canManageStaff ? (
          <Link
            to="/seller/staff"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Staff access
          </Link>
        ) : null}
        {canReadCatalog ? (
          <Link
            to="/seller/catalog-taxonomy"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Catalog taxonomy
          </Link>
        ) : null}
        {canReadProducts ? (
          <Link
            to="/seller/products"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Products
          </Link>
        ) : null}
        {canReadInventory ? (
          <Link
            to="/seller/inventory"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Inventory
          </Link>
        ) : null}
        {canReadOrders ? (
          <Link
            to="/seller/orders"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Orders
          </Link>
        ) : null}
        {canReadShipments ? (
          <Link
            to="/seller/shipments"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Shipments
          </Link>
        ) : null}
        {canManageReturns ? (
          <Link
            to="/seller/returns"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Returns
          </Link>
        ) : null}
        {canManagePromotions ? (
          <Link
            to="/seller/promotions"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Promotions
          </Link>
        ) : null}
        {canReadCommissions ? (
          <Link
            to="/seller/commissions"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Commissions
          </Link>
        ) : null}
        {canReadReports ? (
          <Link
            to="/reports"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
          >
            Reports
          </Link>
        ) : null}
        {canReadWallet ? (
          <>
            <Link
              to="/seller/wallet"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Wallet
            </Link>
            <Link
              to="/seller/payouts"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              activeProps={{ className: "bg-slate-900 text-white hover:bg-slate-900" }}
            >
              Payouts
            </Link>
          </>
        ) : null}
      </nav>
    </section>
  );
}

/** Protects seller self-service pages and supplies the current seller actor. */
export function SellerLayout({ children }: { children: (user: AuthenticatedUser) => ReactNode }) {
  return (
    <AuthenticatedPanel>
      {(user) => {
        if (user.accountType !== "seller") {
          return (
            <ErrorState
              title="Seller account required"
              message="This page is available after a seller application has been approved and the account has seller access."
            />
          );
        }
        return (
          <div className="space-y-6">
            <SellerNavigation user={user} />
            {children(user)}
          </div>
        );
      }}
    </AuthenticatedPanel>
  );
}

/** Renders a clear permission state when one seller workflow is unavailable. */
export function RequireSellerPermission({
  user,
  permission,
  children,
}: {
  user: AuthenticatedUser;
  permission: string;
  children: ReactNode;
}) {
  if (!hasSellerPermission(user.permissions, permission)) {
    return (
      <ErrorState
        title="Access denied"
        message="Your seller account does not have permission to use this feature."
      />
    );
  }
  return <>{children}</>;
}

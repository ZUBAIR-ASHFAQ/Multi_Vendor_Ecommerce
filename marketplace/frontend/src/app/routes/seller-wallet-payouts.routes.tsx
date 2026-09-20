import { createRoute } from "@tanstack/react-router";
import { AdminPayoutsPage } from "@/features/seller-wallet-payouts/pages/admin-payouts.page";
import { SellerPayoutsPage } from "@/features/seller-wallet-payouts/pages/seller-payouts.page";
import { SellerWalletPage } from "@/features/seller-wallet-payouts/pages/seller-wallet.page";
import { rootRoute } from "./root.route";

/** Seller Wallet summary, immutable ledger, and payout-account setup route. */
export const sellerWalletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/wallet",
  component: SellerWalletPage,
});

/** Seller Payout history and request route. */
export const sellerPayoutsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/payouts",
  component: SellerPayoutsPage,
});

/** Finance Payout queue and reconciliation route. */
export const adminPayoutsQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/payouts",
  component: AdminPayoutsPage,
});

import { createRoute } from "@tanstack/react-router";
import { AdminCommissionLedgerPage } from "@/features/commissions/pages/admin-commission-ledger.page";
import { AdminCommissionRulesPage } from "@/features/commissions/pages/admin-commission-rules.page";
import { SellerCommissionStatementPage } from "@/features/commissions/pages/seller-commission-statement.page";
import { rootRoute } from "./root.route";

/** Finance/admin Commission rule manager route. */
export const adminCommissionRulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/commissions/rules",
  component: AdminCommissionRulesPage,
});

/** Finance/admin immutable Commission ledger route. */
export const adminCommissionLedgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/commissions/entries",
  component: AdminCommissionLedgerPage,
});

/** Seller-owned Commission statement route. */
export const sellerCommissionStatementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/seller/commissions",
  component: SellerCommissionStatementPage,
});

import { createRoute } from "@tanstack/react-router";
import { CommissionsReportPage } from "@/features/reports/pages/commissions-report.page";
import { InventoryReportPage } from "@/features/reports/pages/inventory-report.page";
import { PayoutsReportPage } from "@/features/reports/pages/payouts-report.page";
import { RefundsReportPage } from "@/features/reports/pages/refunds-report.page";
import { ReportCatalogPage } from "@/features/reports/pages/report-catalog.page";
import { ReportRunPage } from "@/features/reports/pages/report-run.page";
import { SalesReportPage } from "@/features/reports/pages/sales-report.page";
import { SellersReportPage } from "@/features/reports/pages/sellers-report.page";
import { rootRoute } from "./root.route";

/** Permission-filtered Reports catalog route. */
export const reportsCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportCatalogPage,
});

/** Sales and Orders reporting route. */
export const salesReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/sales",
  component: SalesReportPage,
});

/** Seller performance and settlement reporting route. */
export const sellersReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/sellers",
  component: SellersReportPage,
});

/** Inventory and low-stock reporting route. */
export const inventoryReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/inventory",
  component: InventoryReportPage,
});

/** Return and Refund reporting route. */
export const refundsReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/refunds",
  component: RefundsReportPage,
});

/** Marketplace Commission reporting route. */
export const commissionsReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/commissions",
  component: CommissionsReportPage,
});

/** Seller liability and Payout reporting route. */
export const payoutsReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/payouts",
  component: PayoutsReportPage,
});

/** Requester-owned asynchronous export status and download route. */
export const reportRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports/runs/$runId",
  component: ReportRunPage,
});

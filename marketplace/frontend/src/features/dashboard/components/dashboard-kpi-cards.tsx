import { Link } from "@tanstack/react-router";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardMoneyList } from "./dashboard-money-list";
import type { DashboardSummary } from "../types/dashboard.types";

/** Renders operational KPIs with seller-specific labels while preserving the same server-owned measures. */
export function DashboardKpiCards({
  summary,
  sellerMode = false,
}: {
  summary: DashboardSummary;
  sellerMode?: boolean;
}) {
  return (
    <section className="space-y-3" aria-labelledby="dashboard-kpi-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {sellerMode ? "Performance" : "Marketplace performance"}
          </p>
          <h2 id="dashboard-kpi-title" className="mt-1 text-xl font-semibold">
            {sellerMode ? "Business snapshot" : "Executive KPIs"}
          </h2>
        </div>
        <Link to="/reports/sales" className="text-sm font-medium underline">Open sales report</Link>
      </div>
      <div className="dashboard-kpi-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={sellerMode ? "Gross sales" : "GMV"}
          value={<DashboardMoneyList amounts={summary.gmvByCurrency} />}
          meta="Finalized sales in the selected period."
        />
        <StatCard
          label="Orders"
          value={summary.orderCount}
          meta="Distinct finalized orders in scope."
        />
        <StatCard
          label="Low-stock variants"
          value={summary.lowStockVariantCount}
          meta="Variants at or below their reorder level."
        />
        <StatCard
          label="Open returns"
          value={summary.openReturnCount}
          meta="Return requests still requiring resolution."
        />
      </div>
    </section>
  );
}

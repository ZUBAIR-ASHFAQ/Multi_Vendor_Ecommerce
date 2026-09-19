import { Link } from "@tanstack/react-router";
import { DashboardMoneyList } from "./dashboard-money-list";
import type { DashboardSummary } from "../types/dashboard.types";

/** Renders the executive operational KPIs without combining distinct money concepts. */
export function DashboardKpiCards({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="space-y-3" aria-labelledby="dashboard-kpi-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-kpi-title" className="text-xl font-semibold">Executive KPIs</h2>
        <Link to="/reports/sales" className="text-sm font-medium underline">Open sales report</Link>
      </div>
      <div className="dashboard-kpi-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Orders</p>
          <p className="mt-2 text-2xl font-bold">{summary.orderCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Low-stock variants</p>
          <p className="mt-2 text-2xl font-bold">{summary.lowStockVariantCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Open returns</p>
          <p className="mt-2 text-2xl font-bold">{summary.openReturnCount}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">GMV</p>
          <div className="mt-2"><DashboardMoneyList amounts={summary.gmvByCurrency} /></div>
        </div>
      </div>
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import { DashboardMoneyList } from "./dashboard-money-list";
import type { DashboardSummary } from "../types/dashboard.types";

/** Renders refund/return status while keeping refunded payment value distinct from return count. */
export function DashboardRefundReturnSummary({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm" aria-labelledby="dashboard-refunds-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-refunds-title" className="text-xl font-semibold">Refund & return summary</h2>
        <Link to="/reports/refunds" className="text-sm font-medium underline">Open refunds report</Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Open returns</p>
          <p className="mt-1 text-2xl font-bold">{summary.openReturnCount}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Refunded payments</p>
          <div className="mt-1">
            {summary.finance ? (
              <DashboardMoneyList amounts={summary.finance.refundedPaymentsByCurrency} />
            ) : (
              <span className="text-sm text-slate-500">Finance permission required</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Renders separate captured cash, commission revenue, seller payable and paid payout values. */
export function DashboardCommissionPayoutSummary({ summary }: { summary: DashboardSummary }) {
  if (!summary.finance) return null;
  return (
    <section className="space-y-3" aria-labelledby="dashboard-finance-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-finance-title" className="text-xl font-semibold">Commission & payout summary</h2>
        <div className="flex gap-3 text-sm font-medium underline">
          <Link to="/reports/commissions">Commissions</Link>
          <Link to="/reports/payouts">Payouts</Link>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Captured cash</p>
          <div className="mt-2">
            <DashboardMoneyList amounts={summary.finance.capturedCashByCurrency} />
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Marketplace commission revenue
          </p>
          <div className="mt-2">
            <DashboardMoneyList amounts={summary.finance.marketplaceCommissionRevenueByCurrency} />
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Seller payable</p>
          <div className="mt-2">
            <DashboardMoneyList amounts={summary.finance.sellerPayableByCurrency} />
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Seller payouts paid</p>
          <div className="mt-2">
            <DashboardMoneyList amounts={summary.finance.sellerPayoutsPaidByCurrency} />
          </div>
        </div>
      </div>
    </section>
  );
}

import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/money";
import type { SellerCommissionSummary as Summary } from "../schemas/commissions.schemas";

/** Renders currency-separated seller earnings totals without mixing unrelated currencies. */
export function SellerCommissionSummary({ summaries }: { summaries: Summary[] }) {
  if (summaries.length === 0) {
    return (
      <p className="rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
        No Commission totals match the current statement filters.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {summaries.map((summary) => (
        <section key={summary.currency} className="space-y-3" aria-label={`${summary.currency} commission statement summary`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{summary.currency} earnings summary</h2>
              <p className="text-xs text-slate-500">Server-calculated totals across the full filtered statement, not only this page.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{summary.currency}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Gross sales" value={formatMoney(summary.grossAmount, summary.currency)} />
            <StatCard label="Seller discounts" value={formatMoney(summary.sellerFundedDiscountAmount, summary.currency)} />
            <StatCard label="Marketplace fees" value={formatMoney(summary.commissionAmount, summary.currency)} />
            <StatCard label="Refund adjustments" value={formatMoney(summary.refundAdjustmentAmount, summary.currency)} />
            <StatCard
              label="Seller net"
              value={formatMoney(summary.sellerNetAmount, summary.currency)}
              meta="Net amount after seller-funded discounts, marketplace fees, and refund adjustments."
            />
          </div>
        </section>
      ))}
    </div>
  );
}

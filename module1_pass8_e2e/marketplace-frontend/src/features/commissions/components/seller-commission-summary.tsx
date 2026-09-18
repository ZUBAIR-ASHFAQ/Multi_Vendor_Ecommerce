import type { SellerCommissionSummary as Summary } from "../schemas/commissions.schemas";

/** Renders currency-separated seller earnings totals without mixing unrelated currencies. */
export function SellerCommissionSummary({ summaries }: { summaries: Summary[] }) {
  if (summaries.length === 0) {
    return <p className="text-sm text-slate-500">No settled Commission totals are available yet.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {summaries.map((summary) => (
        <section key={summary.currency} className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{summary.currency} statement</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{summary.currency}</span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">Gross</dt><dd>{summary.grossAmount}</dd></div>
            <div><dt className="font-semibold">Seller-funded discounts</dt><dd>{summary.sellerFundedDiscountAmount}</dd></div>
            <div><dt className="font-semibold">Marketplace Commission</dt><dd>{summary.commissionAmount}</dd></div>
            <div><dt className="font-semibold">Refund adjustments</dt><dd>{summary.refundAdjustmentAmount}</dd></div>
            <div className="sm:col-span-2">
              <dt className="font-semibold">Seller net</dt>
              <dd className="text-lg font-bold">{summary.sellerNetAmount}</dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}

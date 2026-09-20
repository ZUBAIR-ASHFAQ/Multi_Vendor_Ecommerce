import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import type { PaginationMeta } from "@/types/api";
import type { DashboardSellers } from "../types/dashboard.types";

/** Renders a permission-safe seller performance table and bounded server pagination. */
export function DashboardSellerTable({
  sellers,
  meta,
  onPageChange,
}: {
  sellers: DashboardSellers;
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="dashboard-sellers-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-sellers-title" className="text-xl font-semibold">Seller performance</h2>
        <Link to="/reports/sellers" className="text-sm font-medium underline">Open seller report</Link>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        {sellers.rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No seller performance rows match these filters.</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3">Seller</th><th className="p-3">Orders</th><th className="p-3">GMV</th>
                <th className="p-3">Commission revenue</th><th className="p-3">Seller payable</th><th className="p-3">Payouts</th>
              </tr>
            </thead>
            <tbody>
              {sellers.rows.map((row) => (
                <tr key={`${row.sellerId}-${row.currency}`} className="border-t">
                  <td className="p-3 font-medium">{row.sellerName}</td>
                  <td className="p-3">{row.orderCount}</td>
                  <td className="p-3">{formatMoney(row.gmv, row.currency)}</td>
                  <td className="p-3">{row.finance ? formatMoney(row.finance.commissionRevenue, row.currency) : "Restricted"}</td>
                  <td className="p-3">{row.finance ? formatMoney(row.finance.sellerPayable, row.currency) : "Restricted"}</td>
                  <td className="p-3">{row.finance ? formatMoney(row.finance.payouts, row.currency) : "Restricted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} sellers</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>Previous</Button>
          <Button
            type="button"
            variant="outline"
            disabled={meta.page >= meta.totalPages}
            onClick={() => onPageChange(meta.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

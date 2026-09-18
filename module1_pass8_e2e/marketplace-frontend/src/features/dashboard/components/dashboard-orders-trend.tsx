import { Link } from "@tanstack/react-router";
import { ORDER_STATUS_LABEL } from "@/features/orders/orders.constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { DashboardOrders } from "../types/dashboard.types";

/** Renders status counts and the server-derived daily Orders/GMV trend. */
export function DashboardOrdersTrend({ orders }: { orders: DashboardOrders }) {
  return (
    <section className="space-y-3" aria-labelledby="dashboard-orders-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dashboard-orders-title" className="text-xl font-semibold">Orders & GMV trend</h2>
        <Link to="/reports/sales" className="text-sm font-medium underline">Drill down</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {orders.statusCounts.map((item) => (
          <div key={item.status} className="rounded-lg border bg-white p-3">
            <p className="text-xs text-slate-500">{ORDER_STATUS_LABEL[item.status] ?? item.status}</p>
            <p className="text-lg font-semibold">{item.count}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        {orders.trend.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No finalized order trend matches these filters.</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr><th className="p-3">Day</th><th className="p-3">Orders</th><th className="p-3">GMV</th></tr>
            </thead>
            <tbody>
              {orders.trend.map((point) => (
                <tr key={`${point.bucketStart}-${point.currency}`} className="border-t">
                  <td className="p-3">{formatDate(point.bucketStart)}</td>
                  <td className="p-3">{point.orderCount}</td>
                  <td className="p-3 font-medium">{formatMoney(point.gmv, point.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

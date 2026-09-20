import { Link } from "@tanstack/react-router";
import { ORDER_STATUS_LABEL } from "@/features/orders/orders.constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { DashboardOrders } from "../types/dashboard.types";

/** Creates presentation-only bar heights per currency without changing authoritative money values. */
function trendHeight(gmv: string, maximum: number): string {
  const numeric = Number(gmv);
  if (!Number.isFinite(numeric) || numeric <= 0 || maximum <= 0) return "8%";
  return `${Math.max(8, Math.round((numeric / maximum) * 100))}%`;
}

/** Renders status counts and the server-derived daily sales/GMV trend. */
export function DashboardOrdersTrend({
  orders,
  sellerMode = false,
}: {
  orders: DashboardOrders;
  sellerMode?: boolean;
}) {
  const currencies = [...new Set(orders.trend.map((point) => point.currency))];

  return (
    <section className="dashboard-panel space-y-4" aria-labelledby="dashboard-orders-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Sales activity</p>
          <h2 id="dashboard-orders-title" className="mt-1 text-xl font-semibold">
            {sellerMode ? "Sales trend" : "Orders & GMV trend"}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">Daily finalized order volume and gross merchandise value.</p>
        </div>
        <Link to="/reports/sales" className="text-sm font-medium underline">Drill down</Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {orders.statusCounts.map((item) => (
          <div key={item.status} className="rounded-control border border-border bg-surface-muted p-3">
            <p className="text-xs text-foreground-muted">{ORDER_STATUS_LABEL[item.status] ?? item.status}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{item.count}</p>
          </div>
        ))}
      </div>

      {orders.trend.length === 0 ? (
        <p className="rounded-control bg-surface-muted p-5 text-sm text-foreground-muted">No finalized order trend matches these filters.</p>
      ) : (
        <div className="space-y-5">
          {currencies.map((currency) => {
            const points = orders.trend.filter((point) => point.currency === currency);
            const maximum = Math.max(...points.map((point) => Number(point.gmv) || 0), 0);
            return (
              <div key={currency} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{currency} sales</h3>
                  <span className="text-xs text-foreground-muted">{points.length} day(s)</span>
                </div>
                <div className="dashboard-trend-chart mt-4" role="list" aria-label={`${currency} sales trend`}>
                  {points.map((point) => (
                    <div key={`${point.bucketStart}-${point.currency}`} className="dashboard-trend-point" role="listitem">
                      <div className="dashboard-trend-bar-wrap" aria-hidden="true">
                        <div className="dashboard-trend-bar" style={{ height: trendHeight(point.gmv, maximum) }} />
                      </div>
                      <div className="mt-2 text-center">
                        <p className="text-xs font-semibold">{formatMoney(point.gmv, point.currency)}</p>
                        <p className="text-[11px] text-foreground-muted">{point.orderCount} order{point.orderCount === 1 ? "" : "s"}</p>
                        <p className="mt-1 text-[10px] text-foreground-muted">{formatDate(point.bucketStart)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

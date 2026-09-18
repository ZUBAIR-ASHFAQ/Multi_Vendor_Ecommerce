import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import type { PaginationMeta } from "@/types/api";
import { DASHBOARD_ALERT_LABEL } from "../dashboard.constants";
import type { DashboardAlerts } from "../types/dashboard.types";

/** Returns the approved drill-down route for one source-owned alert type. */
function alertRoute(
  type: DashboardAlerts["rows"][number]["type"],
): "/reports/inventory" | "/reports/refunds" | "/reports/payouts" | "/seller/orders" {
  if (type === "low_stock") return "/reports/inventory";
  if (type === "return_attention") return "/reports/refunds";
  if (type === "payout_attention") return "/reports/payouts";
  return "/seller/orders";
}

/** Renders low-stock, fulfillment, return and authorized payout alerts without duplicating source state. */
export function DashboardOperationalAlerts({
  alerts,
  meta,
  onPageChange,
}: {
  alerts: DashboardAlerts;
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="dashboard-alerts-title">
      <h2 id="dashboard-alerts-title" className="text-xl font-semibold">Operational alerts</h2>
      <div className="rounded-xl border bg-white shadow-sm">
        {alerts.rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No operational alerts match these filters.</p>
        ) : (
          <ul className="divide-y">
            {alerts.rows.map((alert) => (
              <li key={`${alert.type}-${alert.resourceId}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{DASHBOARD_ALERT_LABEL[alert.type]}</p>
                    <p className="mt-1 font-semibold">{alert.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(alert.occurredAt)}</p>
                  </div>
                  <Link to={alertRoute(alert.type)} className="text-sm font-medium underline">Open source</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.totalItems} alerts</span>
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

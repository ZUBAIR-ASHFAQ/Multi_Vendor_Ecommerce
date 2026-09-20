import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import type { PaginationMeta } from "@/types/api";
import { DASHBOARD_ALERT_LABEL } from "../dashboard.constants";
import type { DashboardAlerts } from "../types/dashboard.types";

type DashboardAlertType = DashboardAlerts["rows"][number]["type"];
type DashboardAlertRoute =
  | "/reports/inventory"
  | "/reports/refunds"
  | "/reports/payouts"
  | "/seller/orders"
  | "/seller/inventory"
  | "/seller/returns"
  | "/seller/payouts";

/** Returns the approved drill-down route for one source-owned alert type and actor mode. */
function alertRoute(type: DashboardAlertType, sellerMode: boolean): DashboardAlertRoute {
  if (sellerMode) {
    if (type === "low_stock") return "/seller/inventory";
    if (type === "return_attention") return "/seller/returns";
    if (type === "payout_attention") return "/seller/payouts";
    return "/seller/orders";
  }
  if (type === "low_stock") return "/reports/inventory";
  if (type === "return_attention") return "/reports/refunds";
  if (type === "payout_attention") return "/reports/payouts";
  return "/seller/orders";
}

/** Renders source-owned alerts as an action queue without duplicating source state. */
export function DashboardOperationalAlerts({
  alerts,
  meta,
  onPageChange,
  sellerMode = false,
}: {
  alerts: DashboardAlerts;
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  sellerMode?: boolean;
}) {
  return (
    <section className="dashboard-panel space-y-3" aria-labelledby="dashboard-alerts-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Operations</p>
        <h2 id="dashboard-alerts-title" className="mt-1 text-xl font-semibold">
          {sellerMode ? "Action required" : "Operational alerts"}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {sellerMode ? "Prioritized fulfillment, inventory, return, and payout exceptions." : "Source-owned marketplace exceptions requiring attention."}
        </p>
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {alerts.rows.length === 0 ? (
          <p className="p-5 text-sm text-foreground-muted">No operational alerts match these filters.</p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.rows.map((alert) => (
              <li key={`${alert.type}-${alert.resourceId}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{DASHBOARD_ALERT_LABEL[alert.type]}</p>
                    <p className="mt-1 font-semibold">{alert.title}</p>
                    <p className="mt-1 text-sm text-foreground-muted">{alert.message}</p>
                    <p className="mt-2 text-xs text-foreground-muted">{formatDateTime(alert.occurredAt)}</p>
                  </div>
                  <Link to={alertRoute(alert.type, sellerMode)} className="text-sm font-medium underline">Open source</Link>
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

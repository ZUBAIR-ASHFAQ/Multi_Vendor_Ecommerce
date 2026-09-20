import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { OrderStatus } from "@/features/orders/components/order-status";
import { useSellerOrdersQuery } from "@/features/orders/hooks/use-orders";
import { formatDateTime } from "@/lib/dates";

/** Shows the seller's newest fulfillment units by reusing the authoritative Orders read surface. */
export function DashboardRecentOrders({ enabled }: { enabled: boolean }) {
  const orders = useSellerOrdersQuery({
    page: 1,
    pageSize: 5,
    sort: "createdAt",
    order: "desc",
  }, enabled);

  if (!enabled) return null;

  return (
    <section className="dashboard-panel space-y-4" aria-labelledby="dashboard-recent-orders-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Fulfillment</p>
          <h2 id="dashboard-recent-orders-title" className="mt-1 text-xl font-semibold">Recent orders</h2>
          <p className="mt-1 text-sm text-foreground-muted">Your five newest seller fulfillment units.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/seller/orders">View all orders</Link>
        </Button>
      </div>

      {orders.isPending ? <LoadingState label="Loading recent Seller Orders..." /> : null}
      {orders.isError ? (
        <ErrorState
          title="Recent orders could not be loaded"
          message={orders.error instanceof Error ? orders.error.message : "Please try again."}
          onRetry={() => void orders.refetch()}
        />
      ) : null}

      {orders.data && orders.data.items.length === 0 ? (
        <p className="rounded-control bg-surface-muted p-4 text-sm text-foreground-muted">No Seller Orders yet.</p>
      ) : null}

      {orders.data && orders.data.items.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {orders.data.items.map((order) => (
            <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/seller/orders/$sellerOrderId"
                    params={{ sellerOrderId: order.id }}
                    className="font-semibold no-underline hover:underline"
                  >
                    {order.sellerOrderNo}
                  </Link>
                  <OrderStatus value={order.status} />
                </div>
                <p className="mt-1 text-xs text-foreground-muted">
                  Parent {order.orderNo} · {formatDateTime(order.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-foreground-muted">Fulfillment</p>
                <p className="mt-1 text-sm font-semibold capitalize">{order.fulfillmentStatus.replaceAll("_", " ")}</p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

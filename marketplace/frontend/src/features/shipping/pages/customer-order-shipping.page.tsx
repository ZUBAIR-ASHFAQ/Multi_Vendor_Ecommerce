import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
import { ApiClientError } from "@/lib/api-error";
import { ShipmentStatus } from "../components/shipment-status";
import { ShipmentTimeline } from "../components/shipment-timeline";
import { useOrderShipmentsQuery } from "../hooks/use-shipping";
import { SHIPPING_PERMISSION } from "../shipping.constants";

/** Renders customer/admin-safe Shipment tracking without internal created history or seller-private data. */
function CustomerOrderShippingContent({
  orderId,
  adminRead,
  canReadOrder,
}: {
  orderId: string;
  adminRead: boolean;
  canReadOrder: boolean;
}) {
  const shipments = useOrderShipmentsQuery(orderId);

  if (shipments.isPending) return <LoadingState label="Loading tracking..." />;

  if (shipments.isError) {
    return (
      <ErrorState
        title="Tracking could not be loaded"
        message={shipments.error instanceof Error ? shipments.error.message : "Please try again."}
        requestId={shipments.error instanceof ApiClientError ? shipments.error.requestId : undefined}
        onRetry={() => void shipments.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={adminRead ? (
          <Link className="hover:underline" to="/admin/orders">← Admin Orders</Link>
        ) : canReadOrder ? (
          <Link className="hover:underline" to="/orders/$orderId" params={{ orderId }}>← Order detail</Link>
        ) : undefined}
        title="Shipment tracking"
        description="Carrier updates appear here after a seller marks a Shipment as shipped."
      />

      {shipments.data.length === 0 ? (
        <EmptyState
          title="Tracking is not available yet"
          description="Your Order can still be processing. Shipment tracking appears here as soon as a seller dispatches an eligible package."
          action={canReadOrder ? (
            <Link className="rounded-control border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-muted" to="/orders/$orderId" params={{ orderId }}>
              Back to Order
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="space-y-5">
          {shipments.data.map((shipment, index) => (
            <article key={shipment.id} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
              <div className="flex flex-col gap-4 border-b border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Package {index + 1}</p>
                  <h2 className="mt-1 font-semibold text-foreground">{shipment.shipmentNo}</h2>
                  <p className="mt-1 text-sm text-foreground-muted">{shipment.carrier} · {shipment.trackingNo}</p>
                  {shipment.serviceLevel ? <p className="mt-1 text-xs text-foreground-muted">{shipment.serviceLevel}</p> : null}
                </div>
                <ShipmentStatus value={shipment.status} />
              </div>

              <div className="grid gap-6 px-5 py-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <Surface variant="muted" padding="sm">
                  <dl className="space-y-3 text-sm">
                    <div><dt className="text-foreground-muted">Items in package</dt><dd className="mt-1 font-semibold">{shipment.items.reduce((sum, item) => sum + item.quantity, 0)}</dd></div>
                    <div><dt className="text-foreground-muted">Shipped</dt><dd className="mt-1 font-medium">{new Date(shipment.shippedAt).toLocaleString()}</dd></div>
                    {shipment.deliveredAt ? <div><dt className="text-foreground-muted">Delivered</dt><dd className="mt-1 font-medium">{new Date(shipment.deliveredAt).toLocaleString()}</dd></div> : null}
                  </dl>
                </Surface>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Tracking timeline</h3>
                  <div className="mt-3"><ShipmentTimeline entries={shipment.timeline} /></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** Protects customer/support Shipment tracking with one of the approved Module 13 read permissions. */
export function CustomerOrderShippingPage() {
  const { orderId } = useParams({ strict: false });

  return (
    <CustomerAccountLayout>
      {(user) =>
        user.permissions.includes(SHIPPING_PERMISSION.READ_OWN_ORDER) ||
        user.permissions.includes(SHIPPING_PERMISSION.ADMIN_READ) ? (
          <CustomerOrderShippingContent
            orderId={String(orderId)}
            adminRead={user.permissions.includes(SHIPPING_PERMISSION.ADMIN_READ)}
            canReadOrder={user.permissions.includes("orders.read_own")}
          />
        ) : (
          <ErrorState title="Access denied" message="Your account does not have permission to read Shipment tracking." />
        )
      }
    </CustomerAccountLayout>
  );
}

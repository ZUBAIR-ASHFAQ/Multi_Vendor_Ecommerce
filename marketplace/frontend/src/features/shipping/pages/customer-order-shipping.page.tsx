import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
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
    <div className="space-y-5">
      <div>
        {adminRead ? (
          <Link className="text-sm underline" to="/admin/orders">
            ← Admin Orders
          </Link>
        ) : canReadOrder ? (
          <Link className="text-sm underline" to="/orders/$orderId" params={{ orderId }}>
            ← Order detail
          </Link>
        ) : null}
        <h1 className="mt-2 text-2xl font-bold">Shipment tracking</h1>
        <p className="text-sm text-slate-500">Only shipped or delivered Shipments are visible here.</p>
      </div>

      {shipments.data.length === 0 ? (
        <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">
          Tracking is not available yet. A Shipment appears here after the seller marks it shipped.
        </p>
      ) : (
        shipments.data.map((shipment) => (
          <article key={shipment.id} className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{shipment.shipmentNo}</h2>
                <p className="text-sm text-slate-600">{shipment.carrier} · {shipment.trackingNo}</p>
                {shipment.serviceLevel ? <p className="text-xs text-slate-500">{shipment.serviceLevel}</p> : null}
              </div>
              <ShipmentStatus value={shipment.status} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Tracking timeline</h3>
              <div className="mt-2"><ShipmentTimeline entries={shipment.timeline} /></div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

/** Protects customer/support Shipment tracking with one of the approved Module 13 read permissions. */
export function CustomerOrderShippingPage() {
  const { orderId } = useParams({ strict: false });

  return (
    <AuthenticatedPanel>
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
    </AuthenticatedPanel>
  );
}

import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { useSellerOrderDetailQuery } from "@/features/orders/hooks/use-orders";
import { ORDERS_PERMISSION } from "@/features/orders/orders.constants";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { ShipmentStatus } from "../components/shipment-status";
import { ShipmentTimeline } from "../components/shipment-timeline";
import { CreateShipmentForm } from "../forms/create-shipment.form";
import { ShipmentTrackingForm } from "../forms/shipment-tracking.form";
import {
  useCreateShipmentMutation,
  useMarkShipmentDeliveredMutation,
  useMarkShipmentShippedMutation,
  useSellerShipmentsQuery,
  useUpdateShipmentTrackingMutation,
} from "../hooks/use-shipping";
import { SHIPPING_PERMISSION } from "../shipping.constants";
import type { SellerShipment } from "../types/shipping.types";

/** Calculates how much of one Order Item remains unallocated across immutable Shipments. */
function availableToAllocate(orderItemId: string, remainingQuantity: number, shipments: SellerShipment[]): number {
  const allocated = shipments.reduce(
    (total, shipment) =>
      total + shipment.items
        .filter((item) => item.orderItemId === orderItemId)
        .reduce((itemTotal, item) => itemTotal + item.quantity, 0),
    0,
  );
  return Math.max(remainingQuantity - allocated, 0);
}


/** Returns the currently active lifecycle mutation error, if any. */
function lifecycleError(markShippedError: unknown, markDeliveredError: unknown): unknown {
  return markShippedError ?? markDeliveredError;
}

/** Renders tracking and lifecycle controls for one seller-visible Shipment. */
function ShipmentCard({ shipment, canManage }: { shipment: SellerShipment; canManage: boolean }) {
  const tracking = useUpdateShipmentTrackingMutation(shipment.id);
  const markShipped = useMarkShipmentShippedMutation(shipment.id);
  const markDelivered = useMarkShipmentDeliveredMutation(shipment.id);
  const commandError = lifecycleError(markShipped.error, markDelivered.error);

  return (
    <article className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{shipment.shipmentNo}</h2>
          <p className="text-xs text-slate-500">
            {shipment.items.reduce((total, item) => total + item.quantity, 0)} allocated item(s)
          </p>
        </div>
        <ShipmentStatus value={shipment.status} />
      </div>

      <ShipmentTrackingForm
        key={shipment.updatedAt}
        carrier={shipment.carrier}
        trackingNo={shipment.trackingNo}
        serviceLevel={shipment.serviceLevel}
        disabled={!canManage || shipment.status === "delivered"}
        isPending={tracking.isPending}
        error={tracking.error}
        onSubmit={(input) => tracking.mutateAsync(input).then(() => undefined)}
      />

      <div className="flex flex-wrap gap-2">
        {canManage && shipment.status === "created" ? (
          <Button
            type="button"
            disabled={markShipped.isPending || !shipment.carrier || !shipment.trackingNo}
            onClick={() => void markShipped.mutateAsync(crypto.randomUUID())}
          >
            {markShipped.isPending ? "Marking shipped..." : "Mark shipped"}
          </Button>
        ) : null}
        {canManage && shipment.status === "shipped" ? (
          <Button
            type="button"
            disabled={markDelivered.isPending}
            onClick={() => void markDelivered.mutateAsync(crypto.randomUUID())}
          >
            {markDelivered.isPending ? "Marking delivered..." : "Mark delivered"}
          </Button>
        ) : null}
      </div>

      {commandError ? (
        <ErrorState
          title="Shipment status could not be changed"
          message={commandError instanceof Error ? commandError.message : "Please try again."}
          requestId={commandError instanceof ApiClientError ? commandError.requestId : undefined}
        />
      ) : null}

      <div>
        <h3 className="text-sm font-semibold">Shipment timeline</h3>
        <div className="mt-2"><ShipmentTimeline entries={shipment.timeline} /></div>
      </div>
    </article>
  );
}

/** Renders one Seller Order's Shipment allocation, tracking, and lifecycle workspace. */
function SellerOrderShippingContent({ sellerOrderId, canManage }: { sellerOrderId: string; canManage: boolean }) {
  const order = useSellerOrderDetailQuery(sellerOrderId);
  const shipments = useSellerShipmentsQuery({
    page: 1,
    pageSize: 100,
    sellerOrderId,
    sort: "createdAt",
    order: "asc",
  });
  const createShipment = useCreateShipmentMutation(sellerOrderId);

  if (order.isPending || shipments.isPending) return <LoadingState label="Loading fulfillment..." />;

  if (order.isError || shipments.isError) {
    const error = order.error ?? shipments.error;
    return (
      <ErrorState
        title="Fulfillment could not be loaded"
        message={error instanceof Error ? error.message : "Please try again."}
        requestId={error instanceof ApiClientError ? error.requestId : undefined}
        onRetry={() => {
          void order.refetch();
          void shipments.refetch();
        }}
      />
    );
  }

  const itemOptions = order.data.items
    .map((item) => ({
      id: item.id,
      label: `${item.name} (${item.sku})`,
      availableQuantity: availableToAllocate(item.id, item.remainingQuantity, shipments.data.items),
    }))
    .filter((item) => item.availableQuantity > 0);

  const canCreate = canManage && order.data.paymentStatus === "captured" && order.data.status === "processing";

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link className="text-sm underline underline-offset-4" to="/seller/orders/$sellerOrderId" params={{ sellerOrderId }}>
              ← Seller Order
            </Link>
            <h1 className="mt-2 text-2xl font-bold">Fulfillment for {order.data.sellerOrderNo}</h1>
            <p className="mt-1 text-sm text-slate-500">Parent {order.data.orderNo}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-500">Order total</span><strong className="text-right">{formatMoney(order.data.grandTotal, order.data.currency)}</strong>
            <span className="text-slate-500">Unallocated lines</span><strong className="text-right">{itemOptions.length}</strong>
            <span className="text-slate-500">Shipments</span><strong className="text-right">{shipments.data.items.length}</strong>
          </div>
        </div>
      </section>

      {canCreate && itemOptions.length > 0 ? (
        <CreateShipmentForm
          key={`${sellerOrderId}-${shipments.data.items.length}`}
          items={itemOptions}
          isPending={createShipment.isPending}
          error={createShipment.error}
          onSubmit={(input, idempotencyKey) =>
            createShipment.mutateAsync({ input, idempotencyKey }).then(() => undefined)
          }
        />
      ) : (
        <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
          {itemOptions.length === 0 && canCreate
            ? "Every remaining item is already allocated to a Shipment."
            : "New Shipment creation becomes available only after provider-confirmed payment and Seller Order acceptance. The API remains authoritative."}
        </p>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Shipments</h2>
          <p className="text-sm text-slate-500">Tracking and lifecycle changes apply to this Seller Order only.</p>
        </div>
        {shipments.data.items.length === 0 ? (
          <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">No Shipments have been created for this Seller Order.</p>
        ) : (
          shipments.data.items.map((shipment) => (
            <ShipmentCard key={shipment.id} shipment={shipment} canManage={canManage} />
          ))
        )}
      </section>
    </div>
  );
}

/** Protects the Seller Order fulfillment workspace with Shipping read/manage permissions. */
export function SellerOrderShippingPage() {
  const { sellerOrderId } = useParams({ strict: false });

  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={SHIPPING_PERMISSION.SELLER_READ}>
          <RequireSellerPermission user={user} permission={ORDERS_PERMISSION.SELLER_READ}>
            <SellerOrderShippingContent
              sellerOrderId={String(sellerOrderId)}
              canManage={user.permissions.includes(SHIPPING_PERMISSION.SELLER_MANAGE)}
            />
          </RequireSellerPermission>
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

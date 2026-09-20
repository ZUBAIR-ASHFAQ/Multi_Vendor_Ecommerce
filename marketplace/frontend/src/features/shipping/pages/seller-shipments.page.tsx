import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { ShipmentPagination } from "../components/shipment-pagination";
import { ShipmentStatus } from "../components/shipment-status";
import { useSellerShipmentsQuery } from "../hooks/use-shipping";
import { SHIPPING_PERMISSION } from "../shipping.constants";
import type { SellerShipmentListParams } from "../types/shipping.types";

const SHIPMENT_FILTERS: Array<{ label: string; value?: SellerShipmentListParams["status"] }> = [
  { label: "All" },
  { label: "Created", value: "created" },
  { label: "In transit", value: "shipped" },
  { label: "Delivered", value: "delivered" },
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Renders the seller fulfillment queue with only allow-listed Shipment filters. */
function SellerShipmentsContent() {
  const [params, setParams] = useState<SellerShipmentListParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const shipments = useSellerShipmentsQuery(params);

  if (shipments.isPending) return <LoadingState label="Loading Shipments..." />;

  if (shipments.isError) {
    return (
      <ErrorState
        title="Shipments could not be loaded"
        message={shipments.error instanceof Error ? shipments.error.message : "Please try again."}
        requestId={shipments.error instanceof ApiClientError ? shipments.error.requestId : undefined}
        onRetry={() => void shipments.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Shipping operations</p>
            <h1 className="mt-1 text-2xl font-bold">Fulfillment Shipments</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Work created shipments through tracking, dispatch and delivery without leaving the seller fulfillment scope.
            </p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Shipment status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: (event.target.value || undefined) as SellerShipmentListParams["status"],
              }))}
            >
              <option value="">All</option>
              <option value="created">Created</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Shipment queue filters">
          {SHIPMENT_FILTERS.map((filter) => (
            <Button
              key={filter.label}
              type="button"
              size="sm"
              variant={(params.status ?? undefined) === filter.value ? "default" : "outline"}
              onClick={() => setParams((current) => ({ ...current, page: 1, status: filter.value }))}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Shipment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Last milestone</th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shipments.data.items.map((shipment) => (
                <tr key={shipment.id} className="border-b last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <strong>{shipment.shipmentNo}</strong>
                    <span className="mt-1 block text-xs text-slate-500">Seller Order {shipment.sellerOrderId}</span>
                  </td>
                  <td className="px-4 py-4"><ShipmentStatus value={shipment.status} /></td>
                  <td className="px-4 py-4">
                    <span className="font-medium">{shipment.carrier ?? "Carrier not set"}</span>
                    <span className="mt-1 block text-xs text-slate-500">{shipment.trackingNo ?? "Tracking not set"}</span>
                  </td>
                  <td className="px-4 py-4">{shipment.items.reduce((total, item) => total + item.quantity, 0)}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {shipment.deliveredAt ? formatDate(shipment.deliveredAt) : shipment.shippedAt ? formatDate(shipment.shippedAt) : formatDate(shipment.createdAt)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      className="font-medium underline underline-offset-4"
                      to="/seller/orders/$sellerOrderId/shipping"
                      params={{ sellerOrderId: shipment.sellerOrderId }}
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shipments.data.items.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No Shipments found for this queue.</p>
          ) : null}
        </div>
        <div className="border-t p-4">
          <ShipmentPagination meta={shipments.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
        </div>
      </section>
    </div>
  );
}

/** Protects the seller Shipment queue with the Module 13 read permission. */
export function SellerShipmentsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={SHIPPING_PERMISSION.SELLER_READ}>
          <SellerShipmentsContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

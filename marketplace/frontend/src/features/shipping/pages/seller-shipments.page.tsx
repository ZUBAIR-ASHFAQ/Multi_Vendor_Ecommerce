import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { RequireSellerPermission, SellerLayout } from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { ShipmentPagination } from "../components/shipment-pagination";
import { ShipmentStatus } from "../components/shipment-status";
import { useSellerShipmentsQuery } from "../hooks/use-shipping";
import { SHIPPING_PERMISSION } from "../shipping.constants";
import type { SellerShipmentListParams } from "../types/shipping.types";

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
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fulfillment Shipments</h1>
          <p className="mt-1 text-sm text-slate-500">Create and progress Shipments from eligible Seller Orders.</p>
        </div>
        <label className="text-sm font-medium">
          Status
          <select
            aria-label="Shipment status filter"
            className="ml-2 rounded-md border px-3 py-2"
            value={params.status ?? ""}
            onChange={(event) =>
              setParams((current) => ({
                ...current,
                page: 1,
                status: (event.target.value || undefined) as SellerShipmentListParams["status"],
              }))
            }
          >
            <option value="">All</option>
            <option value="created">Created</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
          </select>
        </label>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="py-2">Shipment</th>
              <th>Seller Order</th>
              <th>Status</th>
              <th>Tracking</th>
              <th>Items</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shipments.data.items.map((shipment) => (
              <tr key={shipment.id} className="border-b">
                <td className="py-3 font-medium">{shipment.shipmentNo}</td>
                <td>{shipment.sellerOrderId}</td>
                <td><ShipmentStatus value={shipment.status} /></td>
                <td>{shipment.trackingNo ?? "Not set"}</td>
                <td>{shipment.items.reduce((total, item) => total + item.quantity, 0)}</td>
                <td className="text-right">
                  <Link
                    className="underline"
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
          <p className="py-8 text-center text-slate-500">No Shipments found.</p>
        ) : null}
      </div>

      <div className="mt-4">
        <ShipmentPagination
          meta={shipments.data.meta}
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      </div>
    </section>
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

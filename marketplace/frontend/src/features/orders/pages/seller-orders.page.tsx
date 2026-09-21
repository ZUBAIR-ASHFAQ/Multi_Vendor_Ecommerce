import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { OrderPagination } from "../components/order-pagination";
import { OrderStatus } from "../components/order-status";
import { useSellerOrdersQuery } from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";
import type { SellerOrdersParams } from "../types/orders.types";

const SELLER_ORDER_QUEUE_FILTERS: Array<{ label: string; value?: SellerOrdersParams["queue"] }> = [
  { label: "All" },
  { label: "Needs action", value: "needs_action" },
  { label: "Unfulfilled", value: "unfulfilled" },
  { label: "Ready to ship", value: "ready_to_ship" },
  { label: "Shipped", value: "shipped" },
  { label: "Delivered", value: "delivered" },
  { label: "Cancelled", value: "cancelled" },
];


/** Returns whether one server-derived stage should open the Shipment fulfillment workspace directly. */
function hasShippingWork(stage: string): boolean {
  return stage === "unfulfilled" || stage === "ready_to_ship" || stage === "shipped";
}

/** Formats one server timestamp for compact operational display. */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** Loads and renders only Seller Orders in the authenticated seller/store scope. */
function SellerOrdersContent() {
  const [params, setParams] = useState<SellerOrdersParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const orders = useSellerOrdersQuery(params);

  if (orders.isPending) return <LoadingState label="Loading Seller Orders..." />;

  if (orders.isError) {
    return (
      <ErrorState
        title="Seller Orders could not be loaded"
        message={orders.error instanceof Error ? orders.error.message : "Please try again."}
        requestId={orders.error instanceof ApiClientError ? orders.error.requestId : undefined}
        onRetry={() => void orders.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Fulfillment</p>
            <h1 className="mt-1 text-2xl font-bold">Seller Order queue</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Prioritize acceptance, allocation, dispatch and delivery work from one server-derived queue.
            </p>
          </div>
          <label className="text-sm font-medium">
            Lifecycle
            <select
              aria-label="Seller Order status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setParams((current) => ({
                  ...current,
                  page: 1,
                  status: value ? (value as SellerOrdersParams["status"]) : undefined,
                }));
              }}
            >
              <option value="">All</option>
              <option value="pending_payment">Pending payment</option>
              <option value="pending_acceptance">Pending acceptance</option>
              <option value="processing">Processing</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Seller Order operational queue filters">
          {SELLER_ORDER_QUEUE_FILTERS.map((filter) => {
            const active = (params.queue ?? undefined) === filter.value;
            return (
              <Button
                key={filter.label}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setParams((current) => ({ ...current, page: 1, queue: filter.value }))}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Seller Order</th>
                <th className="px-4 py-3">Placed</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Fulfillment</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((order) => (
                <tr key={order.id} className="border-b align-middle last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <strong>{order.sellerOrderNo}</strong>
                    <span className="mt-1 block text-xs text-slate-500">Parent {order.orderNo}</span>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{formatDateTime(order.createdAt)}</td>
                  <td className="px-4 py-4"><OrderStatus value={order.status} /></td>
                  <td className="px-4 py-4"><OrderStatus value={order.paymentStatus} /></td>
                  <td className="px-4 py-4"><OrderStatus value={order.fulfillmentStage} /></td>
                  <td className="px-4 py-4 text-right font-semibold">{formatMoney(order.grandTotal, order.currency)}</td>
                  <td className="px-4 py-4 text-right">
                    {hasShippingWork(order.fulfillmentStage) ? (
                      <Link
                        className="font-medium text-slate-900 underline underline-offset-4"
                        to="/seller/orders/$sellerOrderId/shipping"
                        params={{ sellerOrderId: order.id }}
                      >
                        Fulfill
                      </Link>
                    ) : (
                      <Link
                        className="font-medium text-slate-900 underline underline-offset-4"
                        to="/seller/orders/$sellerOrderId"
                        params={{ sellerOrderId: order.id }}
                      >
                        Open
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.data.items.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No Seller Orders found for this queue.</p>
          ) : null}
        </div>
        <div className="border-t p-4">
          <OrderPagination
            meta={orders.data.meta}
            noun="Seller Orders"
            onPageChange={(page) => setParams((current) => ({ ...current, page }))}
          />
        </div>
      </section>
    </div>
  );
}

/** Protects the seller Order queue with seller account and seller.orders.read checks. */
export function SellerOrdersPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={ORDERS_PERMISSION.SELLER_READ}>
          <SellerOrdersContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

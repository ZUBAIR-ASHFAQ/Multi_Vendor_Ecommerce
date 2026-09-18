import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { OrderPagination } from "../components/order-pagination";
import { OrderStatus } from "../components/order-status";
import { useSellerOrdersQuery } from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";
import type { SellerOrdersParams } from "../types/orders.types";

/** Loads and renders only Seller Orders in the authenticated seller/store scope. */
function SellerOrdersContent() {
  const [params, setParams] = useState<SellerOrdersParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const orders = useSellerOrdersQuery(params);

  if (orders.isPending) {
    return <LoadingState label="Loading Seller Orders..." />;
  }

  if (orders.isError) {
    return (
      <ErrorState
        title="Seller Orders could not be loaded"
        message={
          orders.error instanceof Error
            ? orders.error.message
            : "Please try again."
        }
        requestId={
          orders.error instanceof ApiClientError
            ? orders.error.requestId
            : undefined
        }
        onRetry={() => void orders.refetch()}
      />
    );
  }

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Seller Order queue</h1>
          <p className="mt-1 text-sm text-slate-600">
            Each row is one seller-scoped fulfillment unit, not the customer&apos;s
            parent Order.
          </p>
        </div>
        <label className="text-sm font-medium">
          Status
          <select
            aria-label="Seller Order status filter"
            className="ml-2 rounded-md border px-3 py-2"
            value={params.status ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setParams((current) => ({
                ...current,
                page: 1,
                status: value
                  ? (value as SellerOrdersParams["status"])
                  : undefined,
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

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="py-2">Seller Order</th>
              <th>Parent Order</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {orders.data.items.map((order) => (
              <tr key={order.id} className="border-b">
                <td className="py-3 font-medium">{order.sellerOrderNo}</td>
                <td>{order.orderNo}</td>
                <td><OrderStatus value={order.status} /></td>
                <td><OrderStatus value={order.paymentStatus} /></td>
                <td>{order.grandTotal}</td>
                <td className="text-right">
                  <Link
                    className="underline"
                    to="/seller/orders/$sellerOrderId"
                    params={{ sellerOrderId: order.id }}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.data.items.length === 0 ? (
          <p className="py-8 text-center text-slate-500">
            No Seller Orders found.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <OrderPagination
          meta={orders.data.meta}
          noun="Seller Orders"
          onPageChange={(page) =>
            setParams((current) => ({ ...current, page }))
          }
        />
      </div>
    </section>
  );
}

/** Protects the seller Order queue with seller account and seller.orders.read checks. */
export function SellerOrdersPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission
          user={user}
          permission={ORDERS_PERMISSION.SELLER_READ}
        >
          <SellerOrdersContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

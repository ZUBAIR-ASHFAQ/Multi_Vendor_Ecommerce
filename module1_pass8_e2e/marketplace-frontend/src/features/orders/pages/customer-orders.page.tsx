import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { ApiClientError } from "@/lib/api-error";
import { OrderPagination } from "../components/order-pagination";
import { OrderStatus } from "../components/order-status";
import { useCustomerOrdersQuery } from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";
import type { CustomerOrdersParams } from "../types/orders.types";

/** Formats display-only Order money without using floating point for business calculations. */
function displayMoney(currency: string, value: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Number(value));
}

/** Renders the authenticated customer's parent Order history. */
function CustomerOrdersContent() {
  const [params, setParams] = useState<CustomerOrdersParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const orders = useCustomerOrdersQuery(params);

  if (orders.isPending) {
    return <LoadingState label="Loading your Orders..." />;
  }

  if (orders.isError) {
    return (
      <ErrorState
        title="Orders could not be loaded"
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
          <h1 className="text-2xl font-bold">Your Orders</h1>
          <p className="mt-1 text-sm text-slate-600">
            Customer Orders are separate from each seller&apos;s fulfillment unit.
          </p>
          <Link className="mt-2 inline-block text-sm underline" to="/returns">View your Returns</Link>
        </div>
        <label className="text-sm font-medium">
          Status
          <select
            aria-label="Customer Order status filter"
            className="ml-2 rounded-md border px-3 py-2"
            value={params.orderStatus ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setParams((current) => ({
                ...current,
                page: 1,
                orderStatus: value
                  ? (value as CustomerOrdersParams["orderStatus"])
                  : undefined,
              }));
            }}
          >
            <option value="">All</option>
            <option value="pending_payment">Pending payment</option>
            <option value="confirmed">Confirmed</option>
            <option value="processing">Processing</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="py-2">Order</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {orders.data.items.map((order) => (
              <tr key={order.id} className="border-b">
                <td className="py-3 font-medium">{order.orderNo}</td>
                <td><OrderStatus value={order.orderStatus} /></td>
                <td><OrderStatus value={order.paymentStatus} /></td>
                <td>{displayMoney(order.currency, order.grandTotal)}</td>
                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                <td className="text-right">
                  <Link
                    className="underline"
                    to="/orders/$orderId"
                    params={{ orderId: order.id }}
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.data.items.length === 0 ? (
          <p className="py-8 text-center text-slate-500">No Orders found.</p>
        ) : null}
      </div>

      <div className="mt-4">
        <OrderPagination
          meta={orders.data.meta}
          noun="Orders"
          onPageChange={(page) =>
            setParams((current) => ({ ...current, page }))
          }
        />
      </div>
    </section>
  );
}

/** Protects the customer Order history with the server-derived own-order permission. */
export function CustomerOrdersPage() {
  return (
    <AuthenticatedPanel>
      {(user) =>
        user.permissions.includes(ORDERS_PERMISSION.READ_OWN) ? (
          <CustomerOrdersContent />
        ) : (
          <ErrorState
            title="Access denied"
            message="Your account does not have permission to read customer Orders."
          />
        )
      }
    </AuthenticatedPanel>
  );
}

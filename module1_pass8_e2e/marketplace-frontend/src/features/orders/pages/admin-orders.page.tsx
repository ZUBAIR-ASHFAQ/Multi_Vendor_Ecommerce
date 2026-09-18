import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { OrderPagination } from "../components/order-pagination";
import { OrderStatus } from "../components/order-status";
import { AdminOrderFilterForm } from "../forms/admin-order-filter.form";
import { OrderCancellationForm } from "../forms/order-cancellation.form";
import {
  useAdminOrdersQuery,
  useCancelAdminOrderMutation,
} from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";
import type { AdminOrdersParams } from "../types/orders.types";

/** Renders the permission-scoped support Order search and privileged cancellation flow. */
function AdminOrdersContent({ canCancel }: { canCancel: boolean }) {
  const [params, setParams] = useState<AdminOrdersParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const orders = useAdminOrdersQuery(params);
  const cancel = useCancelAdminOrderMutation();

  return (
    <div className="space-y-5">
      <AdminOrderFilterForm
        onApply={(filters) =>
          setParams((current) => ({
            ...current,
            ...filters,
            page: 1,
          }))
        }
      />

      {orders.isPending ? <LoadingState label="Loading Orders..." /> : null}
      {orders.isError ? (
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
      ) : null}

      {orders.data ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold">Order support</h1>
          <p className="mt-1 text-sm text-slate-600">
            Search parent Customer Orders. Seller fulfillment remains seller-scoped.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2">Order</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((order) => (
                  <tr key={order.id} className="border-b">
                    <td className="py-3 font-medium">{order.orderNo}</td>
                    <td><OrderStatus value={order.orderStatus} /></td>
                    <td><OrderStatus value={order.paymentStatus} /></td>
                    <td>{order.grandTotal} {order.currency}</td>
                    <td className="text-right">
                      {canCancel &&
                      order.paymentStatus === "pending" &&
                      order.orderStatus !== "cancelled" ? (
                        <button
                          className="underline"
                          onClick={() => setSelectedOrderId(order.id)}
                        >
                          Cancel
                        </button>
                      ) : null}
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
      ) : null}

      {selectedOrderId ? (
        <OrderCancellationForm
          isPending={cancel.isPending}
          error={cancel.error}
          onSubmit={(input, key) =>
            cancel
              .mutateAsync({
                orderId: selectedOrderId,
                input,
                idempotencyKey: key,
              })
              .then(() => {
                setSelectedOrderId(null);
              })
          }
        />
      ) : null}
    </div>
  );
}

/** Protects the admin Order search and keeps cancellation visibility permission-aware. */
export function AdminOrdersPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission
          user={user}
          permission={ORDERS_PERMISSION.ADMIN_READ}
        >
          <AdminOrdersContent
            canCancel={user.permissions.includes(ORDERS_PERMISSION.ADMIN_CANCEL)}
          />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

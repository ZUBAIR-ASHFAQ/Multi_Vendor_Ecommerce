import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  AdminQueueEmpty,
  AdminQueueHeader,
  AdminQueueTable,
  AdminQueueTableHead,
} from "@/features/administration/components/admin-queue";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
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
      <AdminQueueHeader
        eyebrow="Commerce · Order support"
        title="Order support queue"
        description="Search parent customer orders and act only on the cancellation command exposed by the current admin Orders API. Seller fulfillment remains seller-scoped."
        meta={orders.data?.meta}
        visibleCount={orders.data?.items.length}
      />

      <AdminOrderFilterForm
        onApply={(filters) => {
          setSelectedOrderId(null);
          setParams((current) => ({
            ...current,
            ...filters,
            page: 1,
          }));
        }}
      />

      {orders.isPending ? <LoadingState variant="table" label="Loading orders..." /> : null}
      {orders.isError ? (
        <ErrorState
          title="Orders could not be loaded"
          message={orders.error instanceof Error ? orders.error.message : "Please try again."}
          requestId={orders.error instanceof ApiClientError ? orders.error.requestId : undefined}
          onRetry={() => void orders.refetch()}
        />
      ) : null}

      {orders.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No orders match these filters"
          description="Change the order number, customer, order status, or payment status and try again."
        />
      ) : null}

      {orders.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[900px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Order status</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Fulfillment</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {orders.data.items.map((order) => {
              const cancellable = canCancel && order.paymentStatus === "pending" && order.orderStatus !== "cancelled";
              return (
                <tr key={order.id} className="transition-colors hover:bg-surface-muted/60">
                  <td className="px-4 py-3 font-medium text-foreground">{order.orderNo}</td>
                  <td className="px-4 py-3"><OrderStatus value={order.orderStatus} /></td>
                  <td className="px-4 py-3"><OrderStatus value={order.paymentStatus} /></td>
                  <td className="px-4 py-3"><OrderStatus value={order.fulfillmentStatus} /></td>
                  <td className="px-4 py-3 whitespace-nowrap font-medium">{formatMoney(order.grandTotal, order.currency)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(order.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {cancellable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedOrderId === order.id ? "secondary" : "outline"}
                        onClick={() => setSelectedOrderId((current) => current === order.id ? null : order.id)}
                      >
                        {selectedOrderId === order.id ? "Close cancellation" : "Cancel order"}
                      </Button>
                    ) : (
                      <span className="text-xs text-foreground-muted">No admin action</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {selectedOrderId ? (
        <section aria-label="Cancel selected order">
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
        </section>
      ) : null}

      {orders.data ? (
        <OrderPagination
          meta={orders.data.meta}
          noun="Orders"
          onPageChange={(page) => {
            setSelectedOrderId(null);
            setParams((current) => ({ ...current, page }));
          }}
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
        <RequirePagePermission user={user} permission={ORDERS_PERMISSION.ADMIN_READ}>
          <AdminOrdersContent canCancel={user.permissions.includes(ORDERS_PERMISSION.ADMIN_CANCEL)} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

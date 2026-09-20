import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
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

/** Chooses the customer-facing timestamp without inventing a placed date. */
function orderDate(placedAt: string | null, createdAt: string): string {
  return new Date(placedAt ?? createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Renders the authenticated customer's parent Order history as scannable customer cards. */
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
        message={orders.error instanceof Error ? orders.error.message : "Please try again."}
        requestId={orders.error instanceof ApiClientError ? orders.error.requestId : undefined}
        onRetry={() => void orders.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title="Your Orders"
        description="See payment and fulfillment progress, open an Order for item-level details, and track eligible shipments or Returns."
        actions={(
          <Link className="rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-muted" to="/returns">
            View Returns
          </Link>
        )}
      />

      <Surface className="flex flex-wrap items-center justify-between gap-3" padding="sm">
        <p className="text-sm text-foreground-muted">
          {orders.data.meta.totalItems} {orders.data.meta.totalItems === 1 ? "Order" : "Orders"}
        </p>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          Status
          <select
            aria-label="Customer Order status filter"
            className="rounded-control border border-border bg-surface px-3 py-2 text-sm"
            value={params.orderStatus ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setParams((current) => ({
                ...current,
                page: 1,
                orderStatus: value ? (value as CustomerOrdersParams["orderStatus"]) : undefined,
              }));
            }}
          >
            <option value="">All statuses</option>
            <option value="pending_payment">Pending payment</option>
            <option value="confirmed">Confirmed</option>
            <option value="processing">Processing</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </Surface>

      {orders.data.items.length === 0 ? (
        <EmptyState
          title="No Orders found"
          description={params.orderStatus ? "No Orders match this status. Choose All statuses to see your complete history." : "Orders you place will appear here with payment and fulfillment progress."}
          action={params.orderStatus ? (
            <button
              className="rounded-control border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-muted"
              type="button"
              onClick={() => setParams((current) => ({ ...current, page: 1, orderStatus: undefined }))}
            >
              Clear status filter
            </button>
          ) : undefined}
        />
      ) : (
        <div className="space-y-4">
          {orders.data.items.map((order) => (
            <article key={order.id} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
              <div className="flex flex-col gap-4 border-b border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground-muted">Order</p>
                  <Link className="mt-1 inline-block font-semibold text-foreground hover:underline" to="/orders/$orderId" params={{ orderId: order.id }}>
                    {order.orderNo}
                  </Link>
                  <p className="mt-1 text-xs text-foreground-muted">Placed {orderDate(order.placedAt, order.createdAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OrderStatus value={order.orderStatus} />
                  <OrderStatus value={order.paymentStatus} />
                </div>
              </div>

              <div className="grid gap-5 px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Total</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{displayMoney(order.currency, order.grandTotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Fulfillment</p>
                    <div className="mt-1"><OrderStatus value={order.fulfillmentStatus} /></div>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Payment</p>
                    <p className="mt-1 text-sm text-foreground-muted">{order.paymentStatus === "captured" ? "Payment received" : "Payment still required"}</p>
                  </div>
                </div>
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-control bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
                  to="/orders/$orderId"
                  params={{ orderId: order.id }}
                >
                  View Order
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      <OrderPagination
        meta={orders.data.meta}
        noun="Orders"
        onPageChange={(page) => setParams((current) => ({ ...current, page }))}
      />
    </div>
  );
}

/** Protects the customer Order history with the server-derived own-order permission. */
export function CustomerOrdersPage() {
  return (
    <CustomerAccountLayout>
      {(user) =>
        user.permissions.includes(ORDERS_PERMISSION.READ_OWN) ? (
          <CustomerOrdersContent />
        ) : (
          <ErrorState title="Access denied" message="Your account does not have permission to read customer Orders." />
        )
      }
    </CustomerAccountLayout>
  );
}

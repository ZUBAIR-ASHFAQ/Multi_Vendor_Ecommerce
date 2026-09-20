import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { ApiClientError } from "@/lib/api-error";
import { useOrderShipmentsQuery } from "@/features/shipping/hooks/use-shipping";
import { RETURNS_PERMISSION } from "@/features/returns-refunds/returns-refunds.constants";
import { REVIEWS_PERMISSION } from "@/features/reviews/reviews.constants";
import { OrderStatus } from "../components/order-status";
import { OrderTimeline } from "../components/order-timeline";
import { OrderCancellationForm } from "../forms/order-cancellation.form";
import {
  useCancelCustomerOrderMutation,
  useCustomerOrderDetailQuery,
} from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";

/** Formats display-only Order money without participating in business calculations. */
function displayMoney(currency: string, value: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Number(value));
}

/** Renders one customer-owned immutable parent Order and its seller fulfillment groups. */
function CustomerOrderDetailContent({
  orderId,
  canReadShipping,
  canCreateReturn,
  canCreateReview,
}: {
  orderId: string;
  canReadShipping: boolean;
  canCreateReturn: boolean;
  canCreateReview: boolean;
}) {
  const order = useCustomerOrderDetailQuery(orderId);
  const shipments = useOrderShipmentsQuery(
    orderId,
    canReadShipping && (canCreateReturn || canCreateReview),
  );
  const cancel = useCancelCustomerOrderMutation(orderId);

  if (order.isPending) return <LoadingState label="Loading Order..." />;

  if (order.isError) {
    return (
      <ErrorState
        title="Order could not be loaded"
        message={
          order.error instanceof Error
            ? order.error.message
            : "Please try again."
        }
        requestId={
          order.error instanceof ApiClientError
            ? order.error.requestId
            : undefined
        }
        onRetry={() => void order.refetch()}
      />
    );
  }

  const itemOptions = order.data.sellerOrders.flatMap((sellerOrder) =>
    sellerOrder.items.map((item) => ({
      id: item.id,
      label: `${item.name} (${sellerOrder.sellerOrderNo})`,
      remainingQuantity: item.remainingQuantity,
    })),
  );

  const deliveredItemIds = new Set(
    shipments.data
      ?.filter((shipment) => shipment.status === "delivered")
      .flatMap((shipment) => shipment.items.map((item) => item.orderItemId)) ?? [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link className="text-sm underline" to="/orders">
            ← Your Orders
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{order.data.orderNo}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canReadShipping ? (
            <Link
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50"
              to="/orders/$orderId/shipping"
              params={{ orderId }}
            >
              Track Shipments
            </Link>
          ) : null}
          <OrderStatus value={order.data.orderStatus} />
        </div>
      </div>

      <section className="grid gap-3 rounded-xl border bg-white p-5 shadow-sm md:grid-cols-4">
        <div>
          <span className="text-xs text-slate-500">Payment</span>
          <div><OrderStatus value={order.data.paymentStatus} /></div>
        </div>
        <div>
          <span className="text-xs text-slate-500">Fulfillment</span>
          <div><OrderStatus value={order.data.fulfillmentStatus} /></div>
        </div>
        <div>
          <span className="text-xs text-slate-500">Seller Orders</span>
          <p className="font-semibold">{order.data.sellerOrders.length}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Grand total</span>
          <p className="font-semibold">
            {displayMoney(order.data.currency, order.data.grandTotal)}
          </p>
        </div>
      </section>

      {order.data.sellerOrders.map((sellerOrder) => (
        <section
          key={sellerOrder.id}
          className="rounded-xl border bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="font-semibold">{sellerOrder.sellerOrderNo}</h2>
              <p className="text-xs text-slate-500">
                Store {sellerOrder.storeId}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canCreateReturn && sellerOrder.items.some((item) => deliveredItemIds.has(item.id)) ? (
                <Link
                  className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  to="/orders/$orderId/returns/$sellerOrderId/new"
                  params={{ orderId, sellerOrderId: sellerOrder.id }}
                >
                  Request Return
                </Link>
              ) : null}
              <OrderStatus value={sellerOrder.status} />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Shipping: {sellerOrder.shippingMethod.name} · {sellerOrder.shippingMethod.amount}{" "}
            {sellerOrder.shippingMethod.currency}
          </p>
          <ul className="mt-4 divide-y">
            {sellerOrder.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap justify-between gap-3 py-3"
              >
                <div>
                  <strong>{item.name}</strong>
                  <p className="text-xs text-slate-500">
                    {item.sku}
                    {item.variantTitle ? ` · ${item.variantTitle}` : ""}
                  </p>
                  {canCreateReview && deliveredItemIds.has(item.id) ? (
                    <Link
                      className="mt-2 inline-block text-sm font-medium underline"
                      to="/orders/$orderId/reviews/$orderItemId/new"
                      params={{ orderId, orderItemId: item.id }}
                    >
                      Write Review
                    </Link>
                  ) : null}
                </div>
                <div className="text-right text-sm">
                  <p>
                    {item.quantity} ordered · {item.remainingQuantity} remaining
                  </p>
                  <p>{item.lineTotal} {order.data.currency}</p>
                  <OrderStatus value={item.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Status timeline</h2>
        <div className="mt-4">
          <OrderTimeline entries={order.data.statusHistory} />
        </div>
      </section>

      {order.data.paymentStatus === "pending" &&
      order.data.orderStatus !== "cancelled" ? (
        <OrderCancellationForm
          items={itemOptions}
          isPending={cancel.isPending}
          error={cancel.error}
          onSubmit={(input, key) =>
            cancel
              .mutateAsync({ input, idempotencyKey: key })
              .then(() => undefined)
          }
        />
      ) : (
        <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
          Cancellation is unavailable from this page after payment capture or final
          cancellation. The API remains authoritative.
        </p>
      )}
    </div>
  );
}

/** Protects customer Order detail before issuing the customer-owned Order request. */
export function CustomerOrderDetailPage() {
  const { orderId } = useParams({ strict: false });

  return (
    <AuthenticatedPanel>
      {(user) =>
        user.permissions.includes(ORDERS_PERMISSION.READ_OWN) ? (
          <CustomerOrderDetailContent
            orderId={String(orderId)}
            canReadShipping={user.permissions.includes("shipping.read_own_order")}
            canCreateReturn={user.permissions.includes(RETURNS_PERMISSION.CREATE_OWN)}
            canCreateReview={user.permissions.includes(REVIEWS_PERMISSION.CREATE_VERIFIED)}
          />
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

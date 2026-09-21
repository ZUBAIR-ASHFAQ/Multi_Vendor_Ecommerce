import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
import { RETURNS_PERMISSION } from "@/features/returns-refunds/returns-refunds.constants";
import { REVIEWS_PERMISSION } from "@/features/reviews/reviews.constants";
import { useOrderShipmentsQuery } from "@/features/shipping/hooks/use-shipping";
import { ApiClientError } from "@/lib/api-error";
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

/** Formats one immutable address snapshot for customer display. */
function addressLines(address: {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  countryCode: string;
}): string[] {
  return [
    address.recipientName,
    address.line1,
    address.line2,
    [address.city, address.region, address.postalCode].filter(Boolean).join(", "),
    address.countryCode,
    address.phone,
  ].filter((value): value is string => Boolean(value));
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
  const shipments = useOrderShipmentsQuery(orderId, canReadShipping && (canCreateReturn || canCreateReview));
  const cancel = useCancelCustomerOrderMutation(orderId);

  if (order.isPending) return <LoadingState label="Loading Order..." />;

  if (order.isError) {
    return (
      <ErrorState
        title="Order could not be loaded"
        message={order.error instanceof Error ? order.error.message : "Please try again."}
        requestId={order.error instanceof ApiClientError ? order.error.requestId : undefined}
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
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow={<Link className="hover:underline" to="/orders">← Your Orders</Link>}
        title={order.data.orderNo}
        description={`Placed ${new Date(order.data.placedAt ?? order.data.createdAt).toLocaleString()}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canReadShipping ? (
              <Link
                className="rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-muted"
                to="/orders/$orderId/shipping"
                params={{ orderId }}
              >
                Track Shipments
              </Link>
            ) : null}
            <OrderStatus value={order.data.orderStatus} />
          </div>
        )}
      />

      <Surface className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Payment</p>
          <div className="mt-2"><OrderStatus value={order.data.paymentStatus} /></div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Fulfillment</p>
          <div className="mt-2"><OrderStatus value={order.data.fulfillmentStatus} /></div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Fulfillment groups</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{order.data.sellerOrders.length}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Order total</p>
          <p className="mt-2 text-lg font-semibold text-foreground">{displayMoney(order.data.currency, order.data.grandTotal)}</p>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {order.data.sellerOrders.map((sellerOrder, sellerIndex) => (
            <section key={sellerOrder.id} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-muted px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Shipment group {sellerIndex + 1}</p>
                  <h2 className="mt-1 font-semibold text-foreground">{sellerOrder.sellerOrderNo}</h2>
                  <p className="mt-1 text-xs text-foreground-muted">{sellerOrder.shippingMethod.name} · {displayMoney(sellerOrder.shippingMethod.currency, sellerOrder.shippingMethod.amount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canCreateReturn && sellerOrder.items.some((item) => deliveredItemIds.has(item.id)) ? (
                    <Link
                      className="rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold hover:bg-surface"
                      to="/orders/$orderId/returns/$sellerOrderId/new"
                      params={{ orderId, sellerOrderId: sellerOrder.id }}
                    >
                      Request Return
                    </Link>
                  ) : null}
                  <OrderStatus value={sellerOrder.status} />
                </div>
              </div>

              <ul className="divide-y divide-border">
                {sellerOrder.items.map((item) => (
                  <li key={item.id} className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <strong className="font-semibold text-foreground">{item.name}</strong>
                      <p className="mt-1 text-xs text-foreground-muted">
                        SKU {item.sku}{item.variantTitle ? ` · ${item.variantTitle}` : ""}
                      </p>
                      <p className="mt-2 text-sm text-foreground-muted">
                        {item.quantity} ordered · {item.remainingQuantity} remaining
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canCreateReview && deliveredItemIds.has(item.id) ? (
                          <Link
                            className="rounded-control border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-muted"
                            to="/orders/$orderId/reviews/$orderItemId/new"
                            params={{ orderId, orderItemId: item.id }}
                          >
                            Write Review
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2 text-left sm:text-right">
                      <p className="font-semibold text-foreground">{displayMoney(order.data.currency, item.lineTotal)}</p>
                      <OrderStatus value={item.status} />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="grid gap-3 border-t border-border bg-surface-muted px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-foreground-muted">Subtotal</span><p className="font-semibold">{displayMoney(order.data.currency, sellerOrder.subtotal)}</p></div>
                <div><span className="text-foreground-muted">Discount</span><p className="font-semibold">−{displayMoney(order.data.currency, sellerOrder.discountTotal)}</p></div>
                <div><span className="text-foreground-muted">Shipping</span><p className="font-semibold">{displayMoney(order.data.currency, sellerOrder.shippingTotal)}</p></div>
                <div><span className="text-foreground-muted">Group total</span><p className="font-semibold">{displayMoney(order.data.currency, sellerOrder.grandTotal)}</p></div>
              </div>
            </section>
          ))}

          <Surface>
            <h2 className="text-lg font-semibold text-foreground">Order timeline</h2>
            <p className="mt-1 text-sm text-foreground-muted">Server-recorded lifecycle changes for this Order.</p>
            <div className="mt-5"><OrderTimeline entries={order.data.statusHistory} /></div>
          </Surface>

          {order.data.paymentStatus === "pending" && order.data.orderStatus !== "cancelled" ? (
            <OrderCancellationForm
              items={itemOptions}
              isPending={cancel.isPending}
              error={cancel.error}
              onSubmit={(input, key) => cancel.mutateAsync({ input, idempotencyKey: key }).then(() => undefined)}
            />
          ) : (
            <Surface variant="muted" padding="sm">
              <p className="text-sm text-foreground-muted">
                Cancellation is unavailable after payment capture or final cancellation. The server remains authoritative for cancellation eligibility.
              </p>
            </Surface>
          )}
        </div>

        <aside className="space-y-5">
          <Surface>
            <h2 className="font-semibold text-foreground">Order summary</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-foreground-muted">Subtotal</dt><dd>{displayMoney(order.data.currency, order.data.subtotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-foreground-muted">Discount</dt><dd>−{displayMoney(order.data.currency, order.data.discountTotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-foreground-muted">Shipping</dt><dd>{displayMoney(order.data.currency, order.data.shippingTotal)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-foreground-muted">Tax</dt><dd>{displayMoney(order.data.currency, order.data.taxTotal)}</dd></div>
              <div className="flex justify-between gap-4 border-t border-border pt-3 text-base font-semibold"><dt>Total</dt><dd>{displayMoney(order.data.currency, order.data.grandTotal)}</dd></div>
            </dl>
          </Surface>

          <Surface>
            <h2 className="font-semibold text-foreground">Shipping address</h2>
            <address className="mt-3 space-y-1 text-sm not-italic leading-5 text-foreground-muted">
              {addressLines(order.data.shippingAddress).map((line) => <div key={line}>{line}</div>)}
            </address>
          </Surface>

          <Surface>
            <h2 className="font-semibold text-foreground">Billing address</h2>
            <address className="mt-3 space-y-1 text-sm not-italic leading-5 text-foreground-muted">
              {addressLines(order.data.billingAddress).map((line) => <div key={line}>{line}</div>)}
            </address>
          </Surface>
        </aside>
      </div>
    </div>
  );
}

/** Protects customer Order detail before issuing the customer-owned Order request. */
export function CustomerOrderDetailPage() {
  const { orderId } = useParams({ strict: false });

  return (
    <CustomerAccountLayout>
      {(user) =>
        user.permissions.includes(ORDERS_PERMISSION.READ_OWN) ? (
          <CustomerOrderDetailContent
            orderId={String(orderId)}
            canReadShipping={user.permissions.includes("shipping.read_own_order")}
            canCreateReturn={user.permissions.includes(RETURNS_PERMISSION.CREATE_OWN)}
            canCreateReview={user.permissions.includes(REVIEWS_PERMISSION.CREATE_VERIFIED)}
          />
        ) : (
          <ErrorState title="Access denied" message="Your account does not have permission to read customer Orders." />
        )
      }
    </CustomerAccountLayout>
  );
}

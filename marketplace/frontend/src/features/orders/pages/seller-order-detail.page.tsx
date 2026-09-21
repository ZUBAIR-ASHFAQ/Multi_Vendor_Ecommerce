import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
import { OrderStatus } from "../components/order-status";
import { OrderTimeline } from "../components/order-timeline";
import {
  useAcceptSellerOrderMutation,
  useSellerOrderDetailQuery,
} from "../hooks/use-orders";
import { ORDERS_PERMISSION } from "../orders.constants";

/** Renders one seller-scoped fulfillment unit and controlled acceptance command. */
function SellerOrderDetailContent({
  sellerOrderId,
  canManage,
  canReadShipping,
}: {
  sellerOrderId: string;
  canManage: boolean;
  canReadShipping: boolean;
}) {
  const order = useSellerOrderDetailQuery(sellerOrderId);
  const accept = useAcceptSellerOrderMutation(sellerOrderId);

  if (order.isPending) return <LoadingState label="Loading Seller Order..." />;

  if (order.isError) {
    return (
      <ErrorState
        title="Seller Order could not be loaded"
        message={order.error instanceof Error ? order.error.message : "Please try again."}
        requestId={order.error instanceof ApiClientError ? order.error.requestId : undefined}
        onRetry={() => void order.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link className="text-sm underline underline-offset-4" to="/seller/orders">← Seller Order queue</Link>
            <h1 className="mt-2 text-2xl font-bold">{order.data.sellerOrderNo}</h1>
            <p className="mt-1 text-sm text-slate-500">Parent {order.data.orderNo}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <OrderStatus value={order.data.status} />
            {canReadShipping ? (
              <Button asChild variant="outline">
                <Link to="/seller/orders/$sellerOrderId/shipping" params={{ sellerOrderId }}>Fulfillment</Link>
              </Button>
            ) : null}
            {canManage && order.data.status === "pending_acceptance" ? (
              <Button disabled={accept.isPending} onClick={() => void accept.mutateAsync()}>
                {accept.isPending ? "Accepting..." : "Accept Seller Order"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {accept.error ? (
        <ErrorState
          title="Seller Order could not be accepted"
          message={accept.error instanceof Error ? accept.error.message : "Please try again."}
          requestId={accept.error instanceof ApiClientError ? accept.error.requestId : undefined}
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Items to fulfill</h2>
                <p className="mt-1 text-sm text-slate-500">Immutable item and price snapshots from this Seller Order.</p>
              </div>
              <OrderStatus value={order.data.fulfillmentStatus} />
            </div>
            <ul className="mt-4 divide-y">
              {order.data.items.map((item) => (
                <li key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <strong>{item.name}</strong>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.variantTitle ? `${item.variantTitle} · ` : ""}{item.sku}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {item.remainingQuantity} remaining of {item.quantity} · {formatMoney(item.unitPrice, order.data.currency)} each
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-semibold">{formatMoney(item.lineTotal, order.data.currency)}</p>
                    <div className="mt-2"><OrderStatus value={item.status} /></div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Status timeline</h2>
            <p className="mt-1 text-sm text-slate-500">Authoritative Seller Order lifecycle history.</p>
            <div className="mt-4"><OrderTimeline entries={order.data.statusHistory} /></div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Order summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(order.data.subtotal, order.data.currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Discount</dt><dd>-{formatMoney(order.data.discountTotal, order.data.currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Tax</dt><dd>{formatMoney(order.data.taxTotal, order.data.currency)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Shipping</dt><dd>{formatMoney(order.data.shippingTotal, order.data.currency)}</dd></div>
              <div className="flex justify-between gap-3 border-t pt-3 text-base font-semibold"><dt>Total</dt><dd>{formatMoney(order.data.grandTotal, order.data.currency)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <OrderStatus value={order.data.paymentStatus} />
              <OrderStatus value={order.data.fulfillmentStatus} />
            </div>
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Delivery</h2>
            <p className="mt-3 text-sm font-medium">{order.data.shippingAddress.recipientName}</p>
            <p className="mt-1 text-sm text-slate-600">
              {order.data.shippingAddress.line1}{order.data.shippingAddress.line2 ? `, ${order.data.shippingAddress.line2}` : ""}<br />
              {order.data.shippingAddress.city}, {order.data.shippingAddress.region}
              {order.data.shippingAddress.postalCode ? ` ${order.data.shippingAddress.postalCode}` : ""}<br />
              {order.data.shippingAddress.countryCode}
            </p>
            <p className="mt-3 text-sm text-slate-600">{order.data.shippingAddress.phone}</p>
            <div className="mt-4 border-t pt-4 text-sm">
              <strong>{order.data.shippingMethod.name}</strong>
              <p className="mt-1 text-slate-500">{formatMoney(order.data.shippingMethod.amount, order.data.shippingMethod.currency)}</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Protects Seller Order detail and keeps seller.orders.manage as a UI convenience only. */
export function SellerOrderDetailPage() {
  const { sellerOrderId } = useParams({ strict: false });

  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={ORDERS_PERMISSION.SELLER_READ}>
          <SellerOrderDetailContent
            sellerOrderId={String(sellerOrderId)}
            canManage={user.permissions.includes(ORDERS_PERMISSION.SELLER_MANAGE)}
            canReadShipping={user.permissions.includes("seller.shipping.read")}
          />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

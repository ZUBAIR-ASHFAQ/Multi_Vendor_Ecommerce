import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
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

  if (order.isPending) {
    return <LoadingState label="Loading Seller Order..." />;
  }

  if (order.isError) {
    return (
      <ErrorState
        title="Seller Order could not be loaded"
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-sm underline" to="/seller/orders">
            ← Seller Order queue
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{order.data.sellerOrderNo}</h1>
          <p className="text-sm text-slate-500">Parent {order.data.orderNo}</p>
        </div>
        <div className="flex items-center gap-2">
          {canReadShipping ? (
            <Link
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-slate-50"
              to="/seller/orders/$sellerOrderId/shipping"
              params={{ sellerOrderId }}
            >
              Fulfillment
            </Link>
          ) : null}
          <OrderStatus value={order.data.status} />
          {canManage && order.data.status === "pending_acceptance" ? (
            <Button
              disabled={accept.isPending}
              onClick={() => void accept.mutateAsync()}
            >
              {accept.isPending ? "Accepting..." : "Accept Seller Order"}
            </Button>
          ) : null}
        </div>
      </div>

      {accept.error ? (
        <ErrorState
          title="Seller Order could not be accepted"
          message={
            accept.error instanceof Error
              ? accept.error.message
              : "Please try again."
          }
          requestId={
            accept.error instanceof ApiClientError
              ? accept.error.requestId
              : undefined
          }
        />
      ) : null}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Items</h2>
        <ul className="mt-3 divide-y">
          {order.data.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-3">
              <div>
                <strong>{item.name}</strong>
                <p className="text-xs text-slate-500">{item.sku}</p>
              </div>
              <div className="text-right text-sm">
                <p>{item.remainingQuantity} remaining</p>
                <OrderStatus value={item.status} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Delivery snapshot</h2>
        <p className="mt-2 text-sm">
          {order.data.shippingAddress.recipientName} · {order.data.shippingAddress.line1},{" "}
          {order.data.shippingAddress.city}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {order.data.shippingMethod.name} · {order.data.shippingMethod.amount}{" "}
          {order.data.shippingMethod.currency}
        </p>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Status timeline</h2>
        <div className="mt-4">
          <OrderTimeline entries={order.data.statusHistory} />
        </div>
      </section>
    </div>
  );
}

/** Protects Seller Order detail and keeps seller.orders.manage as a UI convenience only. */
export function SellerOrderDetailPage() {
  const { sellerOrderId } = useParams({ strict: false });

  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission
          user={user}
          permission={ORDERS_PERMISSION.SELLER_READ}
        >
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

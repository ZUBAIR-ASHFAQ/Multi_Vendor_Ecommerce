import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
import { useCustomerOrderDetailQuery } from "@/features/orders/hooks/use-orders";
import { useOrderShipmentsQuery } from "@/features/shipping/hooks/use-shipping";
import { ApiClientError } from "@/lib/api-error";
import { ReturnRequestForm } from "../forms/return-request.form";
import {
  useCreateReturnRequestMutation,
  useCustomerReturnsQuery,
} from "../hooks/use-returns-refunds";
import { RETURNS_PERMISSION } from "../returns-refunds.constants";

/** Returns the first safe API error among the page's prerequisite queries. */
function firstQueryError(errors: unknown[]): { message: string; requestId?: string } | null {
  const error = errors.find(Boolean);
  if (!error) return null;
  return {
    message: error instanceof Error ? error.message : "Please try again.",
    requestId: error instanceof ApiClientError ? error.requestId : undefined,
  };
}

/** Builds customer-facing item labels from the immutable Order snapshot. */
function itemLabel(name: string, sku: string, variantTitle: string | null): string {
  return `${name} (${sku}${variantTitle ? ` · ${variantTitle}` : ""})`;
}

/** Renders a Return Request form from delivered Shipment quantities and prior non-rejected Returns. */
function CustomerCreateReturnContent({
  orderId,
  sellerOrderId,
}: {
  orderId: string;
  sellerOrderId: string;
}) {
  const navigate = useNavigate();
  const order = useCustomerOrderDetailQuery(orderId);
  const shipments = useOrderShipmentsQuery(orderId);
  const returns = useCustomerReturnsQuery({
    page: 1,
    pageSize: 100,
    orderId,
    sort: "requestedAt",
    order: "desc",
  });
  const createReturn = useCreateReturnRequestMutation(orderId);

  if (order.isPending || shipments.isPending || returns.isPending) {
    return <LoadingState label="Checking delivered Return eligibility..." />;
  }

  const queryError = firstQueryError([order.error, shipments.error, returns.error]);
  if (queryError || !order.data || !shipments.data || !returns.data) {
    return (
      <ErrorState
        title="Return eligibility could not be loaded"
        message={queryError?.message ?? "Please try again."}
        requestId={queryError?.requestId}
        onRetry={() => {
          void Promise.all([order.refetch(), shipments.refetch(), returns.refetch()]);
        }}
      />
    );
  }

  const sellerOrder = order.data.sellerOrders.find((value) => value.id === sellerOrderId);
  if (!sellerOrder) {
    return <ErrorState title="Seller Order not found" message="This seller fulfillment group does not belong to the selected Order." />;
  }

  const deliveredByItem = new Map<string, number>();
  for (const shipment of shipments.data) {
    if (shipment.status !== "delivered") continue;
    for (const item of shipment.items) {
      deliveredByItem.set(item.orderItemId, (deliveredByItem.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }

  const reservedByItem = new Map<string, number>();
  for (const request of returns.data.items) {
    if (request.sellerOrderId !== sellerOrderId || request.status === "rejected") continue;
    for (const item of request.items) {
      reservedByItem.set(item.orderItemId, (reservedByItem.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }

  const items = sellerOrder.items
    .map((item) => ({
      orderItemId: item.id,
      label: itemLabel(item.name, item.sku, item.variantTitle),
      maxQuantity: Math.max(0, (deliveredByItem.get(item.id) ?? 0) - (reservedByItem.get(item.id) ?? 0)),
    }))
    .filter((item) => item.maxQuantity > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link className="hover:underline" to="/orders/$orderId" params={{ orderId }}>← Order detail</Link>}
        title="Request a Return"
        description={`Choose only delivered quantities from ${order.data.orderNo}. The server re-checks ownership, delivery, prior Returns and the Return window when you submit.`}
      />

      <Surface variant="muted" padding="sm" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <span className="text-foreground-muted">Fulfillment group</span>
          <p className="font-semibold text-foreground">{sellerOrder.sellerOrderNo}</p>
        </div>
        <div className="text-right">
          <span className="text-foreground-muted">Eligible items</span>
          <p className="font-semibold text-foreground">{items.length}</p>
        </div>
      </Surface>

      {items.length === 0 ? (
        <ErrorState
          title="No delivered quantity is available to return"
          message="This fulfillment group has no delivered quantity remaining after earlier non-rejected Return requests."
        />
      ) : (
        <ReturnRequestForm
          sellerOrderId={sellerOrderId}
          items={items}
          isPending={createReturn.isPending}
          error={createReturn.error}
          onSubmit={(input) =>
            createReturn.mutateAsync(input).then(async () => {
              await navigate({ to: "/returns" });
            })
          }
        />
      )}
    </div>
  );
}

/** Protects customer Return creation with the required Return plus prerequisite read permissions. */
export function CustomerCreateReturnPage() {
  const { orderId, sellerOrderId } = useParams({ strict: false });

  return (
    <CustomerAccountLayout>
      {(user) =>
        user.permissions.includes(RETURNS_PERMISSION.CREATE_OWN) &&
        user.permissions.includes("orders.read_own") &&
        user.permissions.includes("shipping.read_own_order") ? (
          <CustomerCreateReturnContent orderId={String(orderId)} sellerOrderId={String(sellerOrderId)} />
        ) : (
          <ErrorState title="Access denied" message="Your account does not have permission to create this Return Request." />
        )
      }
    </CustomerAccountLayout>
  );
}

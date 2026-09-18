import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { ApiClientError } from "@/lib/api-error";
import { useCustomerPaymentStatusQuery } from "../hooks/use-payments";
import { PAYMENT_STATUS, PAYMENTS_PERMISSION } from "../payments.constants";
import { PaymentStatusBadge } from "../components/payment-status-badge";

/** Renders one provider-authoritative Payment status without trusting Stripe redirect query parameters. */
function PaymentStatusContent({ orderId }: { orderId: string }) {
  const payment = useCustomerPaymentStatusQuery(orderId);

  if (payment.isPending) {
    return <LoadingState label="Loading payment status..." />;
  }

  if (payment.isError) {
    return (
      <ErrorState
        title="Payment status could not be loaded"
        message={payment.error instanceof Error ? payment.error.message : "Please try again."}
        requestId={payment.error instanceof ApiClientError ? payment.error.requestId : undefined}
        onRetry={() => void payment.refetch()}
      />
    );
  }

  const value = payment.data;
  const processing = value.status === PAYMENT_STATUS.PENDING || value.status === PAYMENT_STATUS.PROCESSING;
  const captured = value.status === PAYMENT_STATUS.CAPTURED;

  return (
    <section className="space-y-5 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Module 12 · Payments</p>
          <h1 className="mt-1 text-2xl font-bold">Payment status</h1>
          <p className="mt-1 text-sm text-slate-600">
            This screen reads the marketplace backend. Browser redirect parameters never mark an Order paid.
          </p>
        </div>
        <PaymentStatusBadge status={value.status} />
      </div>

      {processing ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Payment is still processing. This page refreshes provider-authoritative marketplace status automatically.
        </p>
      ) : null}
      {captured ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          Payment captured. The marketplace received provider-authoritative confirmation.
        </p>
      ) : null}
      {value.status === PAYMENT_STATUS.FAILED || value.status === PAYMENT_STATUS.CANCELLED ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          This Payment was not captured. Return to the Order or Checkout flow before trying again.
        </p>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold">Order</dt><dd className="break-all text-slate-600">{value.orderId}</dd></div>
        <div><dt className="font-semibold">Provider</dt><dd className="text-slate-600">Stripe</dd></div>
        <div>
          <dt className="font-semibold">Authorized</dt>
          <dd className="text-slate-600">{value.amountAuthorized} {value.currency}</dd>
        </div>
        <div><dt className="font-semibold">Captured</dt><dd className="text-slate-600">{value.amountCaptured} {value.currency}</dd></div>
        <div><dt className="font-semibold">Refunded</dt><dd className="text-slate-600">{value.amountRefunded} {value.currency}</dd></div>
        <div>
          <dt className="font-semibold">Refundable</dt>
          <dd className="text-slate-600">{value.refundableAmount} {value.currency}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void payment.refetch()}>
          Refresh status
        </Button>
        <Button asChild>
          <Link to="/orders/$orderId" params={{ orderId }}>
            View Order
          </Link>
        </Button>
      </div>
    </section>
  );
}

/** Protects the customer Payment status route with the own-Payment convenience permission. */
export function PaymentStatusPage() {
  const { orderId } = useParams({ strict: false }) as { orderId: string };

  return (
    <AuthenticatedPanel>
      {(user) =>
        user.accountType === "customer" && user.permissions.includes(PAYMENTS_PERMISSION.READ_OWN) ? (
          <PaymentStatusContent orderId={orderId} />
        ) : (
          <ErrorState
            title="Access denied"
            message="Your account does not have permission to read customer Payment status."
          />
        )
      }
    </AuthenticatedPanel>
  );
}

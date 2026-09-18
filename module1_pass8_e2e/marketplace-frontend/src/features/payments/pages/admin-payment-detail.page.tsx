import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { PaymentStatusBadge } from "../components/payment-status-badge";
import { PaymentTimeline } from "../components/payment-timeline";
import { useAdminPaymentDetailQuery } from "../hooks/use-payments";
import { PAYMENTS_PERMISSION } from "../payments.constants";

/** Renders one finance Payment aggregate and its append-only provider transaction history. */
function AdminPaymentDetailContent({ paymentId }: { paymentId: string }) {
  const payment = useAdminPaymentDetailQuery(paymentId);

  if (payment.isPending) {
    return <LoadingState label="Loading Payment detail..." />;
  }

  if (payment.isError) {
    return (
      <ErrorState
        title="Payment detail could not be loaded"
        message={payment.error instanceof Error ? payment.error.message : "Please try again."}
        requestId={payment.error instanceof ApiClientError ? payment.error.requestId : undefined}
        onRetry={() => void payment.refetch()}
      />
    );
  }

  const value = payment.data;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Finance · Payment detail</p>
            <h1 className="mt-1 text-2xl font-bold">{value.providerPaymentId ?? value.paymentId}</h1>
            <p className="mt-1 break-all text-sm text-slate-600">Order {value.orderId}</p>
          </div>
          <PaymentStatusBadge status={value.status} />
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="font-semibold">Authorized</dt><dd>{value.amountAuthorized} {value.currency}</dd></div>
          <div><dt className="font-semibold">Captured</dt><dd>{value.amountCaptured} {value.currency}</dd></div>
          <div><dt className="font-semibold">Refunded</dt><dd>{value.amountRefunded} {value.currency}</dd></div>
          <div><dt className="font-semibold">Refundable</dt><dd>{value.refundableAmount} {value.currency}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Transaction timeline</h2>
        <p className="mt-1 text-sm text-slate-600">
          Append-only provider references are shown for reconciliation. Refund actions are owned by trusted backend orchestration.
        </p>
        <div className="mt-4">
          <PaymentTimeline transactions={value.transactions} currency={value.currency} />
        </div>
      </section>

      <Button variant="outline" asChild>
        <Link to="/admin/payments">Back to Payment search</Link>
      </Button>
    </div>
  );
}

/** Protects finance Payment detail with the same admin read permission as the search surface. */
export function AdminPaymentDetailPage() {
  const { paymentId } = useParams({ strict: false }) as { paymentId: string };

  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={PAYMENTS_PERMISSION.ADMIN_READ}>
          <AdminPaymentDetailContent paymentId={paymentId} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

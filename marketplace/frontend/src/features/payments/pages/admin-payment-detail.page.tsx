import { Link, useParams } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Surface } from "@/components/ui/surface";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PaymentStatusBadge } from "../components/payment-status-badge";
import { PaymentTimeline } from "../components/payment-timeline";
import { useAdminPaymentDetailQuery } from "../hooks/use-payments";
import { PAYMENTS_PERMISSION } from "../payments.constants";

/** Renders one finance Payment aggregate and its append-only provider transaction history. */
function AdminPaymentDetailContent({ paymentId }: { paymentId: string }) {
  const payment = useAdminPaymentDetailQuery(paymentId);

  if (payment.isPending) return <LoadingState label="Loading payment detail..." />;
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
      <PageHeader
        eyebrow="Finance · Payment detail"
        title={value.providerPaymentId ?? value.paymentId}
        description={<>Order <span className="break-all font-mono text-xs">{value.orderId}</span></>}
        actions={(
          <>
            <PaymentStatusBadge status={value.status} />
            <Button variant="outline" asChild><Link to="/admin/payments">Back to payments</Link></Button>
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Authorized" value={formatMoney(value.amountAuthorized, value.currency)} />
        <StatCard label="Captured" value={formatMoney(value.amountCaptured, value.currency)} />
        <StatCard label="Refunded" value={formatMoney(value.amountRefunded, value.currency)} />
        <StatCard label="Refundable" value={formatMoney(value.refundableAmount, value.currency)} />
      </div>

      <Surface>
        <h2 className="text-lg font-semibold text-foreground">Reconciliation context</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="font-semibold text-foreground-muted">Provider</dt><dd>{value.provider}</dd></div>
          <div><dt className="font-semibold text-foreground-muted">Provider reference</dt><dd className="break-all">{value.providerPaymentId ?? "Not assigned"}</dd></div>
          <div><dt className="font-semibold text-foreground-muted">Created</dt><dd>{formatDateTime(value.createdAt)}</dd></div>
          <div><dt className="font-semibold text-foreground-muted">Updated</dt><dd>{formatDateTime(value.updatedAt)}</dd></div>
        </dl>
      </Surface>

      <Surface>
        <h2 className="text-xl font-semibold text-foreground">Transaction timeline</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">
          Append-only provider references are shown for reconciliation. Refund actions remain owned by trusted backend orchestration.
        </p>
        <div className="mt-4">
          <PaymentTimeline transactions={value.transactions} currency={value.currency} />
        </div>
      </Surface>
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

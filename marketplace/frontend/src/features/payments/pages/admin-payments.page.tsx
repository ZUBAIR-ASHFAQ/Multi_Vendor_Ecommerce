import { Link } from "@tanstack/react-router";
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
import { PaymentPagination } from "../components/payment-pagination";
import { PaymentStatusBadge } from "../components/payment-status-badge";
import { AdminPaymentFilterForm } from "../forms/admin-payment-filter.form";
import { useAdminPaymentsQuery } from "../hooks/use-payments";
import { PAYMENTS_PERMISSION } from "../payments.constants";
import type { AdminPaymentsParams } from "../types/payments.types";

/** Renders finance-safe Payment search results without exposing client secrets or refund commands. */
function AdminPaymentsContent() {
  const [params, setParams] = useState<AdminPaymentsParams>({
    page: 1,
    pageSize: 20,
    sort: "createdAt",
    order: "desc",
  });
  const payments = useAdminPaymentsQuery(params);

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Commerce · Payments"
        title="Payment operations"
        description="Search provider-authoritative payment records and open reconciliation detail without exposing client secrets or adding browser-owned refund logic."
        meta={payments.data?.meta}
        visibleCount={payments.data?.items.length}
      />

      <AdminPaymentFilterForm
        onApply={(filters) =>
          setParams((current) => ({
            ...current,
            ...filters,
            page: 1,
          }))
        }
      />

      {payments.isPending ? <LoadingState variant="table" label="Loading payments..." /> : null}
      {payments.isError ? (
        <ErrorState
          title="Payments could not be loaded"
          message={payments.error instanceof Error ? payments.error.message : "Please try again."}
          requestId={payments.error instanceof ApiClientError ? payments.error.requestId : undefined}
          onRetry={() => void payments.refetch()}
        />
      ) : null}

      {payments.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No payments match these filters"
          description="Change status, order ID, provider reference, or currency to search another set of payment records."
        />
      ) : null}

      {payments.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[980px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Captured</th>
              <th className="px-4 py-3">Refunded</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {payments.data.items.map((payment) => (
              <tr key={payment.paymentId} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <strong className="block text-foreground">{payment.providerPaymentId ?? "Internal payment"}</strong>
                  <span className="block break-all text-xs text-foreground-muted">{payment.paymentId}</span>
                </td>
                <td className="px-4 py-3 break-all text-xs text-foreground-muted">{payment.orderId}</td>
                <td className="px-4 py-3"><PaymentStatusBadge status={payment.status} /></td>
                <td className="px-4 py-3 whitespace-nowrap font-medium">{formatMoney(payment.amountCaptured, payment.currency)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatMoney(payment.amountRefunded, payment.currency)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(payment.updatedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/admin/payments/$paymentId" params={{ paymentId: payment.paymentId }}>Open detail</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {payments.data ? (
        <PaymentPagination
          meta={payments.data.meta}
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      ) : null}
    </div>
  );
}

/** Protects finance Payment search with the server-derived admin read permission. */
export function AdminPaymentsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={PAYMENTS_PERMISSION.ADMIN_READ}>
          <AdminPaymentsContent />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

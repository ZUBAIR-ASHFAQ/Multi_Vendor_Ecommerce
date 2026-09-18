import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { AdminPaymentFilterForm } from "../forms/admin-payment-filter.form";
import { useAdminPaymentsQuery } from "../hooks/use-payments";
import { PAYMENTS_PERMISSION } from "../payments.constants";
import type { AdminPaymentsParams } from "../types/payments.types";
import { PaymentPagination } from "../components/payment-pagination";
import { PaymentStatusBadge } from "../components/payment-status-badge";

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
      <AdminPaymentFilterForm
        onApply={(filters) =>
          setParams((current) => ({
            ...current,
            ...filters,
            page: 1,
          }))
        }
      />

      {payments.isPending ? <LoadingState label="Loading Payments..." /> : null}
      {payments.isError ? (
        <ErrorState
          title="Payments could not be loaded"
          message={payments.error instanceof Error ? payments.error.message : "Please try again."}
          requestId={payments.error instanceof ApiClientError ? payments.error.requestId : undefined}
          onRetry={() => void payments.refetch()}
        />
      ) : null}

      {payments.data ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold">Payment search</h1>
          <p className="mt-1 text-sm text-slate-600">
            Finance reads Payment movement separately from marketplace revenue, seller liability, and payout state.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2">Payment</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Captured</th>
                  <th>Refunded</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {payments.data.items.map((payment) => (
                  <tr key={payment.paymentId} className="border-b">
                    <td className="py-3 font-medium">{payment.providerPaymentId ?? payment.paymentId}</td>
                    <td className="break-all">{payment.orderId}</td>
                    <td><PaymentStatusBadge status={payment.status} /></td>
                    <td>{payment.amountCaptured} {payment.currency}</td>
                    <td>{payment.amountRefunded} {payment.currency}</td>
                    <td className="text-right">
                      <Link
                        className="underline"
                        to="/admin/payments/$paymentId"
                        params={{ paymentId: payment.paymentId }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payments.data.items.length === 0 ? (
              <p className="py-8 text-center text-slate-500">No Payments found.</p>
            ) : null}
          </div>

          <div className="mt-4">
            <PaymentPagination
              meta={payments.data.meta}
              onPageChange={(page) => setParams((current) => ({ ...current, page }))}
            />
          </div>
        </section>
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

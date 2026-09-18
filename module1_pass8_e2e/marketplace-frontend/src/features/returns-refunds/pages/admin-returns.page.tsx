import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { ApiClientError } from "@/lib/api-error";
import { RefundBreakdown } from "../components/refund-breakdown";
import { ReturnPagination } from "../components/return-pagination";
import { ReturnStatus } from "../components/return-status";
import { ReturnTimeline } from "../components/return-timeline";
import { ReturnRefundForm } from "../forms/return-refund.form";
import {
  useAdminReturnsQuery,
  useIssueReturnRefundMutation,
} from "../hooks/use-returns-refunds";
import {
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  RETURN_STATUS_VALUES,
  RETURNS_PERMISSION,
} from "../returns-refunds.constants";
import type { AdminReturnListParams, ReturnRequest } from "../types/returns-refunds.types";

/** Renders one admin/support Return with safe dispute context and optional privileged refund action. */
function AdminReturnCard({ value, canIssueRefund }: { value: ReturnRequest; canIssueRefund: boolean }) {
  const refund = useIssueReturnRefundMutation(value.id);
  const refundableState = value.status === "approved" || value.status === "received";

  return (
    <article className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{value.returnNo}</h2>
          <p className="text-xs text-slate-500">Order {value.orderId}</p>
          <p className="text-xs text-slate-500">Seller Order {value.sellerOrderId}</p>
          <p className="text-xs text-slate-500">Customer {value.customerUserId}</p>
          <p className="mt-1 text-sm">Reason: {RETURN_REASON_LABEL[value.reasonCode]}</p>
        </div>
        <ReturnStatus value={value.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Dispute/support timeline</h3>
          <p className="mb-2 text-xs text-slate-500">
            The current API exposes Return lifecycle facts only; it does not expose dispute-note CRUD.
          </p>
          <ReturnTimeline value={value} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Refund and restock breakdown</h3>
          <div className="mt-2"><RefundBreakdown value={value} /></div>
        </div>
      </div>

      {canIssueRefund && refundableState ? (
        <ReturnRefundForm
          isPending={refund.isPending}
          error={refund.error}
          result={refund.data}
          onSubmit={(input, idempotencyKey) =>
            refund.mutateAsync({ input, idempotencyKey }).then(() => undefined)
          }
        />
      ) : null}
    </article>
  );
}

/** Renders the admin Return/dispute view with bounded support filters. */
function AdminReturnsContent({ canIssueRefund }: { canIssueRefund: boolean }) {
  const [params, setParams] = useState<AdminReturnListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const returns = useAdminReturnsQuery(params);

  if (returns.isPending) return <LoadingState label="Loading admin Returns..." />;
  if (returns.isError) {
    return (
      <ErrorState
        title="Admin Returns could not be loaded"
        message={returns.error instanceof Error ? returns.error.message : "Please try again."}
        requestId={returns.error instanceof ApiClientError ? returns.error.requestId : undefined}
        onRetry={() => void returns.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Returns & dispute review</h1>
            <p className="mt-1 text-sm text-slate-600">
              Search Return lifecycle and item outcomes. Refund execution remains a separate privileged command.
            </p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Admin Return status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as AdminReturnListParams["status"] : undefined,
              }))}
            >
              <option value="">All</option>
              {RETURN_STATUS_VALUES.map((value) => <option key={value} value={value}>{RETURN_STATUS_LABEL[value]}</option>)}
            </select>
          </label>
        </div>
      </section>

      {returns.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">No Returns found.</p>
      ) : returns.data.items.map((value) => (
        <AdminReturnCard key={value.id} value={value} canIssueRefund={canIssueRefund} />
      ))}

      <ReturnPagination meta={returns.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
    </div>
  );
}

/** Protects the admin Return view and hides the refund command without its separate permission. */
export function AdminReturnsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={RETURNS_PERMISSION.ADMIN_MANAGE}>
          <AdminReturnsContent canIssueRefund={user.permissions.includes(RETURNS_PERMISSION.ADMIN_REFUNDS_ISSUE)} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

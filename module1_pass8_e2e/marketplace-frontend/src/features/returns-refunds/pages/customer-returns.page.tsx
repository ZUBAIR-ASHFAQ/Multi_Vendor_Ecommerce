import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AuthenticatedPanel } from "@/features/auth/components/authenticated-panel";
import { ApiClientError } from "@/lib/api-error";
import { RefundBreakdown } from "../components/refund-breakdown";
import { ReturnPagination } from "../components/return-pagination";
import { ReturnStatus } from "../components/return-status";
import { ReturnTimeline } from "../components/return-timeline";
import { useCustomerReturnsQuery } from "../hooks/use-returns-refunds";
import {
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  RETURN_STATUS_VALUES,
  RETURNS_PERMISSION,
} from "../returns-refunds.constants";
import type { ReturnListParams } from "../types/returns-refunds.types";

/** Renders one customer's own Return Request history with refund/restock effects kept separate. */
function CustomerReturnsContent() {
  const [params, setParams] = useState<ReturnListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const returns = useCustomerReturnsQuery(params);

  if (returns.isPending) return <LoadingState label="Loading your Returns..." />;
  if (returns.isError) {
    return (
      <ErrorState
        title="Returns could not be loaded"
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
            <h1 className="text-2xl font-bold">Your Returns</h1>
            <p className="mt-1 text-sm text-slate-600">
              Track Return approval, inspection, refund amount, and any physical restock separately.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="text-sm font-medium">
              Status
              <select
                aria-label="Customer Return status filter"
                className="ml-2 rounded-md border px-3 py-2"
                value={params.status ?? ""}
                onChange={(event) => setParams((current) => ({
                  ...current,
                  page: 1,
                  status: event.target.value ? event.target.value as ReturnListParams["status"] : undefined,
                }))}
              >
                <option value="">All</option>
                {RETURN_STATUS_VALUES.map((value) => <option key={value} value={value}>{RETURN_STATUS_LABEL[value]}</option>)}
              </select>
            </label>
            <Link className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50" to="/orders">Your Orders</Link>
          </div>
        </div>
      </section>

      {returns.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">No Return Requests found.</p>
      ) : returns.data.items.map((value) => (
        <article key={value.id} className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{value.returnNo}</h2>
              <p className="text-xs text-slate-500">Order {value.orderId}</p>
              <p className="mt-1 text-sm">Reason: {RETURN_REASON_LABEL[value.reasonCode]}</p>
            </div>
            <ReturnStatus value={value.status} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">Return timeline</h3>
              <div className="mt-2"><ReturnTimeline value={value} /></div>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Refund and restock breakdown</h3>
              <div className="mt-2"><RefundBreakdown value={value} /></div>
            </div>
          </div>
        </article>
      ))}

      <ReturnPagination meta={returns.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
    </div>
  );
}

/** Protects customer Return history with the server-derived own-read permission. */
export function CustomerReturnsPage() {
  return (
    <AuthenticatedPanel>
      {(user) => user.permissions.includes(RETURNS_PERMISSION.READ_OWN) ? (
        <CustomerReturnsContent />
      ) : (
        <ErrorState title="Access denied" message="Your account does not have permission to read customer Returns." />
      )}
    </AuthenticatedPanel>
  );
}

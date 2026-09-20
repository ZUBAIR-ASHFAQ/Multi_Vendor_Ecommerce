import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { CustomerAccountLayout } from "@/features/customers/components/customer-account-shell";
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Post-purchase"
        title="Your Returns"
        description="Follow approval, inspection and refund progress from one place. Refund and physical restock remain separate server-owned outcomes."
        actions={(
          <Link className="rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-muted" to="/orders">
            Your Orders
          </Link>
        )}
      />

      <Surface className="flex flex-wrap items-center justify-between gap-3" padding="sm">
        <p className="text-sm text-foreground-muted">{returns.data.meta.totalItems} {returns.data.meta.totalItems === 1 ? "Return" : "Returns"}</p>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          Status
          <select
            aria-label="Customer Return status filter"
            className="rounded-control border border-border bg-surface px-3 py-2"
            value={params.status ?? ""}
            onChange={(event) => setParams((current) => ({
              ...current,
              page: 1,
              status: event.target.value ? event.target.value as ReturnListParams["status"] : undefined,
            }))}
          >
            <option value="">All statuses</option>
            {RETURN_STATUS_VALUES.map((value) => <option key={value} value={value}>{RETURN_STATUS_LABEL[value]}</option>)}
          </select>
        </label>
      </Surface>

      {returns.data.items.length === 0 ? (
        <EmptyState
          title="No Return Requests found"
          description={params.status ? "No Returns match this status." : "Eligible delivered items can be returned from the corresponding Order detail page."}
          action={<Link className="rounded-control bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong" to="/orders">Browse Orders</Link>}
        />
      ) : (
        <div className="space-y-5">
          {returns.data.items.map((value) => (
            <article key={value.id} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
              <div className="flex flex-col gap-4 border-b border-border bg-surface-muted px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-muted">Return request</p>
                  <h2 className="mt-1 font-semibold text-foreground">{value.returnNo}</h2>
                  <p className="mt-1 text-sm text-foreground-muted">Requested {new Date(value.requestedAt).toLocaleString()}</p>
                </div>
                <ReturnStatus value={value.status} />
              </div>

              <div className="grid gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Reason</p>
                      <p className="mt-1 font-medium text-foreground">{RETURN_REASON_LABEL[value.reasonCode]}</p>
                    </div>
                    <Link className="text-sm font-semibold text-brand hover:underline" to="/orders/$orderId" params={{ orderId: value.orderId }}>
                      View Order
                    </Link>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">Return timeline</h3>
                  <div className="mt-3"><ReturnTimeline value={value} /></div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Refund and restock breakdown</h3>
                  <p className="mt-1 text-xs text-foreground-muted">Refund amounts and inventory restock quantities are recorded independently.</p>
                  <div className="mt-3"><RefundBreakdown value={value} /></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <ReturnPagination meta={returns.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
    </div>
  );
}

/** Protects customer Return history with the server-derived own-read permission. */
export function CustomerReturnsPage() {
  return (
    <CustomerAccountLayout>
      {(user) => user.permissions.includes(RETURNS_PERMISSION.READ_OWN) ? (
        <CustomerReturnsContent />
      ) : (
        <ErrorState title="Access denied" message="Your account does not have permission to read customer Returns." />
      )}
    </CustomerAccountLayout>
  );
}

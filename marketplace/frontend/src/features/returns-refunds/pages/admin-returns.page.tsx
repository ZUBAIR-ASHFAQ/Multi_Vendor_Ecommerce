import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
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

/** Renders one selected admin/support Return with safe dispute context and optional privileged refund action. */
function AdminReturnDetail({ value, canIssueRefund }: { value: ReturnRequest; canIssueRefund: boolean }) {
  const refund = useIssueReturnRefundMutation(value.id);
  const refundableState = value.status === "approved" || value.status === "received";

  return (
    <Surface variant="elevated" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground-muted">Selected return</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{value.returnNo}</h2>
          <p className="mt-1 text-sm text-foreground-muted">Reason: {RETURN_REASON_LABEL[value.reasonCode]}</p>
        </div>
        <ReturnStatus value={value.status} />
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="font-semibold text-foreground-muted">Order</dt><dd className="break-all">{value.orderId}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Seller order</dt><dd className="break-all">{value.sellerOrderId}</dd></div>
        <div><dt className="font-semibold text-foreground-muted">Customer</dt><dd className="break-all">{value.customerUserId}</dd></div>
      </dl>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Lifecycle timeline</h3>
          <p className="mb-2 text-xs leading-5 text-foreground-muted">
            The current API exposes lifecycle facts only; it does not expose dispute-note CRUD.
          </p>
          <ReturnTimeline value={value} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Refund and restock breakdown</h3>
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
    </Surface>
  );
}

/** Renders the admin Return/dispute queue with bounded support filters. */
function AdminReturnsContent({ canIssueRefund }: { canIssueRefund: boolean }) {
  const [params, setParams] = useState<AdminReturnListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const [orderId, setOrderId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returns = useAdminReturnsQuery(params);
  const selected = returns.data?.items.find((value) => value.id === selectedId);

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Commerce · Returns"
        title="Returns & dispute queue"
        description="Review return lifecycle and item outcomes. Refund execution stays a separate permission-gated backend command."
        meta={returns.data?.meta}
        visibleCount={returns.data?.items.length}
      />

      <form
        className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm sm:grid-cols-[minmax(220px,1fr)_minmax(180px,240px)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedId(null);
          setParams((current) => ({
            ...current,
            page: 1,
            orderId: orderId.trim() || undefined,
          }));
        }}
      >
        <label className="text-sm font-medium text-foreground">
          Order ID
          <Input
            className="mt-1 font-mono"
            aria-label="Admin Return order ID filter"
            placeholder="Exact order UUID"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Status
          <Select
            aria-label="Admin Return status filter"
            className="mt-1"
            value={params.status ?? ""}
            onChange={(event) => {
              setSelectedId(null);
              setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as AdminReturnListParams["status"] : undefined,
              }));
            }}
          >
            <option value="">All statuses</option>
            {RETURN_STATUS_VALUES.map((value) => <option key={value} value={value}>{RETURN_STATUS_LABEL[value]}</option>)}
          </Select>
        </label>
        <div className="flex items-end"><Button className="w-full sm:w-auto" type="submit">Apply filters</Button></div>
      </form>

      {returns.isPending ? <LoadingState variant="table" label="Loading admin returns..." /> : null}
      {returns.isError ? (
        <ErrorState
          title="Admin returns could not be loaded"
          message={returns.error instanceof Error ? returns.error.message : "Please try again."}
          requestId={returns.error instanceof ApiClientError ? returns.error.requestId : undefined}
          onRetry={() => void returns.refetch()}
        />
      ) : null}

      {returns.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No returns match these filters"
          description="Change the status or exact order ID to inspect another part of the returns queue."
        />
      ) : null}

      {returns.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[980px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Return</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {returns.data.items.map((value) => (
              <tr key={value.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3 font-medium text-foreground">{value.returnNo}</td>
                <td className="px-4 py-3 break-all text-xs text-foreground-muted">{value.orderId}</td>
                <td className="px-4 py-3">{RETURN_REASON_LABEL[value.reasonCode]}</td>
                <td className="px-4 py-3"><ReturnStatus value={value.status} /></td>
                <td className="px-4 py-3">{value.items.length}</td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(value.requestedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedId === value.id ? "secondary" : "outline"}
                    onClick={() => setSelectedId((current) => current === value.id ? null : value.id)}
                  >
                    {selectedId === value.id ? "Close review" : "Review"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {selected ? <AdminReturnDetail value={selected} canIssueRefund={canIssueRefund} /> : null}

      {returns.data ? (
        <ReturnPagination
          meta={returns.data.meta}
          onPageChange={(page) => {
            setSelectedId(null);
            setParams((current) => ({ ...current, page }));
          }}
        />
      ) : null}
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

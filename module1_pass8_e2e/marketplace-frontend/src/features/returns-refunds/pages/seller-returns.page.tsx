import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { RefundBreakdown } from "../components/refund-breakdown";
import { ReturnPagination } from "../components/return-pagination";
import { ReturnStatus } from "../components/return-status";
import { ReturnTimeline } from "../components/return-timeline";
import { ApproveReturnForm, RejectReturnForm } from "../forms/return-decision.forms";
import { ReturnInspectionForm } from "../forms/return-inspection.form";
import {
  useApproveReturnMutation,
  useReceiveReturnMutation,
  useRejectReturnMutation,
  useSellerReturnsQuery,
} from "../hooks/use-returns-refunds";
import {
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  RETURN_STATUS_VALUES,
  RETURNS_PERMISSION,
} from "../returns-refunds.constants";
import type { ReturnRequest, SellerReturnListParams } from "../types/returns-refunds.types";

/** Renders one seller-scoped Return and only the explicit commands valid for its current status. */
function SellerReturnCard({ value }: { value: ReturnRequest }) {
  const approve = useApproveReturnMutation(value.id);
  const reject = useRejectReturnMutation(value.id);
  const receive = useReceiveReturnMutation(value.id);

  return (
    <article className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{value.returnNo}</h2>
          <p className="text-xs text-slate-500">Seller Order {value.sellerOrderId}</p>
          <p className="text-xs text-slate-500">Customer {value.customerUserId}</p>
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

      {value.status === "requested" ? (
        <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
          <ApproveReturnForm
            isPending={approve.isPending}
            error={approve.error}
            onSubmit={(input) => approve.mutateAsync(input).then(() => undefined)}
          />
          <RejectReturnForm
            isPending={reject.isPending}
            error={reject.error}
            onSubmit={(input) => reject.mutateAsync(input).then(() => undefined)}
          />
        </div>
      ) : null}

      {value.status === "approved" ? (
        <ReturnInspectionForm
          value={value}
          isPending={receive.isPending}
          error={receive.error}
          onSubmit={(input) => receive.mutateAsync(input).then(() => undefined)}
        />
      ) : null}
    </article>
  );
}

/** Renders the seller Return queue with bounded server-side filters and seller-scoped commands. */
function SellerReturnsContent() {
  const [params, setParams] = useState<SellerReturnListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const returns = useSellerReturnsQuery(params);

  if (returns.isPending) return <LoadingState label="Loading seller Returns..." />;
  if (returns.isError) {
    return (
      <ErrorState
        title="Seller Returns could not be loaded"
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
            <h1 className="text-2xl font-bold">Seller Return queue</h1>
            <p className="mt-1 text-sm text-slate-600">
              Approve/reject requests and record physical inspection. Seller/store scope is enforced by the API.
            </p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Seller Return status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as SellerReturnListParams["status"] : undefined,
              }))}
            >
              <option value="">All</option>
              {RETURN_STATUS_VALUES.map((value) => <option key={value} value={value}>{RETURN_STATUS_LABEL[value]}</option>)}
            </select>
          </label>
        </div>
      </section>

      {returns.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">No seller Returns found.</p>
      ) : returns.data.items.map((value) => <SellerReturnCard key={value.id} value={value} />)}

      <ReturnPagination meta={returns.data.meta} onPageChange={(page) => setParams((current) => ({ ...current, page }))} />
    </div>
  );
}

/** Protects seller Return management with the approved seller permission. */
export function SellerReturnsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={RETURNS_PERMISSION.SELLER_MANAGE}>
          <SellerReturnsContent />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { AdminLayout } from "@/features/administration/components/admin-layout";
import { RequirePagePermission } from "@/features/administration/components/permission-gate";
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { PayoutPagination } from "../components/payout-pagination";
import { PayoutReconciliation } from "../components/payout-reconciliation";
import { PayoutStatus } from "../components/payout-status";
import {
  useAdminPayoutsQuery,
  useApprovePayoutMutation,
  useSendPayoutMutation,
} from "../hooks/use-seller-wallet-payouts";
import {
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_VALUES,
  WALLET_PAYOUT_PERMISSION,
} from "../seller-wallet-payouts.constants";
import type { Payout } from "../schemas/seller-wallet-payouts.schemas";
import type { AdminPayoutListParams } from "../types/seller-wallet-payouts.types";

/** Renders finance commands for one Payout while preserving explicit server-owned lifecycle transitions. */
function FinancePayoutActions({ payout, canManage }: { payout: Payout; canManage: boolean }) {
  const approve = useApprovePayoutMutation(payout.id);
  const send = useSendPayoutMutation(payout.id);

  if (!canManage) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {payout.status === "requested" ? (
          <Button
            type="button"
            size="sm"
            disabled={approve.isPending}
            onClick={() => approve.mutate(crypto.randomUUID())}
          >
            {approve.isPending ? "Approving..." : "Approve & Reserve"}
          </Button>
        ) : null}
        {payout.status === "approved" || payout.status === "processing" ? (
          <Button
            type="button"
            size="sm"
            disabled={send.isPending}
            onClick={() => send.mutate(crypto.randomUUID())}
          >
            {send.isPending ? "Sending..." : payout.status === "processing" ? "Reconcile Provider" : "Send Payout"}
          </Button>
        ) : null}
      </div>
      <FormError error={approve.error ?? send.error} />
    </div>
  );
}

/** Renders the finance Payout queue, safe reconciliation evidence, and permission-gated approve/send commands. */
function AdminPayoutsContent({ canManage }: { canManage: boolean }) {
  const [params, setParams] = useState<AdminPayoutListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const payouts = useAdminPayoutsQuery(params);

  if (payouts.isPending) return <LoadingState label="Loading finance Payout queue..." />;
  if (payouts.isError) {
    return (
      <ErrorState
        title="Finance Payout queue could not be loaded"
        message={payouts.error instanceof Error ? payouts.error.message : "Please try again."}
        requestId={payouts.error instanceof ApiClientError ? payouts.error.requestId : undefined}
        onRetry={() => void payouts.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Finance payout queue</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Approval reserves available funds before provider execution. Unknown provider results remain
              processing instead of silently releasing money.
            </p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Admin payout status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as AdminPayoutListParams["status"] : undefined,
              }))}
            >
              <option value="">All</option>
              {PAYOUT_STATUS_VALUES.map((value) => <option key={value} value={value}>{PAYOUT_STATUS_LABEL[value]}</option>)}
            </select>
          </label>
        </div>
      </section>

      {payouts.data.items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-slate-500">No Payouts match the current finance filters.</p>
      ) : (
        <div className="space-y-4">
          {payouts.data.items.map((payout) => (
            <article key={payout.id} className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{payout.payoutNo}</h2>
                  <p className="text-sm">{payout.amount} {payout.currency}</p>
                  <p className="text-xs text-slate-500">Seller {payout.sellerId}</p>
                </div>
                <PayoutStatus value={payout.status} />
              </div>
              <PayoutReconciliation payout={payout} />
              <FinancePayoutActions payout={payout} canManage={canManage} />
            </article>
          ))}
        </div>
      )}

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <PayoutPagination
          meta={payouts.data.meta}
          label="Payouts"
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      </section>
    </div>
  );
}

/** Protects finance Payout reads and separately hides approval/send commands without the manage permission. */
export function AdminPayoutsPage() {
  return (
    <AdminLayout>
      {(user) => (
        <RequirePagePermission user={user} permission={WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ}>
          <AdminPayoutsContent canManage={user.permissions.includes(WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE)} />
        </RequirePagePermission>
      )}
    </AdminLayout>
  );
}

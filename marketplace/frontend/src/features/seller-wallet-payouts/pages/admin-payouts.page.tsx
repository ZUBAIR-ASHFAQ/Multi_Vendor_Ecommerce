import { useState } from "react";
import { ConfirmationDialog } from "@/components/feedback/confirmation-dialog";
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
import { FormError } from "@/features/auth/components/form-error";
import { ApiClientError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { useStableIdempotencyKey } from "@/lib/use-stable-idempotency-key";
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

/** Renders finance commands for one selected Payout while preserving server-owned lifecycle transitions. */
function FinancePayoutActions({ payout, canManage }: { payout: Payout; canManage: boolean }) {
  const [pendingAction, setPendingAction] = useState<"approve" | "send" | null>(null);
  const approve = useApprovePayoutMutation(payout.id);
  const send = useSendPayoutMutation(payout.id);
  const commandKey = useStableIdempotencyKey();

  /** Runs one finance command while retaining its key across failed retries. */
  const runPayoutCommand = (action: "approve" | "send"): void => {
    const fingerprint = `${payout.id}:${action}`;
    const idempotencyKey = commandKey.keyFor(fingerprint);
    const callbacks = {
      onSuccess: () => {
        commandKey.complete(fingerprint);
        setPendingAction(null);
      },
      onError: () => {
        // Keep the key so a retry after an uncertain provider/network failure replays safely.
        setPendingAction(null);
      },
    };

    if (action === "approve") {
      approve.mutate(idempotencyKey, callbacks);
    } else {
      send.mutate(idempotencyKey, callbacks);
    }
  };

  if (!canManage) return null;

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2">
        {payout.status === "requested" ? (
          <Button
            type="button"
            size="sm"
            disabled={approve.isPending}
            onClick={() => setPendingAction("approve")}
          >
            {approve.isPending ? "Approving..." : "Approve & reserve"}
          </Button>
        ) : null}
        {payout.status === "approved" || payout.status === "processing" ? (
          <Button
            type="button"
            size="sm"
            disabled={send.isPending}
            onClick={() => {
              if (payout.status === "processing") {
                runPayoutCommand("send");
                return;
              }
              setPendingAction("send");
            }}
          >
            {send.isPending ? "Sending..." : payout.status === "processing" ? "Reconcile provider" : "Send payout"}
          </Button>
        ) : null}
      </div>
      <FormError error={approve.error ?? send.error} />
      <ConfirmationDialog
        open={pendingAction !== null}
        title={pendingAction === "send" ? "Send this payout?" : "Approve this payout?"}
        description={pendingAction === "send"
          ? "Sending starts the provider payout flow for the reserved amount. Confirm the payout record and reconciliation evidence before continuing."
          : "Approval reserves the seller balance for this payout. Confirm the request before moving it into the finance processing flow."}
        confirmLabel={pendingAction === "send" ? "Confirm payout send" : "Confirm payout approval"}
        destructive={pendingAction === "send"}
        isPending={approve.isPending || send.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction === "approve") {
            runPayoutCommand("approve");
          } else if (pendingAction === "send") {
            runPayoutCommand("send");
          }
        }}
      />
    </div>
  );
}

/** Renders the selected payout review panel and permitted actions. */
function AdminPayoutDetail({ payout, canManage }: { payout: Payout; canManage: boolean }) {
  return (
    <Surface variant="elevated" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground-muted">Selected payout</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">{payout.payoutNo}</h2>
          <p className="mt-1 text-sm text-foreground-muted">{formatMoney(payout.amount, payout.currency)} · Seller {payout.sellerId}</p>
        </div>
        <PayoutStatus value={payout.status} />
      </div>
      <PayoutReconciliation payout={payout} />
      <FinancePayoutActions payout={payout} canManage={canManage} />
    </Surface>
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
  const [sellerId, setSellerId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const payouts = useAdminPayoutsQuery(params);
  const selected = payouts.data?.items.find((payout) => payout.id === selectedId);

  return (
    <div className="space-y-5">
      <AdminQueueHeader
        eyebrow="Finance · Payouts"
        title="Payout operations queue"
        description="Review payout state and reconciliation evidence before running the permission-gated approve, send, or provider-reconciliation commands."
        meta={payouts.data?.meta}
        visibleCount={payouts.data?.items.length}
      />

      <form
        className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-sm sm:grid-cols-[minmax(220px,1fr)_minmax(180px,240px)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedId(null);
          setParams((current) => ({ ...current, page: 1, sellerId: sellerId.trim() || undefined }));
        }}
      >
        <label className="text-sm font-medium text-foreground">
          Seller ID
          <Input
            aria-label="Admin payout seller filter"
            className="mt-1 font-mono"
            placeholder="Exact seller UUID"
            value={sellerId}
            onChange={(event) => setSellerId(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Status
          <Select
            aria-label="Admin payout status filter"
            className="mt-1"
            value={params.status ?? ""}
            onChange={(event) => {
              setSelectedId(null);
              setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as AdminPayoutListParams["status"] : undefined,
              }));
            }}
          >
            <option value="">All statuses</option>
            {PAYOUT_STATUS_VALUES.map((value) => <option key={value} value={value}>{PAYOUT_STATUS_LABEL[value]}</option>)}
          </Select>
        </label>
        <div className="flex items-end"><Button className="w-full sm:w-auto" type="submit">Apply filters</Button></div>
      </form>

      {payouts.isPending ? <LoadingState variant="table" label="Loading finance payout queue..." /> : null}
      {payouts.isError ? (
        <ErrorState
          title="Finance payout queue could not be loaded"
          message={payouts.error instanceof Error ? payouts.error.message : "Please try again."}
          requestId={payouts.error instanceof ApiClientError ? payouts.error.requestId : undefined}
          onRetry={() => void payouts.refetch()}
        />
      ) : null}

      {payouts.data?.items.length === 0 ? (
        <AdminQueueEmpty
          title="No payouts match these finance filters"
          description="Change the payout status or exact seller ID to inspect another part of the queue."
        />
      ) : null}

      {payouts.data?.items.length ? (
        <AdminQueueTable tableClassName="min-w-[940px]">
          <AdminQueueTableHead>
            <tr>
              <th className="px-4 py-3">Payout</th>
              <th className="px-4 py-3">Seller</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Provider ref</th>
              <th className="px-4 py-3 text-right">Primary action</th>
            </tr>
          </AdminQueueTableHead>
          <tbody className="divide-y divide-border">
            {payouts.data.items.map((payout) => (
              <tr key={payout.id} className="transition-colors hover:bg-surface-muted/60">
                <td className="px-4 py-3 font-medium text-foreground">{payout.payoutNo}</td>
                <td className="px-4 py-3 break-all text-xs text-foreground-muted">{payout.sellerId}</td>
                <td className="px-4 py-3 whitespace-nowrap font-medium">{formatMoney(payout.amount, payout.currency)}</td>
                <td className="px-4 py-3"><PayoutStatus value={payout.status} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">{formatDateTime(payout.requestedAt)}</td>
                <td className="px-4 py-3 max-w-[220px] truncate text-xs text-foreground-muted">{payout.providerRef ?? "Not available"}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedId === payout.id ? "secondary" : "outline"}
                    onClick={() => setSelectedId((current) => current === payout.id ? null : payout.id)}
                  >
                    {selectedId === payout.id ? "Close detail" : "Review"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminQueueTable>
      ) : null}

      {selected ? <AdminPayoutDetail payout={selected} canManage={canManage} /> : null}

      {payouts.data ? (
        <PayoutPagination
          meta={payouts.data.meta}
          label="Payouts"
          onPageChange={(page) => {
            setSelectedId(null);
            setParams((current) => ({ ...current, page }));
          }}
        />
      ) : null}
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

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { PayoutPagination } from "../components/payout-pagination";
import { PayoutReconciliation } from "../components/payout-reconciliation";
import { PayoutStatus } from "../components/payout-status";
import { PayoutRequestForm } from "../forms/payout-request.form";
import {
  useRequestPayoutMutation,
  useSellerPayoutsQuery,
  useSellerWalletQuery,
} from "../hooks/use-seller-wallet-payouts";
import {
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_VALUES,
  WALLET_PAYOUT_PERMISSION,
} from "../seller-wallet-payouts.constants";
import type { SellerPayoutListParams } from "../types/seller-wallet-payouts.types";

/** Renders seller Payout history plus the optional request form using only server-returned account/balance facts. */
function SellerPayoutsContent({ canRequest }: { canRequest: boolean }) {
  const [params, setParams] = useState<SellerPayoutListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const payouts = useSellerPayoutsQuery(params);
  const wallet = useSellerWalletQuery({ page: 1, pageSize: 1, sort: "occurredAt", order: "desc" }, canRequest);
  const requestPayout = useRequestPayoutMutation();

  if (payouts.isPending || (canRequest && wallet.isPending)) return <LoadingState label="Loading seller Payouts..." />;
  if (payouts.isError) {
    return (
      <ErrorState
        title="Seller Payouts could not be loaded"
        message={payouts.error instanceof Error ? payouts.error.message : "Please try again."}
        requestId={payouts.error instanceof ApiClientError ? payouts.error.requestId : undefined}
        onRetry={() => void payouts.refetch()}
      />
    );
  }
  if (canRequest && wallet.isError) {
    return (
      <ErrorState
        title="Payout request details could not be loaded"
        message={wallet.error instanceof Error ? wallet.error.message : "Please try again."}
        requestId={wallet.error instanceof ApiClientError ? wallet.error.requestId : undefined}
        onRetry={() => void wallet.refetch()}
      />
    );
  }

  const walletData = wallet.data?.wallet;
  const defaultCurrency = walletData?.wallets[0]?.currency ?? "USD";

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Seller payouts</h1>
            <p className="mt-1 text-sm text-slate-600">
              Payout requests use the server-authoritative available balance and never derive from Order totals in
              the browser.
            </p>
          </div>
          <Button asChild variant="outline"><Link to="/seller/wallet">Wallet & ledger</Link></Button>
        </div>
      </section>

      {canRequest && walletData ? (
        <PayoutRequestForm
          accounts={walletData.payoutAccounts}
          defaultCurrency={defaultCurrency}
          isPending={requestPayout.isPending}
          error={requestPayout.error}
          onSubmit={(input, idempotencyKey) => requestPayout.mutateAsync({ input, idempotencyKey }).then(() => undefined)}
        />
      ) : null}

      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Payout history</h2>
            <p className="text-xs text-slate-500">Paid and failed history is immutable; later refunds appear as new Wallet adjustments.</p>
          </div>
          <label className="text-sm font-medium">
            Status
            <select
              aria-label="Seller payout status filter"
              className="ml-2 rounded-md border px-3 py-2"
              value={params.status ?? ""}
              onChange={(event) => setParams((current) => ({
                ...current,
                page: 1,
                status: event.target.value ? event.target.value as SellerPayoutListParams["status"] : undefined,
              }))}
            >
              <option value="">All</option>
              {PAYOUT_STATUS_VALUES.map((value) => <option key={value} value={value}>{PAYOUT_STATUS_LABEL[value]}</option>)}
            </select>
          </label>
        </div>

        {payouts.data.items.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No Payouts found.</p>
        ) : (
          <div className="space-y-4">
            {payouts.data.items.map((payout) => (
              <article key={payout.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{payout.payoutNo}</h3>
                    <p className="text-sm">{payout.amount} {payout.currency}</p>
                    <p className="text-xs text-slate-500">Requested {new Date(payout.requestedAt).toLocaleString()}</p>
                  </div>
                  <PayoutStatus value={payout.status} />
                </div>
                <PayoutReconciliation payout={payout} />
              </article>
            ))}
          </div>
        )}
        <PayoutPagination
          meta={payouts.data.meta}
          label="Payouts"
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      </section>
    </div>
  );
}

/** Protects seller Payout history with Wallet-read permission and hides request controls without request permission. */
export function SellerPayoutsPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ}>
          <SellerPayoutsContent canRequest={user.permissions.includes(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST)} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

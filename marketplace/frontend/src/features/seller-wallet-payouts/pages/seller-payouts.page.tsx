import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { formatMoney } from "@/lib/money";
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
import type { Payout } from "../schemas/seller-wallet-payouts.schemas";
import type { SellerPayoutListParams } from "../types/seller-wallet-payouts.types";

/** Explains the current server-owned payout lifecycle state without promising a completion date. */
function payoutStatusDescription(status: Payout["status"]): string {
  switch (status) {
    case "requested":
      return "Request received and waiting for finance approval.";
    case "approved":
      return "Funds are reserved in the Wallet and ready for provider processing.";
    case "processing":
      return "The provider operation is in progress or awaiting reconciliation.";
    case "paid":
      return "Provider processing completed and the payout is recorded as paid.";
    case "failed":
      return "Provider processing failed; any release or adjustment remains ledger-driven.";
  }
}

/** Renders seller Payout history plus the optional request form using only server-returned account/balance facts. */
function SellerPayoutsContent({ canRequest }: { canRequest: boolean }) {
  const [params, setParams] = useState<SellerPayoutListParams>({
    page: 1,
    pageSize: 20,
    sort: "requestedAt",
    order: "desc",
  });
  const payouts = useSellerPayoutsQuery(params);
  const wallet = useSellerWalletQuery({ page: 1, pageSize: 1, sort: "occurredAt", order: "desc" });
  const requestPayout = useRequestPayoutMutation();

  if (payouts.isPending || wallet.isPending) return <LoadingState label="Loading seller Payouts..." />;
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
  if (wallet.isError) {
    return (
      <ErrorState
        title="Payout finance summary could not be loaded"
        message={wallet.error instanceof Error ? wallet.error.message : "Please try again."}
        requestId={wallet.error instanceof ApiClientError ? wallet.error.requestId : undefined}
        onRetry={() => void wallet.refetch()}
      />
    );
  }

  const walletData = wallet.data.wallet;
  const defaultCurrency = walletData.wallets[0]?.currency ?? "USD";
  const summaryByCurrency = new Map(walletData.payoutSummaries.map((summary) => [summary.currency, summary]));
  const accountById = new Map(walletData.payoutAccounts.map((account) => [account.id, account]));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Seller payouts</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Request funds from the server-authoritative available balance and track every provider-controlled payout state.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/seller/commissions">Commission statement</Link></Button>
            <Button asChild variant="outline"><Link to="/seller/wallet">Wallet & ledger</Link></Button>
          </div>
        </div>
      </section>

      {walletData.wallets.length > 0 ? (
        <section className="space-y-3" aria-label="Payout finance summary">
          {walletData.wallets.map((balance) => {
            const summary = summaryByCurrency.get(balance.currency);
            return (
              <div key={`${balance.sellerId}-${balance.currency}`} className="grid gap-3 md:grid-cols-3">
                <StatCard
                  label={`${balance.currency} available`}
                  value={formatMoney(balance.availableBalance, balance.currency)}
                  meta="Current Wallet amount eligible for a payout request, subject to server validation."
                />
                <StatCard
                  label="In progress"
                  value={formatMoney(summary?.inProgressAmount ?? "0.0000", balance.currency)}
                  meta={summary?.inProgressCount ? `${summary.inProgressCount} requested, approved, or processing payout(s).` : "No active payouts."}
                />
                <StatCard
                  label="Lifetime paid"
                  value={formatMoney(summary?.lifetimePaidAmount ?? "0.0000", balance.currency)}
                  meta="Completed payouts only; failed requests are not counted."
                />
              </div>
            );
          })}
        </section>
      ) : null}

      {canRequest ? (
        <PayoutRequestForm
          accounts={walletData.payoutAccounts}
          defaultCurrency={defaultCurrency}
          isPending={requestPayout.isPending}
          error={requestPayout.error}
          onSubmit={(input, idempotencyKey) => requestPayout.mutateAsync({ input, idempotencyKey }).then(() => undefined)}
        />
      ) : (
        <p className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
          Your role can review payout history but cannot submit new payout requests.
        </p>
      )}

      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Payout history</h2>
            <p className="text-xs text-slate-500">Paid and failed history is immutable; later refunds appear as new Wallet adjustments.</p>
          </div>
          <label className="flex w-full flex-col gap-2 text-sm font-medium sm:w-auto sm:flex-row sm:items-center">
            Status
            <select
              aria-label="Seller payout status filter"
              className="w-full rounded-md border px-3 py-2 sm:ml-2 sm:w-auto"
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
          <div className="space-y-3">
            {payouts.data.items.map((payout) => {
              const account = accountById.get(payout.accountId);
              return (
                <article key={payout.id} className="rounded-xl border p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{payout.payoutNo}</h3>
                        <PayoutStatus value={payout.status} />
                      </div>
                      <p className="mt-2 text-2xl font-semibold">{formatMoney(payout.amount, payout.currency)}</p>
                      <p className="mt-1 text-sm text-slate-600">{payoutStatusDescription(payout.status)}</p>
                      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        <div>
                          <dt className="text-xs text-slate-500">Requested</dt>
                          <dd>{new Date(payout.requestedAt).toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Processed</dt>
                          <dd>{payout.processedAt ? new Date(payout.processedAt).toLocaleString() : "Not yet"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Destination</dt>
                          <dd>{account ? `${account.providerType} · ${account.maskedDetails}` : "Saved payout account"}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  <details className="mt-4 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">Reconciliation detail</summary>
                    <div className="mt-3"><PayoutReconciliation payout={payout} /></div>
                  </details>
                </article>
              );
            })}
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

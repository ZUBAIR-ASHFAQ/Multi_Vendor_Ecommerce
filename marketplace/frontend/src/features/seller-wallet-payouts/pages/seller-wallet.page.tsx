import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  RequireSellerPermission,
  SellerLayout,
} from "@/features/sellers/components/seller-layout";
import { ApiClientError } from "@/lib/api-error";
import { PayoutPagination } from "../components/payout-pagination";
import { WalletLedgerTable } from "../components/wallet-ledger-table";
import { WalletSummary } from "../components/wallet-summary";
import { PayoutAccountForm } from "../forms/payout-account.form";
import {
  useCreatePayoutAccountMutation,
  useSellerWalletQuery,
} from "../hooks/use-seller-wallet-payouts";
import {
  WALLET_BALANCE_BUCKET_LABEL,
  WALLET_BALANCE_BUCKET_VALUES,
  WALLET_ENTRY_TYPE_LABEL,
  WALLET_ENTRY_TYPE_VALUES,
  WALLET_PAYOUT_PERMISSION,
} from "../seller-wallet-payouts.constants";
import type { SellerWalletParams } from "../types/seller-wallet-payouts.types";

/** Renders the seller Wallet summary, immutable ledger, safe payout accounts, and optional account setup form. */
function SellerWalletContent({ canManageAccounts }: { canManageAccounts: boolean }) {
  const [params, setParams] = useState<SellerWalletParams>({
    page: 1,
    pageSize: 20,
    sort: "occurredAt",
    order: "desc",
  });
  const wallet = useSellerWalletQuery(params);
  const createAccount = useCreatePayoutAccountMutation();

  if (wallet.isPending) return <LoadingState label="Loading seller Wallet..." />;
  if (wallet.isError) {
    return (
      <ErrorState
        title="Seller Wallet could not be loaded"
        message={wallet.error instanceof Error ? wallet.error.message : "Please try again."}
        requestId={wallet.error instanceof ApiClientError ? wallet.error.requestId : undefined}
        onRetry={() => void wallet.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace Finance</p>
            <h1 className="mt-1 text-2xl font-bold">Seller wallet</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Pending, available, held, and negative balances remain separate. Ledger entries are immutable and
              seller scope is enforced by the API.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/seller/commissions">Commission statement</Link></Button>
            <Button asChild><Link to="/seller/payouts">Manage payouts</Link></Button>
          </div>
        </div>
      </section>

      <WalletSummary
        wallets={wallet.data.wallet.wallets}
        payoutSummaries={wallet.data.wallet.payoutSummaries}
      />

      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Wallet ledger</h2>
            <p className="text-xs text-slate-500">
              Commission credits, adjustments, availability transfers, reservations, releases, and paid history are
              shown as separate entries.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="text-sm font-medium">
              Entry type
              <select
                aria-label="Wallet entry type filter"
                className="ml-2 rounded-md border px-3 py-2"
                value={params.entryType ?? ""}
                onChange={(event) => setParams((current) => ({
                  ...current,
                  page: 1,
                  entryType: event.target.value ? event.target.value as SellerWalletParams["entryType"] : undefined,
                }))}
              >
                <option value="">All</option>
                {WALLET_ENTRY_TYPE_VALUES.map((value) => <option key={value} value={value}>{WALLET_ENTRY_TYPE_LABEL[value]}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Bucket
              <select
                aria-label="Wallet bucket filter"
                className="ml-2 rounded-md border px-3 py-2"
                value={params.balanceBucket ?? ""}
                onChange={(event) => setParams((current) => ({
                  ...current,
                  page: 1,
                  balanceBucket: event.target.value ? event.target.value as SellerWalletParams["balanceBucket"] : undefined,
                }))}
              >
                <option value="">All</option>
                {WALLET_BALANCE_BUCKET_VALUES.map((value) => (
                  <option key={value} value={value}>{WALLET_BALANCE_BUCKET_LABEL[value]}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <WalletLedgerTable entries={wallet.data.wallet.entries} />
        <PayoutPagination
          meta={wallet.data.meta}
          label="ledger entries"
          onPageChange={(page) => setParams((current) => ({ ...current, page }))}
        />
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Payout methods</h2>
            <p className="mt-1 text-xs text-slate-500">Only provider type, safe masked details, status, and verification time are displayed.</p>
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/seller/payouts">Request payout</Link></Button>
        </div>
        {wallet.data.wallet.payoutAccounts.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No payout accounts are configured.</p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {wallet.data.wallet.payoutAccounts.map((account) => (
              <li key={account.id} className="rounded-lg border p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{account.providerType}</span>
                  <StatusPill tone={account.status === "active" ? "positive" : "neutral"}>{account.status === "active" ? "Active" : "Disabled"}</StatusPill>
                </div>
                <p className="mt-2">{account.maskedDetails}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {account.verifiedAt
                    ? `Verified ${new Date(account.verifiedAt).toLocaleString()}`
                    : "Not verified"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageAccounts ? (
        <PayoutAccountForm
          isPending={createAccount.isPending}
          error={createAccount.error}
          onSubmit={(input) => createAccount.mutateAsync(input).then(() => undefined)}
        />
      ) : null}
    </div>
  );
}

/** Protects the seller Wallet page with the approved Wallet-read permission and gates account setup separately. */
export function SellerWalletPage() {
  return (
    <SellerLayout>
      {(user) => (
        <RequireSellerPermission user={user} permission={WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ}>
          <SellerWalletContent canManageAccounts={user.permissions.includes(WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE)} />
        </RequireSellerPermission>
      )}
    </SellerLayout>
  );
}

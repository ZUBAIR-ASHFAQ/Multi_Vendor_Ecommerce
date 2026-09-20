import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { useSellerWalletQuery } from "@/features/seller-wallet-payouts/hooks/use-seller-wallet-payouts";
import { formatMoney } from "@/lib/money";

/** Renders a compact seller-finance snapshot from the existing Wallet projection. */
export function DashboardSellerWalletSummary({ enabled }: { enabled: boolean }) {
  const wallet = useSellerWalletQuery({
    page: 1,
    pageSize: 1,
    sort: "occurredAt",
    order: "desc",
  }, enabled);

  if (!enabled) return null;

  return (
    <section className="dashboard-panel space-y-4" aria-labelledby="dashboard-wallet-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Finance</p>
          <h2 id="dashboard-wallet-title" className="mt-1 text-xl font-semibold">Wallet snapshot</h2>
          <p className="mt-1 text-sm text-foreground-muted">Server-authoritative balances available for settlement.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/seller/wallet">Open wallet</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/seller/payouts">Payouts</Link></Button>
        </div>
      </div>

      {wallet.isPending ? <LoadingState label="Loading Wallet snapshot..." /> : null}
      {wallet.isError ? (
        <ErrorState
          title="Wallet snapshot could not be loaded"
          message={wallet.error instanceof Error ? wallet.error.message : "Please try again."}
          onRetry={() => void wallet.refetch()}
        />
      ) : null}

      {wallet.data && wallet.data.wallet.wallets.length === 0 ? (
        <p className="rounded-control bg-surface-muted p-4 text-sm text-foreground-muted">No Wallet balance has been created yet.</p>
      ) : null}

      {wallet.data && wallet.data.wallet.wallets.length > 0 ? (
        <div className="space-y-4">
          {wallet.data.wallet.wallets.map((balance) => (
            <div key={`${balance.sellerId}-${balance.currency}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`${balance.currency} available`}
                value={formatMoney(balance.availableBalance, balance.currency)}
                meta="Eligible for payout subject to payout rules."
              />
              <StatCard
                label={`${balance.currency} pending`}
                value={formatMoney(balance.pendingBalance, balance.currency)}
                meta="Not available for payout yet."
              />
              <StatCard
                label={`${balance.currency} held`}
                value={formatMoney(balance.heldBalance, balance.currency)}
                meta="Reserved or otherwise held by the ledger."
              />
              <StatCard
                label={`${balance.currency} negative`}
                value={formatMoney(balance.negativeBalance, balance.currency)}
                meta="Debt or recovery balance tracked by the ledger."
              />
            </div>
          ))}
          <p className="text-xs text-foreground-muted">
            {wallet.data.wallet.payoutAccounts.filter((account) => account.status === "active").length} active payout account(s).
          </p>
        </div>
      ) : null}
    </section>
  );
}

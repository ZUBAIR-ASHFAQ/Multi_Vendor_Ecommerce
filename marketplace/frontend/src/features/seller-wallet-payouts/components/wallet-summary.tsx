import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/money";
import type {
  SellerPayoutSummary,
  SellerWalletBalance,
} from "../schemas/seller-wallet-payouts.schemas";

/** Renders per-currency Wallet and Payout facts without combining unrelated currencies. */
export function WalletSummary({
  wallets,
  payoutSummaries,
}: {
  wallets: SellerWalletBalance[];
  payoutSummaries: SellerPayoutSummary[];
}) {
  if (wallets.length === 0) {
    return (
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Wallet balances</h2>
        <p className="mt-2 text-sm text-slate-500">No Wallet balance has been created for this seller yet.</p>
      </section>
    );
  }

  const payoutByCurrency = new Map(payoutSummaries.map((summary) => [summary.currency, summary]));

  return (
    <div className="space-y-4">
      {wallets.map((wallet) => {
        const payout = payoutByCurrency.get(wallet.currency);
        return (
          <section key={`${wallet.sellerId}-${wallet.currency}`} className="space-y-3" aria-label={`${wallet.currency} finance overview`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{wallet.currency} finance overview</h2>
                <p className="text-xs text-slate-500">Updated {new Date(wallet.updatedAt).toLocaleString()}</p>
              </div>
              {payout?.inProgressCount ? (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                  {payout.inProgressCount} payout{payout.inProgressCount === 1 ? "" : "s"} in progress
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard
                label="Available"
                value={formatMoney(wallet.availableBalance, wallet.currency)}
                meta="Eligible to request, subject to payout validation."
              />
              <StatCard
                label="Pending"
                value={formatMoney(wallet.pendingBalance, wallet.currency)}
                meta="Earnings still inside the settlement hold period."
              />
              <StatCard
                label="Lifetime paid"
                value={formatMoney(payout?.lifetimePaidAmount ?? "0.0000", wallet.currency)}
                meta="Authoritative total from completed payouts."
              />
              <StatCard
                label="Payouts in progress"
                value={formatMoney(payout?.inProgressAmount ?? "0.0000", wallet.currency)}
                meta={payout?.inProgressCount ? `${payout.inProgressCount} active payout request(s).` : "No active payout requests."}
              />
              <StatCard
                label="Held"
                value={formatMoney(wallet.heldBalance, wallet.currency)}
                meta="Reserved funds, including approved payout reservations."
              />
              <StatCard
                label="Negative"
                value={formatMoney(wallet.negativeBalance, wallet.currency)}
                meta="Recovery balance tracked separately from available funds."
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

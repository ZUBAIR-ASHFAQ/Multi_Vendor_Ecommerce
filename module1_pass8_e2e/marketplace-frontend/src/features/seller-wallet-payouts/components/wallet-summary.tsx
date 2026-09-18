import type { SellerWalletBalance } from "../schemas/seller-wallet-payouts.schemas";

/** Formats one exact decimal string for display without converting it to floating point. */
function money(value: string, currency: string): string {
  return `${value} ${currency}`;
}

/** Renders the four financially distinct Wallet buckets without combining them into one misleading balance. */
export function WalletSummary({ wallets }: { wallets: SellerWalletBalance[] }) {
  if (wallets.length === 0) {
    return (
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Wallet balances</h2>
        <p className="mt-2 text-sm text-slate-500">No Wallet balance has been created for this seller yet.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {wallets.map((wallet) => (
        <section key={`${wallet.sellerId}-${wallet.currency}`} className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{wallet.currency} Wallet</h2>
            <span className="text-xs text-slate-500">Updated {new Date(wallet.updatedAt).toLocaleString()}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-slate-500">Pending</dt>
              <dd className="mt-1 font-semibold">{money(wallet.pendingBalance, wallet.currency)}</dd>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <dt className="text-emerald-700">Available</dt>
              <dd className="mt-1 font-semibold text-emerald-950">{money(wallet.availableBalance, wallet.currency)}</dd>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <dt className="text-amber-700">Held</dt>
              <dd className="mt-1 font-semibold text-amber-950">{money(wallet.heldBalance, wallet.currency)}</dd>
            </div>
            <div className="rounded-lg bg-rose-50 p-3">
              <dt className="text-rose-700">Negative</dt>
              <dd className="mt-1 font-semibold text-rose-950">{money(wallet.negativeBalance, wallet.currency)}</dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}

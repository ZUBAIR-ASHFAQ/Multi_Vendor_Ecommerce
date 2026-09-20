import type { Payout } from "../schemas/seller-wallet-payouts.schemas";

/** Displays safe Payout reconciliation evidence already returned by the approved list API. */
export function PayoutReconciliation({ payout }: { payout: Payout }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-sm">
      <h3 className="font-semibold">Payout reconciliation detail</h3>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Payout ID</dt><dd className="break-all">{payout.id}</dd></div>
        <div><dt className="text-xs text-slate-500">Account ID</dt><dd className="break-all">{payout.accountId}</dd></div>
        <div><dt className="text-xs text-slate-500">Requested</dt><dd>{new Date(payout.requestedAt).toLocaleString()}</dd></div>
        <div>
          <dt className="text-xs text-slate-500">Processed</dt>
          <dd>{payout.processedAt ? new Date(payout.processedAt).toLocaleString() : "Not processed"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Provider reference</dt>
          <dd>{payout.providerRef ?? "Not available"}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallet allocations</h4>
        {payout.allocations.length === 0 ? (
          <p className="mt-2 text-slate-500">No reservation allocations are recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {payout.allocations.map((allocation) => (
              <li key={allocation.walletEntryId} className="rounded-md border bg-white p-2">
                <span className="break-all text-xs text-slate-500">{allocation.walletEntryId}</span>
                <span className="ml-2 font-mono">{allocation.amount} {payout.currency}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

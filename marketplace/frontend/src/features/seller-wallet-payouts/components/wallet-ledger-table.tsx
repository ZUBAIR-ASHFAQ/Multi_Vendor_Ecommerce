import { formatMoney } from "@/lib/money";
import {
  WALLET_BALANCE_BUCKET_LABEL,
  WALLET_ENTRY_TYPE_LABEL,
} from "../seller-wallet-payouts.constants";
import type { SellerWalletEntry } from "../schemas/seller-wallet-payouts.schemas";

/** Converts one internal source type into a concise seller-facing ledger reference. */
function sourceLabel(entry: SellerWalletEntry): string {
  const label = entry.sourceType.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return `${label} · ${entry.sourceId.slice(0, 8)}…`;
}

/** Renders immutable Wallet history while intentionally excluding server-private deterministic source keys. */
export function WalletLedgerTable({ entries }: { entries: SellerWalletEntry[] }) {
  if (entries.length === 0) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No Wallet ledger entries match these filters.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Activity</th>
            <th className="px-3 py-2">Balance</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2">Reference</th>
          </tr>
        </thead>
        <tbody className="divide-y bg-white">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(entry.occurredAt).toLocaleString()}</td>
              <td className="px-3 py-3 font-medium">{WALLET_ENTRY_TYPE_LABEL[entry.type]}</td>
              <td className="px-3 py-3">{WALLET_BALANCE_BUCKET_LABEL[entry.balanceBucket]}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{formatMoney(entry.amount, entry.currency)}</td>
              <td className="px-3 py-3 text-xs text-slate-500" title={`${entry.sourceType} · ${entry.sourceId}`}>{sourceLabel(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

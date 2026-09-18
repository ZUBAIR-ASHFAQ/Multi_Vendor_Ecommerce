import type { CommissionEntry } from "../schemas/commissions.schemas";
import { CommissionEntryTable } from "./commission-entry-table";

/** Groups already-authorized Commission entries into a readable per-Seller-Order breakdown. */
export function OrderCommissionBreakdown({ entries }: { entries: CommissionEntry[] }) {
  const groups = new Map<string, CommissionEntry[]>();
  for (const entry of entries) {
    const current = groups.get(entry.sellerOrderId) ?? [];
    current.push(entry);
    groups.set(entry.sellerOrderId, current);
  }

  if (groups.size === 0) return null;

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold">Per-order Commission breakdown</h2>
        <p className="mt-1 text-sm text-slate-600">
          Each row is immutable ledger history. Refunds and corrections are separate entries rather than edits to the original sale.
        </p>
      </div>
      {[...groups.entries()].map(([sellerOrderId, orderEntries]) => (
        <div key={sellerOrderId} className="rounded-lg border p-4">
          <h3 className="font-semibold break-all">Seller Order {sellerOrderId}</h3>
          <div className="mt-3">
            <CommissionEntryTable entries={orderEntries} />
          </div>
        </div>
      ))}
    </section>
  );
}

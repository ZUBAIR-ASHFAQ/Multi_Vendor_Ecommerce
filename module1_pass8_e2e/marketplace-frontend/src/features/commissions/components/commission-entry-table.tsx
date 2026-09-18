import type { CommissionEntry } from "../schemas/commissions.schemas";

/** Formats an ISO timestamp for concise Commission ledger display. */
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Renders immutable Commission entries without offering edit/delete finance actions. */
export function CommissionEntryTable({
  entries,
  showSeller = false,
}: {
  entries: CommissionEntry[];
  showSeller?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No Commission entries found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-slate-500">
            <th className="py-2">Occurred</th>
            {showSeller ? <th>Seller</th> : null}
            <th>Seller order</th>
            <th>Type</th>
            <th>Gross</th>
            <th>Commission</th>
            <th>Seller net</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b align-top">
              <td className="py-3 whitespace-nowrap">{formatDateTime(entry.occurredAt)}</td>
              {showSeller ? <td className="break-all">{entry.sellerId}</td> : null}
              <td className="break-all">{entry.sellerOrderId}</td>
              <td className="capitalize">{entry.type}</td>
              <td>{entry.grossAmount} {entry.currency}</td>
              <td>{entry.commissionAmount} {entry.currency}</td>
              <td>{entry.sellerNetAmount} {entry.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

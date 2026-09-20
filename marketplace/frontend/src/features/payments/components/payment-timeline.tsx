import type { PaymentTransaction } from "../types/payments.types";

/** Formats one transaction type for a readable finance timeline label. */
function transactionLabel(type: PaymentTransaction["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Renders append-only Payment transactions and exposes provider refund references without refund controls. */
export function PaymentTimeline({
  transactions,
  currency,
}: {
  transactions: PaymentTransaction[];
  currency: string;
}) {
  if (transactions.length === 0) {
    return <p className="text-sm text-slate-500">No Payment transactions have been recorded yet.</p>;
  }

  return (
    <ol className="space-y-3" aria-label="Payment transaction timeline">
      {transactions.map((transaction) => (
        <li key={transaction.id} className="rounded-lg border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{transactionLabel(transaction.type)}</p>
              <p className="text-slate-600">{transaction.amount} {currency}</p>
            </div>
            <div className="text-right">
              <p className="font-medium">{transaction.status}</p>
              <p className="text-xs text-slate-500">{new Date(transaction.occurredAt).toLocaleString()}</p>
            </div>
          </div>
          {transaction.providerTxnId ? (
            <p className="mt-2 break-all text-xs text-slate-600">
              <span className="font-semibold">
                {transaction.type === "refund" ? "Refund reference:" : "Provider reference:"}
              </span>{" "}
              {transaction.providerTxnId}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

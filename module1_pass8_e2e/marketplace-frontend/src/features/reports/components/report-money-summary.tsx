import { formatMoney } from "@/lib/money";

interface MoneyAmount {
  currency: string;
  amount: string;
}

/** Displays exact API money strings by currency without doing browser-side financial arithmetic. */
export function ReportMoneySummary({
  title,
  amounts,
}: {
  title: string;
  amounts: MoneyAmount[];
}) {
  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      {amounts.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">No finalized amount in this scope.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {amounts.map((item) => (
            <p key={item.currency} className="font-semibold">
              {formatMoney(item.amount, item.currency)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

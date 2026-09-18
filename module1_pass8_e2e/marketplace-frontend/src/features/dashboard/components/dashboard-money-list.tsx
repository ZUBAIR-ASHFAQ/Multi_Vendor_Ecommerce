import { formatMoney } from "@/lib/money";

interface DashboardMoneyAmount {
  currency: string;
  amount: string;
}

/** Displays exact API money strings by currency without browser-side financial arithmetic. */
export function DashboardMoneyList({ amounts }: { amounts: DashboardMoneyAmount[] }) {
  if (amounts.length === 0) return <span className="text-sm text-slate-500">No finalized amount</span>;
  return (
    <div className="space-y-1">
      {amounts.map((item) => (
        <div key={item.currency} className="font-semibold">{formatMoney(item.amount, item.currency)}</div>
      ))}
    </div>
  );
}

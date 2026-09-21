import { Surface } from "@/components/ui/surface";
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
    <Surface className="h-full">
      <p className="text-sm font-medium text-foreground-muted">{title}</p>
      {amounts.length === 0 ? (
        <p className="mt-2 text-sm text-foreground-muted">No finalized amount in this scope.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {amounts.map((item) => (
            <p key={item.currency} className="text-2xl font-semibold tracking-tight text-foreground">
              {formatMoney(item.amount, item.currency)}
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs leading-5 text-foreground-muted">Server-authoritative amount by currency</p>
    </Surface>
  );
}

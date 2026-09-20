import { PAYOUT_STATUS_LABEL } from "../seller-wallet-payouts.constants";
import type { Payout } from "../schemas/seller-wallet-payouts.schemas";

/** Shows the server-owned Payout lifecycle state without implying a browser-controlled transition. */
export function PayoutStatus({ value }: { value: Payout["status"] }) {
  const className = value === "paid"
    ? "bg-emerald-100 text-emerald-800"
    : value === "failed"
      ? "bg-rose-100 text-rose-800"
      : value === "processing"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{PAYOUT_STATUS_LABEL[value]}</span>;
}

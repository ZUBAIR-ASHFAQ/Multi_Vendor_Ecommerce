import type { PaymentStatus } from "../types/payments.types";

/** Converts an internal Payment status into a short human-readable label. */
function labelForStatus(status: PaymentStatus): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Displays provider-authoritative Payment state without implying browser-owned success. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className="inline-flex rounded-full border bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {labelForStatus(status)}
    </span>
  );
}

import { ApiClientError } from "@/lib/api-error";
import { CHECKOUT_CHANGED_ERROR_CODES } from "../checkout.constants";

/** Shows a clear recalculate instruction when authoritative commerce state changed after quoting. */
export function CheckoutChangeWarning({ error }: { error: unknown }) {
  if (!(error instanceof ApiClientError) || !CHECKOUT_CHANGED_ERROR_CODES.has(error.code)) {
    return null;
  }

  return (
    <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Checkout details changed</p>
      <p className="mt-1">{error.message}</p>
      <p className="mt-1">Recalculate the quote and review the new totals before confirming again.</p>
      {error.requestId ? <p className="mt-2 text-xs">Request ID: {error.requestId}</p> : null}
    </div>
  );
}

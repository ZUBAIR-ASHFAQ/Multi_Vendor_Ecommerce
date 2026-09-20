import { ApiClientError } from "@/lib/api-error";
import { CHECKOUT_CHANGED_ERROR_CODES } from "../checkout.constants";

/** Shows a clear review-again instruction when commerce state changed after quoting. */
export function CheckoutChangeWarning({ error }: { error: unknown }) {
  if (!(error instanceof ApiClientError) || !CHECKOUT_CHANGED_ERROR_CODES.has(error.code)) {
    return null;
  }

  return (
    <div role="alert" className="checkout-state-message checkout-state-message-warning">
      <p className="font-semibold">Checkout details changed</p>
      <p>{error.message}</p>
      <p>Please review the latest totals before placing your order.</p>
      {error.requestId ? <small>Technical reference: {error.requestId}</small> : null}
    </div>
  );
}

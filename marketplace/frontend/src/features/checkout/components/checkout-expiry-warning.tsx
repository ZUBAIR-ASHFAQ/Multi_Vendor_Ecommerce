/** Returns whether one server ISO expiry timestamp is already in the past. */
export function checkoutQuoteIsExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/** Displays the quote review window without exposing implementation terminology to customers. */
export function CheckoutExpiryWarning({ expiresAt }: { expiresAt: string }) {
  const expired = checkoutQuoteIsExpired(expiresAt);
  const formattedExpiry = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));

  return (
    <div
      role={expired ? "alert" : "status"}
      className={`checkout-state-message ${expired ? "checkout-state-message-warning" : "checkout-state-message-neutral"}`}
    >
      {expired
        ? "This review has expired. Review your order again before placing it."
        : `Your reviewed totals are held until ${formattedExpiry}.`}
    </div>
  );
}

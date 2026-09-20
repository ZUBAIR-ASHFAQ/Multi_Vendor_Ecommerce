/** Returns whether one server ISO expiry timestamp is already in the past. */
export function checkoutQuoteIsExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/** Displays the quote expiry boundary so the customer knows when recalculation is required. */
export function CheckoutExpiryWarning({ expiresAt }: { expiresAt: string }) {
  const expired = checkoutQuoteIsExpired(expiresAt);
  const formattedExpiry = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));

  return (
    <div
      role={expired ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${
        expired
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {expired
        ? "This quote has expired. Recalculate before confirming."
        : `Quote expires ${formattedExpiry}. Recalculate if price, stock, promotion, shipping, address, or tax changes.`}
    </div>
  );
}

/** Module 10 permissions used only for frontend convenience; the API remains authoritative. */
export const CHECKOUT_PERMISSION = {
  CREATE_OWN: "checkout.create_own",
  CONFIRM_OWN: "checkout.confirm_own",
} as const;

/** Checkout errors that mean the customer must review a newly calculated quote before retrying confirmation. */
export const CHECKOUT_CHANGED_ERROR_CODES = new Set([
  "CHECKOUT_QUOTE_EXPIRED",
  "CHECKOUT_PRICE_CHANGED",
  "CHECKOUT_STOCK_CHANGED",
  "CHECKOUT_PROMOTION_CHANGED",
  "CHECKOUT_ADDRESS_INVALID",
]);

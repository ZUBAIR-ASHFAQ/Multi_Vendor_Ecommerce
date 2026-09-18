/** Stable TanStack Query keys owned by the Checkout frontend feature. */
export const checkoutQueryKeys = {
  shippingOptions: (addressId: string) => ["checkout", "shipping-options", addressId] as const,
  quote: (quoteId: string) => ["checkout", "quote", quoteId] as const,
  attempt: (attemptId: string) => ["checkout", "attempt", attemptId] as const,
};

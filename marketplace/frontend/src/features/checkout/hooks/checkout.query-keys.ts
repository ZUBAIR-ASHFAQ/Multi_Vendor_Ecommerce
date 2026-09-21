/** Stable TanStack Query keys owned by the Checkout frontend feature. */
export const checkoutQueryKeys = {
  shippingOptions: (addressId: string, variantId?: string, quantity?: number) =>
    ["checkout", "shipping-options", addressId, variantId ?? "cart", quantity ?? 0] as const,
  quote: (quoteId: string) => ["checkout", "quote", quoteId] as const,
  attempt: (attemptId: string) => ["checkout", "attempt", attemptId] as const,
};

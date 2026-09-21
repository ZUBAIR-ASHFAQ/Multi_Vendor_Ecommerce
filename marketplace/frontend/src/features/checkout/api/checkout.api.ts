import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api";
import type {
  CheckoutAttempt,
  CheckoutBuyNowItemInput,
  CheckoutQuote,
  CheckoutShippingOptions,
  CreateCheckoutQuoteInput,
} from "../types/checkout.types";

/** Unwraps one successful Checkout response while preserving normalized interceptor failures. */
async function dataOf<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export const checkoutApi = {
  /** Loads current Shipping Core choices for one customer-owned delivery address. */
  getShippingOptions: (addressId: string, buyNowItem?: CheckoutBuyNowItemInput) =>
    dataOf<CheckoutShippingOptions>(
      apiClient.get("/checkout/shipping-options", {
        params: {
          addressId,
          ...(buyNowItem
            ? { variantId: buyNowItem.variantId, quantity: buyNowItem.quantity }
            : {}),
        },
      }),
    ),

  /** Creates a fresh server-authoritative quote from Cart or one Buy Now item plus customer selections. */
  createQuote: (input: CreateCheckoutQuoteInput) =>
    dataOf<CheckoutQuote>(apiClient.post("/checkout/quote", input)),

  /** Reloads one unexpired customer-owned quote. */
  getQuote: (quoteId: string) =>
    dataOf<CheckoutQuote>(apiClient.get(`/checkout/quote/${quoteId}`)),

  /** Confirms one quote with its state hash and stable retry key. */
  confirmQuote: (quoteId: string, stateHash: string, idempotencyKey: string) =>
    dataOf<CheckoutAttempt>(
      apiClient.post(
        `/checkout/quote/${quoteId}/confirm`,
        { stateHash },
        { headers: { "Idempotency-Key": idempotencyKey } },
      ),
    ),

  /** Reads the current customer-owned Checkout attempt state. */
  getAttemptStatus: (attemptId: string) =>
    dataOf<CheckoutAttempt>(apiClient.get(`/checkout/${attemptId}/status`)),
};

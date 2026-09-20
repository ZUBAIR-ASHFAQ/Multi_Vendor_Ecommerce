import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkoutApi } from "../api/checkout.api";
import type { CreateCheckoutQuoteInput } from "../types/checkout.types";
import { checkoutQueryKeys } from "./checkout.query-keys";

/** Loads current Shipping Core methods after the customer chooses a delivery address. */
export function useCheckoutShippingOptionsQuery(addressId: string, enabled = true) {
  return useQuery({
    queryKey: checkoutQueryKeys.shippingOptions(addressId),
    queryFn: () => checkoutApi.getShippingOptions(addressId),
    enabled: enabled && addressId.length > 0,
    retry: false,
  });
}

/** Loads one current authoritative quote without duplicating it into a global client store. */
export function useCheckoutQuoteQuery(quoteId: string, enabled = true) {
  return useQuery({
    queryKey: checkoutQueryKeys.quote(quoteId),
    queryFn: () => checkoutApi.getQuote(quoteId),
    enabled: enabled && quoteId.length > 0,
    staleTime: 15_000,
    retry: false,
  });
}

/** Creates one quote and seeds the normal quote query cache from the returned server entity. */
export function useCreateCheckoutQuoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCheckoutQuoteInput) => checkoutApi.createQuote(input),
    onSuccess: (quote) => {
      queryClient.setQueryData(checkoutQueryKeys.quote(quote.id), quote);
    },
  });
}

/** Confirms one quote while keeping the idempotency key explicit at the call site for safe retries. */
export function useConfirmCheckoutQuoteMutation(quoteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stateHash: string; idempotencyKey: string }) =>
      checkoutApi.confirmQuote(quoteId, input.stateHash, input.idempotencyKey),
    onSuccess: (attempt) => {
      queryClient.setQueryData(checkoutQueryKeys.attempt(attempt.id), attempt);
    },
  });
}

/** Loads the current Checkout attempt state after confirmation. */
export function useCheckoutAttemptStatusQuery(attemptId: string, enabled = true) {
  return useQuery({
    queryKey: checkoutQueryKeys.attempt(attemptId),
    queryFn: () => checkoutApi.getAttemptStatus(attemptId),
    enabled: enabled && attemptId.length > 0,
    retry: false,
  });
}

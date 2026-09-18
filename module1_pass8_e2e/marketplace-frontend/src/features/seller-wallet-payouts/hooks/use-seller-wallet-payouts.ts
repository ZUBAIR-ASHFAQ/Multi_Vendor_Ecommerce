import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sellerWalletPayoutsApi } from "../api/seller-wallet-payouts.api";
import type {
  AdminPayoutListParams,
  CreatePayoutAccountInput,
  RequestPayoutInput,
  SellerPayoutListParams,
  SellerWalletParams,
} from "../types/seller-wallet-payouts.types";
import { sellerWalletPayoutsQueryKeys } from "./seller-wallet-payouts.query-keys";

/** Loads one ledger page plus the authenticated seller's safe Wallet/account snapshots. */
export function useSellerWalletQuery(params: SellerWalletParams, enabled = true) {
  return useQuery({
    queryKey: sellerWalletPayoutsQueryKeys.sellerWallet(params),
    queryFn: () => sellerWalletPayoutsApi.getSellerWallet(params),
    enabled,
    retry: false,
  });
}

/** Loads one page of seller-owned Payout history. */
export function useSellerPayoutsQuery(params: SellerPayoutListParams, enabled = true) {
  return useQuery({
    queryKey: sellerWalletPayoutsQueryKeys.sellerPayouts(params),
    queryFn: () => sellerWalletPayoutsApi.listSellerPayouts(params),
    enabled,
    retry: false,
  });
}

/** Loads one permission-filtered finance Payout queue page. */
export function useAdminPayoutsQuery(params: AdminPayoutListParams, enabled = true) {
  return useQuery({
    queryKey: sellerWalletPayoutsQueryKeys.adminPayouts(params),
    queryFn: () => sellerWalletPayoutsApi.listAdminPayouts(params),
    enabled,
    retry: false,
  });
}

/** Creates a tokenized payout-account reference and refreshes the seller Wallet projection. */
export function useCreatePayoutAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePayoutAccountInput) => sellerWalletPayoutsApi.createPayoutAccount(input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: sellerWalletPayoutsQueryKeys.all }),
  });
}

/** Requests a Payout with a caller-created retry key and refreshes Wallet/Payout projections after success. */
export function useRequestPayoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: { input: RequestPayoutInput; idempotencyKey: string }) =>
      sellerWalletPayoutsApi.requestPayout(value.input, value.idempotencyKey),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: sellerWalletPayoutsQueryKeys.all }),
  });
}

/** Approves/reserves one Payout and refreshes all Wallet/Payout views. */
export function useApprovePayoutMutation(payoutId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => sellerWalletPayoutsApi.approvePayout(payoutId, idempotencyKey),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: sellerWalletPayoutsQueryKeys.all }),
  });
}

/** Sends/reconciles one Payout and refreshes persisted status even when the provider result is uncertain or failed. */
export function useSendPayoutMutation(payoutId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => sellerWalletPayoutsApi.sendPayout(payoutId, idempotencyKey),
    onSettled: async () => queryClient.invalidateQueries({ queryKey: sellerWalletPayoutsQueryKeys.all }),
  });
}

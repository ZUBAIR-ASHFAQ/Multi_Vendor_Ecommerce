import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sellersApi } from "../api/sellers.api";
import type {
  CreateStoreInput,
  SellerApplicationListParams,
  SubmitSellerApplicationInput,
  UpdateSellerProfileInput,
  UpdateStoreInput,
} from "../types/sellers.types";
import { sellerQueryKeys } from "./sellers.query-keys";

/** Submits one customer-owned seller application. */
export function useSubmitSellerApplicationMutation() {
  return useMutation({ mutationFn: sellersApi.submitApplication });
}

/** Loads one privileged page of seller applications for review. */
export function useSellerApplicationsQuery(
  params: SellerApplicationListParams,
  enabled = true,
) {
  return useQuery({
    queryKey: sellerQueryKeys.applicationList(params),
    queryFn: () => sellersApi.listApplications(params),
    enabled,
  });
}

/** Approves one submitted seller application and refreshes the review queue. */
export function useApproveSellerApplicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sellersApi.approveApplication,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.applications });
    },
  });
}

/** Rejects one submitted seller application and refreshes the review queue. */
export function useRejectSellerApplicationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sellersApi.rejectApplication(id, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.applications });
    },
  });
}

/** Loads the authenticated seller aggregate when the page is authorized. */
export function useMySellerQuery(enabled = true) {
  return useQuery({
    queryKey: sellerQueryKeys.mySeller,
    queryFn: sellersApi.getMySeller,
    enabled,
  });
}

/** Updates the seller master and refreshes the authenticated seller aggregate. */
export function useUpdateSellerProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSellerProfileInput) => sellersApi.updateMySeller(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller });
    },
  });
}

/** Creates one seller-owned store and refreshes the authenticated seller aggregate. */
export function useCreateStoreMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoreInput) => sellersApi.createStore(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller });
    },
  });
}

/** Updates one seller-owned store and refreshes private and public store server state. */
export function useUpdateStoreMutation(storeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStoreInput) => sellersApi.updateStore(storeId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sellerQueryKeys.mySeller }),
        queryClient.invalidateQueries({ queryKey: sellerQueryKeys.publicStores }),
      ]);
    },
  });
}

/** Loads one public store detail record without requiring authentication. */
export function usePublicStoreQuery(slug: string) {
  return useQuery({
    queryKey: sellerQueryKeys.publicStore(slug),
    queryFn: () => sellersApi.getPublicStore(slug),
    enabled: Boolean(slug),
  });
}

/** Suspends one seller and refreshes all Module 4 server state after the lifecycle change. */
export function useSuspendSellerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      sellersApi.suspendSeller(id, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sellerQueryKeys.all });
    },
  });
}

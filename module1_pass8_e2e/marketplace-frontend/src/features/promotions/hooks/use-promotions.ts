import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { promotionsApi } from "../api/promotions.api";
import type {
  AdminPromotionListParams,
  CreatePromotionInput,
  UpdatePromotionInput,
} from "../schemas/promotions.schemas";
import { promotionsQueryKeys } from "./promotions.query-keys";

/** Loads one bounded page of platform promotions. */
export function useAdminPromotionsQuery(params: AdminPromotionListParams, enabled = true) {
  return useQuery({
    queryKey: promotionsQueryKeys.adminList(params),
    queryFn: () => promotionsApi.listAdminPromotions(params),
    enabled,
    retry: false,
  });
}

/** Creates one platform promotion and refreshes administrator lists. */
export function useCreateAdminPromotionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePromotionInput) => promotionsApi.createAdminPromotion(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.admin });
    },
  });
}

/** Updates one platform promotion and refreshes administrator lists. */
export function useUpdateAdminPromotionMutation(promotionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePromotionInput) =>
      promotionsApi.updateAdminPromotion(promotionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.admin });
    },
  });
}

/** Creates one seller-funded promotion using the authenticated seller scope. */
export function useCreateSellerPromotionMutation() {
  return useMutation({
    mutationFn: (input: CreatePromotionInput) => promotionsApi.createSellerPromotion(input),
  });
}

/** Runs one customer coupon preview against the server-derived current Cart. */
export function useValidateCouponMutation() {
  return useMutation({
    mutationFn: (code: string) => promotionsApi.validateCoupon(code),
  });
}

/** Activates or schedules one promotion through the explicit lifecycle command. */
export function useActivateAdminPromotionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (promotionId: string) => promotionsApi.activateAdminPromotion(promotionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.admin });
    },
  });
}

/** Deactivates one promotion through the explicit lifecycle command. */
export function useDeactivateAdminPromotionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (promotionId: string) => promotionsApi.deactivateAdminPromotion(promotionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.admin });
    },
  });
}

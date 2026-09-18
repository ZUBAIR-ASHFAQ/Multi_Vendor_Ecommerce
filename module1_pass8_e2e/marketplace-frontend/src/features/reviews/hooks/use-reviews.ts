import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewsApi } from "../api/reviews.api";
import type {
  AdminReviewListParams,
  CreateReviewInput,
  ModerateReviewInput,
  ReviewListParams,
  UpdateReviewInput,
} from "../types/reviews.types";
import { reviewsQueryKeys } from "./reviews.query-keys";

/** Loads one public page of published Product Reviews. */
export function useProductReviewsQuery(productId: string, params: ReviewListParams) {
  return useQuery({
    queryKey: reviewsQueryKeys.product(productId, params),
    queryFn: () => reviewsApi.listProductReviews(productId, params),
    retry: false,
  });
}

/** Loads one public page of published Store Reviews. */
export function useStoreReviewsQuery(storeId: string, params: ReviewListParams) {
  return useQuery({
    queryKey: reviewsQueryKeys.store(storeId, params),
    queryFn: () => reviewsApi.listStoreReviews(storeId, params),
    retry: false,
  });
}

/** Loads one permission-scoped admin Review moderation page. */
export function useAdminReviewsQuery(params: AdminReviewListParams) {
  return useQuery({
    queryKey: reviewsQueryKeys.admin(params),
    queryFn: () => reviewsApi.listAdminReviews(params),
    retry: false,
  });
}

/** Creates one verified-purchase Review and refreshes all public Review projections. */
export function useCreateReviewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewInput) => reviewsApi.createReview(input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
  });
}

/** Updates the authenticated customer's own Review and refreshes public projections. */
export function useUpdateOwnReviewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, input }: { reviewId: string; input: UpdateReviewInput }) =>
      reviewsApi.updateOwnReview(reviewId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
  });
}

/** Marks one Review helpful and refreshes Product/Store counts. */
export function useMarkReviewHelpfulMutation(reviewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reviewsApi.markHelpful(reviewId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
  });
}

/** Hides one Review through the privileged command and refreshes public aggregates. */
export function useHideReviewMutation(reviewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModerateReviewInput) => reviewsApi.hideReview(reviewId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
  });
}

/** Publishes one Review through the privileged command and refreshes public aggregates. */
export function usePublishReviewMutation(reviewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModerateReviewInput) => reviewsApi.publishReview(reviewId, input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all }),
  });
}

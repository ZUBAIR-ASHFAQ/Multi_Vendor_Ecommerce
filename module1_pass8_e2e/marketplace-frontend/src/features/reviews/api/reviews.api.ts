import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  adminReviewSchema,
  helpfulReviewResponseSchema,
  publicReviewsListDataSchema,
  reviewSchema,
} from "../schemas/reviews.schemas";
import type {
  AdminReviewListParams,
  AdminReviewsPage,
  CreateReviewInput,
  ModerateReviewInput,
  PublicReviewsPage,
  ReviewListParams,
  UpdateReviewInput,
} from "../types/reviews.types";

/** Removes undefined query values before sending one allow-listed Review list request. */
function queryParams(
  value: Record<string, string | number | undefined>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Record<string, string | number>;
}

/** Unwraps and validates one successful Module 15 response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps one public Product/Store Review page with required pagination metadata. */
async function publicPage(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
): Promise<PublicReviewsPage> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Review pagination metadata is missing.");

  const parsed = publicReviewsListDataSchema.parse(response.data.data);
  return {
    items: parsed.reviews,
    rating: parsed.rating,
    meta: response.data.meta,
  };
}

/** Unwraps and validates one admin moderation page without accepting private customer fields. */
async function adminPage(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
): Promise<AdminReviewsPage> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Review moderation pagination metadata is missing.");

  return {
    items: adminReviewSchema.array().parse(response.data.data),
    meta: response.data.meta,
  };
}

export const reviewsApi = {
  /** Creates one Review using only the purchased Order Item and authored content. */
  createReview: (input: CreateReviewInput) =>
    one(apiClient.post("/reviews", input), (value) => reviewSchema.parse(value)),

  /** Updates only authored fields on the authenticated customer's own Review. */
  updateOwnReview: (reviewId: string, input: UpdateReviewInput) =>
    one(apiClient.patch(`/reviews/${reviewId}`, input), (value) => reviewSchema.parse(value)),

  /** Lists only published public-safe Product Reviews and their published aggregate. */
  listProductReviews: (productId: string, params: ReviewListParams) =>
    publicPage(apiClient.get(`/products/${productId}/reviews`, { params: queryParams(params) })),

  /** Lists only published public-safe Store Reviews and the canonical seller aggregate. */
  listStoreReviews: (storeId: string, params: ReviewListParams) =>
    publicPage(apiClient.get(`/stores/${storeId}/reviews`, { params: queryParams(params) })),

  /** Marks one published Review helpful; replay remains server/database safe. */
  markHelpful: (reviewId: string) =>
    one(apiClient.post(`/reviews/${reviewId}/helpful`, {}), (value) => helpfulReviewResponseSchema.parse(value)),

  /** Lists permission-scoped Reviews for the admin moderation queue. */
  listAdminReviews: (params: AdminReviewListParams) =>
    adminPage(apiClient.get("/admin/reviews", { params: queryParams(params) })),

  /** Hides one Review using the privileged explicit moderation command. */
  hideReview: (reviewId: string, input: ModerateReviewInput) =>
    one(apiClient.post(`/admin/reviews/${reviewId}/hide`, input), (value) => reviewSchema.parse(value)),

  /** Publishes one Review using the privileged explicit moderation command. */
  publishReview: (reviewId: string, input: ModerateReviewInput) =>
    one(apiClient.post(`/admin/reviews/${reviewId}/publish`, input), (value) => reviewSchema.parse(value)),
};

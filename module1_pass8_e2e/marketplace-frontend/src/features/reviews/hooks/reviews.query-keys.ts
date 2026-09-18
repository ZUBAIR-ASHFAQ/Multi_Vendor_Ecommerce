import type { AdminReviewListParams, ReviewListParams } from "../types/reviews.types";

/** Stable query-key factory keeps Review cache invalidation narrow and predictable. */
export const reviewsQueryKeys = {
  all: ["reviews"] as const,

  /** Identifies one public Product Review page. */
  product: (productId: string, params: ReviewListParams) =>
    ["reviews", "product", productId, params] as const,

  /** Identifies one public Store Review page. */
  store: (storeId: string, params: ReviewListParams) =>
    ["reviews", "store", storeId, params] as const,

  /** Identifies one permission-scoped admin moderation page. */
  admin: (params: AdminReviewListParams) =>
    ["reviews", "admin", params] as const,
};

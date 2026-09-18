import type { PaginationMeta } from "@/types/api";
import type {
  adminReviewSchema,
  publicReviewSchema,
  reviewRatingSummarySchema,
  reviewSchema,
} from "../schemas/reviews.schemas";
import type { z } from "zod";

export type PublicReview = z.infer<typeof publicReviewSchema>;
export type AdminReview = z.infer<typeof adminReviewSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewRatingSummary = z.infer<typeof reviewRatingSummarySchema>;

export interface ReviewListParams {
  page?: number;
  pageSize?: number;
}

export type AdminReviewStatus = "pending" | "published" | "hidden";
export type AdminReviewSort = "created_desc" | "created_asc";

export interface AdminReviewListParams extends ReviewListParams {
  status?: AdminReviewStatus;
  productId?: string;
  sellerId?: string;
  storeId?: string;
  sort?: AdminReviewSort;
}

export interface AdminReviewsPage {
  items: AdminReview[];
  meta: PaginationMeta;
}

export interface PublicReviewsPage {
  items: PublicReview[];
  rating: ReviewRatingSummary;
  meta: PaginationMeta;
}

export interface CreateReviewInput {
  orderItemId: string;
  rating: number;
  title?: string;
  body?: string;
}

export interface UpdateReviewInput {
  rating?: number;
  title?: string | null;
  body?: string | null;
}

export interface ModerateReviewInput {
  reason: string;
}

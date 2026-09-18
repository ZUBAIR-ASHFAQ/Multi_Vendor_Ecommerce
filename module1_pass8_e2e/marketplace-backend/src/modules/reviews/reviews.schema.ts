import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  REVIEW_RATING_ENTITY_VALUES,
  REVIEW_STATUS_VALUES,
  REVIEWS_LIMITS,
} from "./reviews.constants.js";

/** Validates a non-blank Review title using the database-backed maximum length. */
function reviewTitleSchema() {
  return z.string().trim().min(1).max(REVIEWS_LIMITS.TITLE_MAX_LENGTH);
}

/** Validates non-blank Review text while the global HTTP body limit remains the transport-size authority. */
function reviewTextSchema() {
  return z.string().trim().min(1);
}

/** Integer customer rating accepted by Review create/edit commands. */
export const reviewRatingSchema = z
  .number()
  .int()
  .min(REVIEWS_LIMITS.RATING_MIN)
  .max(REVIEWS_LIMITS.RATING_MAX);

/** Persisted Review lifecycle status; callers never choose this value directly. */
export const reviewStatusSchema = z.enum(REVIEW_STATUS_VALUES);

/** Rating aggregate owner kind shared with the later Search integration boundary. */
export const reviewRatingEntitySchema = z.enum(REVIEW_RATING_ENTITY_VALUES);

/** Path parameter for Review edit/helpful/moderation commands. */
export const reviewIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Product identifier for the public Product Review list. */
export const productReviewsParamsSchema = z
  .object({
    productId: uuidSchema,
  })
  .strict();

/** Store identifier for the public Store Review list. */
export const storeReviewsParamsSchema = z
  .object({
    storeId: uuidSchema,
  })
  .strict();

/** Customer create body accepts only the purchased item plus authored Review content. */
export const createReviewBodySchema = z
  .object({
    orderItemId: uuidSchema,
    rating: reviewRatingSchema,
    title: reviewTitleSchema().optional(),
    body: reviewTextSchema().optional(),
  })
  .strict();

/** Customer edit body can change authored content only and requires at least one actual field. */
export const updateReviewBodySchema = z
  .object({
    rating: reviewRatingSchema.optional(),
    title: z.union([reviewTitleSchema(), z.null()]).optional(),
    body: z.union([reviewTextSchema(), z.null()]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rating === undefined && value.title === undefined && value.body === undefined) {
      context.addIssue({
        code: "custom",
        message: "At least one Review field must be supplied.",
      });
    }
  });

/** Helpful is a one-way replay-safe command and therefore accepts no client-owned state. */
export const markReviewHelpfulBodySchema = z.object({}).strict().default({});

/** Moderation commands require an explicit audit reason and never accept a target status from the client. */
export const moderateReviewBodySchema = z
  .object({
    reason: reviewTextSchema(),
  })
  .strict();

/** Public Review lists intentionally accept only bounded pagination until another filter is explicitly approved. */
export const publicReviewsListQuerySchema = paginationQuerySchema.strict();

/** Admin moderation queue filters are allow-listed and bounded by the shared pagination contract. */
export const adminReviewsListQuerySchema = paginationQuerySchema
  .extend({
    status: reviewStatusSchema.optional(),
    productId: uuidSchema.optional(),
    sellerId: uuidSchema.optional(),
    storeId: uuidSchema.optional(),
    sort: z.enum(["created_desc", "created_asc"]).default("created_desc"),
  })
  .strict();

/** Public Review card contract omits customer/order identity and every privileged moderation field. */
export const publicReviewResponseSchema = z
  .object({
    id: uuidSchema,
    rating: reviewRatingSchema,
    title: reviewTitleSchema().nullable(),
    body: reviewTextSchema().nullable(),
    verifiedPurchase: z.literal(true),
    helpfulCount: z.number().int().nonnegative(),
    publishedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Authenticated customer/moderator Review representation with server-derived ownership and lifecycle fields. */
export const reviewResponseSchema = z
  .object({
    id: uuidSchema,
    orderItemId: uuidSchema,
    productId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    rating: reviewRatingSchema,
    title: reviewTitleSchema().nullable(),
    body: reviewTextSchema().nullable(),
    status: reviewStatusSchema,
    verifiedPurchase: z.literal(true),
    helpfulCount: z.number().int().nonnegative(),
    publishedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Admin moderation row exposes only Review content plus Product/Seller/Store moderation context. */
export const adminReviewResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    rating: reviewRatingSchema,
    title: reviewTitleSchema().nullable(),
    body: reviewTextSchema().nullable(),
    status: reviewStatusSchema,
    verifiedPurchase: z.literal(true),
    helpfulCount: z.number().int().nonnegative(),
    publishedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Admin moderation queue returns only privacy-safe moderation rows plus normal pagination metadata. */
export const adminReviewsListResponseSchema = z.array(adminReviewResponseSchema);

/** Public rating summary returned with a Product or Store Review list without adding an aggregate endpoint. */
export const reviewRatingSummaryResponseSchema = z
  .object({
    ratingAvg: z.number().min(0).max(REVIEWS_LIMITS.RATING_MAX),
    ratingCount: z.number().int().nonnegative(),
  })
  .strict();

/** Public list data combines published Review cards with the matching aggregate summary. */
export const publicReviewsListDataSchema = z
  .object({
    reviews: z.array(publicReviewResponseSchema),
    rating: reviewRatingSummaryResponseSchema,
  })
  .strict();

/** Replay-safe Helpful response exposes only the resulting public count and marked state. */
export const markReviewHelpfulResponseSchema = z
  .object({
    reviewId: uuidSchema,
    helpfulCount: z.number().int().nonnegative(),
    markedHelpful: z.literal(true),
  })
  .strict();

/** Recalculable Product/Seller aggregate representation used by the later service integration boundary. */
export const reviewRatingAggregateResponseSchema = z
  .object({
    entityType: reviewRatingEntitySchema,
    entityId: uuidSchema,
    ratingAvg: z.number().min(0).max(REVIEWS_LIMITS.RATING_MAX),
    ratingCount: z.number().int().nonnegative(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;
export type UpdateReviewBody = z.infer<typeof updateReviewBodySchema>;
export type ModerateReviewBody = z.infer<typeof moderateReviewBodySchema>;
export type PublicReviewsListQuery = z.infer<typeof publicReviewsListQuerySchema>;
export type AdminReviewsListQuery = z.infer<typeof adminReviewsListQuerySchema>;
export type AdminReviewResponse = z.infer<typeof adminReviewResponseSchema>;
export type PublicReviewResponse = z.infer<typeof publicReviewResponseSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
export type PublicReviewsListData = z.infer<typeof publicReviewsListDataSchema>;

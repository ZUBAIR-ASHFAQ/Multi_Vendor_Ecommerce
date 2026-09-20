import { z } from "zod";
import { REVIEW_RATINGS, REVIEW_STATUS } from "../reviews.constants";

const uuidSchema = z.uuid();
const dateTimeSchema = z.iso.datetime();

/** Validates authored Review fields before the server performs purchase/delivery eligibility checks. */
export const reviewEditorFormSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5, "Choose a rating"),
  title: z.string().trim().max(200, "Title must be 200 characters or fewer"),
  body: z.string().trim(),
});

/** Validates the mandatory reason used by privileged Review moderation commands. */
export const reviewModerationFormSchema = z.object({
  reason: z.string().trim().min(1, "Moderation reason is required"),
});


/** Validates optional moderation queue filters before they are copied into API query parameters. */
export const adminReviewFilterFormSchema = z.object({
  status: z.union([z.enum(REVIEW_STATUS), z.literal("")]),
  productId: z.union([z.uuid("Product ID must be a valid UUID"), z.literal("")]),
  sellerId: z.union([z.uuid("Seller ID must be a valid UUID"), z.literal("")]),
  storeId: z.union([z.uuid("Store ID must be a valid UUID"), z.literal("")]),
  sort: z.enum(["created_desc", "created_asc"]),
});

/** Validates one public Review card without accepting customer/order identity. */
export const publicReviewSchema = z.object({
  id: uuidSchema,
  rating: z.number().int().min(REVIEW_RATINGS[0]).max(REVIEW_RATINGS.at(-1) ?? 5),
  title: z.string().nullable(),
  body: z.string().nullable(),
  verifiedPurchase: z.literal(true),
  helpfulCount: z.number().int().nonnegative(),
  publishedAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

/** Validates the authenticated Review representation returned after create/edit/moderation. */
export const reviewSchema = z.object({
  id: uuidSchema,
  orderItemId: uuidSchema,
  productId: uuidSchema,
  sellerId: uuidSchema,
  storeId: uuidSchema,
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string().nullable(),
  status: z.enum(REVIEW_STATUS),
  verifiedPurchase: z.literal(true),
  helpfulCount: z.number().int().nonnegative(),
  publishedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});


/** Validates one privacy-safe admin moderation row without customer or Order identity. */
export const adminReviewSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  sellerId: uuidSchema,
  storeId: uuidSchema,
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string().nullable(),
  status: z.enum(REVIEW_STATUS),
  verifiedPurchase: z.literal(true),
  helpfulCount: z.number().int().nonnegative(),
  publishedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

/** Validates the published-only aggregate returned alongside public Product/Store Reviews. */
export const reviewRatingSummarySchema = z.object({
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.number().int().nonnegative(),
});

/** Validates public Review list data before it reaches React components. */
export const publicReviewsListDataSchema = z.object({
  reviews: z.array(publicReviewSchema),
  rating: reviewRatingSummarySchema,
});

/** Validates the replay-safe Helpful command response. */
export const helpfulReviewResponseSchema = z.object({
  reviewId: uuidSchema,
  helpfulCount: z.number().int().nonnegative(),
  markedHelpful: z.literal(true),
});

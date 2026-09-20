import { describe, expect, it } from "vitest";
import {
  REVIEW_MODERATION_ACTION,
  REVIEW_RATING_ENTITY,
  REVIEW_STATUS,
  REVIEWS_ERROR_CODE,
  REVIEWS_OUTBOX_EVENT,
  REVIEWS_PATH,
  REVIEWS_PERMISSION,
} from "../../src/modules/reviews/reviews.constants.js";
import {
  adminReviewsListQuerySchema,
  adminReviewsListResponseSchema,
  createReviewBodySchema,
  markReviewHelpfulBodySchema,
  moderateReviewBodySchema,
  publicReviewResponseSchema,
  publicReviewsListQuerySchema,
  reviewRatingAggregateResponseSchema,
  updateReviewBodySchema,
} from "../../src/modules/reviews/reviews.schema.js";

const ORDER_ITEM_ID = "00000000-0000-4000-8000-000000000001";
const REVIEW_ID = "00000000-0000-4000-8000-000000000002";
const ENTITY_ID = "00000000-0000-4000-8000-000000000003";

describe("Module 15 fixed contract values", () => {
  it("keeps the source-defined lifecycle, aggregate, moderation, permission, error, and event values", () => {
    expect(Object.values(REVIEW_STATUS)).toEqual(["pending", "published", "hidden"]);
    expect(Object.values(REVIEW_RATING_ENTITY)).toEqual(["product", "seller"]);
    expect(Object.values(REVIEW_MODERATION_ACTION)).toEqual(["hide", "publish"]);
    expect(Object.values(REVIEWS_PERMISSION)).toEqual([
      "reviews.create_verified",
      "reviews.update_own",
      "reviews.public.read",
      "admin.reviews.moderate",
    ]);
    expect(Object.values(REVIEWS_ERROR_CODE)).toEqual([
      "REVIEW_NOT_ELIGIBLE",
      "REVIEW_ALREADY_EXISTS",
      "REVIEW_NOT_FOUND",
      "REVIEW_SCOPE_FORBIDDEN",
    ]);
    expect(Object.values(REVIEWS_OUTBOX_EVENT)).toEqual([
      "review.created",
      "review.published",
      "review.hidden",
      "rating.aggregate_updated",
    ]);
  });

  it("freezes exactly the eight approved paths including the moderation queue read", () => {
    expect(Object.values(REVIEWS_PATH)).toHaveLength(8);
    expect(new Set(Object.values(REVIEWS_PATH)).size).toBe(8);
    expect(Object.values(REVIEWS_PATH)).toContain("/api/v1/admin/reviews");
  });
});

describe("Module 15 write boundaries", () => {
  it("accepts only purchased-item identity plus authored content on create", () => {
    expect(
      createReviewBodySchema.parse({
        orderItemId: ORDER_ITEM_ID,
        rating: 5,
        title: "Excellent",
        body: "Arrived as expected.",
      }),
    ).toEqual({
      orderItemId: ORDER_ITEM_ID,
      rating: 5,
      title: "Excellent",
      body: "Arrived as expected.",
    });

    expect(() =>
      createReviewBodySchema.parse({
        orderItemId: ORDER_ITEM_ID,
        rating: 5,
        verifiedPurchase: true,
        productId: ENTITY_ID,
        sellerId: ENTITY_ID,
        storeId: ENTITY_ID,
        status: "published",
      }),
    ).toThrow();
  });

  it("keeps edit ownership/status server-side and requires at least one authored change", () => {
    expect(updateReviewBodySchema.parse({ rating: 4, title: null })).toEqual({
      rating: 4,
      title: null,
    });
    expect(() => updateReviewBodySchema.parse({})).toThrow();
    expect(() => updateReviewBodySchema.parse({ status: "published" })).toThrow();
  });

  it("keeps helpful replay state server-owned and moderation reason explicit", () => {
    expect(markReviewHelpfulBodySchema.parse(undefined)).toEqual({});
    expect(() => markReviewHelpfulBodySchema.parse({ helpful: false })).toThrow();
    expect(moderateReviewBodySchema.parse({ reason: "Abusive content." })).toEqual({
      reason: "Abusive content.",
    });
    expect(() => moderateReviewBodySchema.parse({})).toThrow();
  });
});

describe("Module 15 public privacy and aggregate contracts", () => {
  it("accepts only bounded pagination on public list queries", () => {
    expect(publicReviewsListQuerySchema.parse({ page: "2", pageSize: "20" })).toEqual({
      page: 2,
      pageSize: 20,
    });
    expect(() => publicReviewsListQuerySchema.parse({ status: "hidden" })).toThrow();
    expect(() => publicReviewsListQuerySchema.parse({ customerUserId: ENTITY_ID })).toThrow();
  });

  it("accepts only approved bounded moderation queue filters", () => {
    expect(
      adminReviewsListQuerySchema.parse({
        status: "pending",
        productId: ENTITY_ID,
        sellerId: ENTITY_ID,
        storeId: ENTITY_ID,
        page: "2",
        pageSize: "20",
        sort: "created_asc",
      }),
    ).toEqual({
      status: "pending",
      productId: ENTITY_ID,
      sellerId: ENTITY_ID,
      storeId: ENTITY_ID,
      page: 2,
      pageSize: 20,
      sort: "created_asc",
    });

    expect(() => adminReviewsListQuerySchema.parse({ sort: "rating_desc" })).toThrow();
    expect(() => adminReviewsListQuerySchema.parse({ customerUserId: ENTITY_ID })).toThrow();
  });

  it("keeps private customer fields out of the moderation queue response contract", () => {
    const safeReview = {
      id: REVIEW_ID,
      productId: ENTITY_ID,
      sellerId: ENTITY_ID,
      storeId: ENTITY_ID,
      rating: 5,
      title: "Needs moderation",
      body: "Moderation-safe content only.",
      status: "pending" as const,
      verifiedPurchase: true as const,
      helpfulCount: 0,
      publishedAt: null,
      createdAt: "2026-09-15T10:00:00.000Z",
      updatedAt: "2026-09-15T10:00:00.000Z",
    };

    expect(adminReviewsListResponseSchema.parse([safeReview])).toEqual([safeReview]);
    expect(() =>
      adminReviewsListResponseSchema.parse([{
        ...safeReview,
        customerUserId: ENTITY_ID,
        orderItemId: ORDER_ITEM_ID,
        customerEmail: "private@example.com",
      }]),
    ).toThrow();
  });

  it("keeps customer and Order identity out of public Review cards", () => {
    const base = {
      id: REVIEW_ID,
      rating: 5,
      title: "Excellent",
      body: "Arrived as expected.",
      verifiedPurchase: true as const,
      helpfulCount: 2,
      publishedAt: "2026-09-15T10:00:00.000Z",
      updatedAt: "2026-09-15T10:00:00.000Z",
    };

    expect(publicReviewResponseSchema.parse(base)).toEqual(base);
    expect(() =>
      publicReviewResponseSchema.parse({
        ...base,
        customerUserId: ENTITY_ID,
        orderItemId: ORDER_ITEM_ID,
      }),
    ).toThrow();
  });

  it("supports recalculable Product/Seller aggregate output without a write contract", () => {
    expect(
      reviewRatingAggregateResponseSchema.parse({
        entityType: "product",
        entityId: ENTITY_ID,
        ratingAvg: 4.25,
        ratingCount: 8,
        updatedAt: "2026-09-15T10:00:00.000Z",
      }),
    ).toMatchObject({ ratingAvg: 4.25, ratingCount: 8 });
  });
});

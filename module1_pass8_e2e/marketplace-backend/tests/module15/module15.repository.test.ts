import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../../src/database/db.js";
import { reviewModerationHistory } from "../../src/database/schema/reviews.js";
import {
  REVIEW_RATING_ENTITY,
  REVIEW_STATUS,
} from "../../src/modules/reviews/reviews.constants.js";
import { ReviewsRepository } from "../../src/modules/reviews/reviews.repository.js";
import {
  adminReviewsListQuerySchema,
  publicReviewsListQuerySchema,
} from "../../src/modules/reviews/reviews.schema.js";
import { prepareOrderFixture } from "../module11/module11.test-helpers.js";
import {
  readReviewOrderItemFacts,
  resetModule15Tables,
} from "./module15.test-helpers.js";

beforeEach(async () => {
  await resetModule15Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Creates one persisted published Review using only service-approved repository input fields. */
async function createPublishedReview(repository: ReviewsRepository) {
  const fixture = await prepareOrderFixture({ quantities: [1] });
  const [item] = await readReviewOrderItemFacts(fixture.orderId);
  if (!item) throw new Error("Expected one purchased Order Item for Module 15 repository proof.");

  const review = await repository.createReviewIfMissing({
    customerUserId: fixture.customer.id,
    orderItemId: item.orderItemId,
    productId: item.productId,
    sellerId: item.sellerId,
    storeId: item.storeId,
    rating: 4,
    title: "Useful product",
    body: "Repository persistence proof.",
    status: REVIEW_STATUS.PUBLISHED,
    publishedAt: new Date("2026-09-15T12:00:00.000Z"),
  });
  if (!review) throw new Error("Expected the Review repository fixture to be inserted.");

  return { fixture, item, review };
}

describe("Module 15 Reviews repository boundaries", () => {
  it("keeps one Review per purchased Order Item and enforces customer scope on edits", async () => {
    const fixture = await prepareOrderFixture({ quantities: [1] });
    const [item] = await readReviewOrderItemFacts(fixture.orderId);
    if (!item) throw new Error("Expected one purchased Order Item for duplicate Review proof.");
    const repository = new ReviewsRepository();
    const input = {
      customerUserId: fixture.customer.id,
      orderItemId: item.orderItemId,
      productId: item.productId,
      sellerId: item.sellerId,
      storeId: item.storeId,
      rating: 5,
      title: "First review",
      body: "Created once even when requests race.",
      status: REVIEW_STATUS.PUBLISHED,
      publishedAt: new Date("2026-09-15T12:00:00.000Z"),
    } as const;

    const [first, second] = await Promise.all([
      repository.createReviewIfMissing(input),
      repository.createReviewIfMissing(input),
    ]);
    const created = [first, second].filter((row) => row !== null);
    expect(created).toHaveLength(1);
    await expect(repository.findReviewByOrderItemId(item.orderItemId)).resolves.toMatchObject({
      id: created[0]?.id,
      customerUserId: fixture.customer.id,
    });

    const foreignCustomerId = randomUUID();
    await expect(
      repository.updateOwnedReview(String(created[0]?.id), foreignCustomerId, {
        title: "Not allowed by repository scope",
      }),
    ).resolves.toBeNull();

    await db.transaction(async (transaction) => {
      const scoped = repository.using(transaction);
      await expect(
        scoped.findOwnedReviewByIdForUpdate(String(created[0]?.id), foreignCustomerId),
      ).resolves.toBeNull();
      await expect(
        scoped.findOwnedReviewByIdForUpdate(String(created[0]?.id), fixture.customer.id),
      ).resolves.toMatchObject({ id: created[0]?.id });
    });

    await expect(
      repository.updateOwnedReview(String(created[0]?.id), fixture.customer.id, {
        title: "Owner edit",
      }),
    ).resolves.toMatchObject({ title: "Owner edit" });
  });

  it("keeps public Product/Store reads published-only and Helpful votes replay-safe", async () => {
    const repository = new ReviewsRepository();
    const { fixture, item, review } = await createPublishedReview(repository);
    const query = publicReviewsListQuerySchema.parse({ page: 1, pageSize: 20 });

    await expect(repository.createHelpfulVoteIfMissing(review.id, fixture.customer.id)).resolves.toBe(
      true,
    );
    await expect(repository.createHelpfulVoteIfMissing(review.id, fixture.customer.id)).resolves.toBe(
      false,
    );
    await expect(repository.countHelpfulVotes(review.id)).resolves.toBe(1);

    const productList = await repository.listPublishedProductReviews(item.productId, query);
    expect(productList.totalItems).toBe(1);
    expect(productList.items[0]).toMatchObject({
      id: review.id,
      rating: 4,
      helpfulCount: 1,
      verifiedPurchase: true,
    });
    expect(productList.items[0]).not.toHaveProperty("customerUserId");
    expect(productList.items[0]).not.toHaveProperty("orderItemId");

    const storeList = await repository.listPublishedStoreReviews(item.storeId, query);
    expect(storeList.totalItems).toBe(1);
    expect(storeList.items[0]?.id).toBe(review.id);

    await repository.updateReviewLifecycle(review.id, {
      status: REVIEW_STATUS.HIDDEN,
      publishedAt: null,
    });
    await expect(repository.listPublishedProductReviews(item.productId, query)).resolves.toMatchObject({
      items: [],
      totalItems: 0,
    });
  });

  it("lists moderation rows with approved filters and never returns customer identity", async () => {
    const repository = new ReviewsRepository();
    const { item, review } = await createPublishedReview(repository);

    const query = adminReviewsListQuerySchema.parse({
      status: "published",
      productId: item.productId,
      sellerId: item.sellerId,
      storeId: item.storeId,
      page: 1,
      pageSize: 20,
      sort: "created_desc",
    });
    const page = await repository.listAdminReviews(query);

    expect(page.totalItems).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: review.id,
      productId: item.productId,
      sellerId: item.sellerId,
      storeId: item.storeId,
      status: REVIEW_STATUS.PUBLISHED,
      helpfulCount: 0,
    });
    expect(page.items[0]).not.toHaveProperty("customerUserId");
    expect(page.items[0]).not.toHaveProperty("orderItemId");

    const noMatch = await repository.listAdminReviews(
      adminReviewsListQuerySchema.parse({
        status: "hidden",
        productId: item.productId,
        page: 1,
        pageSize: 20,
      }),
    );
    expect(noMatch).toEqual({ items: [], totalItems: 0 });
  });

  it("appends moderation history and recalculates Product/Seller aggregates from published rows", async () => {
    const repository = new ReviewsRepository();
    const { fixture, item, review } = await createPublishedReview(repository);

    const productAggregate = await repository.recalculateRatingAggregate(
      REVIEW_RATING_ENTITY.PRODUCT,
      item.productId,
    );
    expect(productAggregate).toMatchObject({ ratingAvg: "4.00", ratingCount: 1 });

    const sellerAggregate = await repository.recalculateRatingAggregate(
      REVIEW_RATING_ENTITY.SELLER,
      item.sellerId,
    );
    expect(sellerAggregate).toMatchObject({ ratingAvg: "4.00", ratingCount: 1 });
    await expect(
      repository.findRatingAggregate(REVIEW_RATING_ENTITY.SELLER, item.sellerId),
    ).resolves.toMatchObject({ ratingCount: 1 });

    await repository.appendModerationHistory({
      reviewId: review.id,
      action: "hide",
      moderatorUserId: fixture.customer.id,
      reason: "Persistence-only moderation history proof.",
      createdAt: new Date("2026-09-15T12:01:00.000Z"),
    });
    await repository.appendModerationHistory({
      reviewId: review.id,
      action: "publish",
      moderatorUserId: fixture.customer.id,
      reason: "Append-only second history row.",
      createdAt: new Date("2026-09-15T12:02:00.000Z"),
    });
    const history = await db
      .select()
      .from(reviewModerationHistory)
      .where(eq(reviewModerationHistory.reviewId, review.id))
      .orderBy(asc(reviewModerationHistory.createdAt), asc(reviewModerationHistory.id));
    expect(history.map((row) => row.action)).toEqual(["hide", "publish"]);

    await repository.updateReviewLifecycle(review.id, {
      status: REVIEW_STATUS.HIDDEN,
      publishedAt: null,
    });
    const emptyAggregate = await repository.recalculateRatingAggregate(
      REVIEW_RATING_ENTITY.PRODUCT,
      item.productId,
    );
    expect(emptyAggregate).toMatchObject({ ratingAvg: "0.00", ratingCount: 0 });
  });
});

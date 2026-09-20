import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  REVIEW_STATUS,
  REVIEWS_ERROR_CODE,
} from "../../src/modules/reviews/reviews.constants.js";
import { bearer, loginUser, registerCustomer } from "../module13/module13.test-helpers.js";
import { prepareDeliveredReturnFixture } from "../module14/module14.test-helpers.js";
import {
  countHelpfulVotes,
  countModerationHistory,
  createReviewViaHttp,
  createSecondReviewCustomer,
  hideReviewViaHttp,
  listProductReviewsViaHttp,
  listStoreReviewsViaHttp,
  markReviewHelpfulViaHttp,
  publishReviewViaHttp,
  readProductRatingAggregate,
  resetModule15IntegrationTables,
  updateReviewViaHttp,
} from "./module15.test-helpers.js";

beforeEach(async () => {
  await resetModule15IntegrationTables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 15 Reviews HTTP/RBAC regression", () => {
  it("requires authentication for writes and rejects client-owned Review authority fields", async () => {
    await request(createApp())
      .post("/api/v1/reviews")
      .send({ orderItemId: randomUUID(), rating: 5 })
      .expect(401)
      .expect((response) => {
        expect(response.body.error.code).toBe(ERROR_CODE.UNAUTHENTICATED);
      });

    const customer = await registerCustomer(`module15-contract-${randomUUID()}@example.com`);
    const token = await loginUser(customer);
    const invalid = await request(createApp())
      .post("/api/v1/reviews")
      .set(bearer(token))
      .send({
        orderItemId: randomUUID(),
        rating: 5,
        verifiedPurchase: true,
        sellerId: randomUUID(),
        status: "published",
      })
      .expect(422);

    expect(invalid.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);
  });

  it("allows exactly one concurrent Review for an eligible delivered purchase", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const payload = {
      orderItemId: fixture.orderItemId,
      rating: 5,
      title: "Delivered purchase",
      body: "Only one concurrent Review may win.",
    };

    const [first, second] = await Promise.all([
      request(createApp())
        .post("/api/v1/reviews")
        .set(bearer(fixture.customerToken))
        .send(payload),
      request(createApp())
        .post("/api/v1/reviews")
        .set(bearer(fixture.customerToken))
        .send(payload),
    ]);

    expect([first.status, second.status].sort((left, right) => left - right)).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error.code).toBe(REVIEWS_ERROR_CODE.ALREADY_EXISTS);

    const created = first.status === 201 ? first.body.data : second.body.data;
    expect(created).toMatchObject({
      orderItemId: fixture.orderItemId,
      sellerId: fixture.sellerId,
      storeId: fixture.storeId,
      status: REVIEW_STATUS.PUBLISHED,
      verifiedPurchase: true,
    });
  });

  it("keeps customer edits owner-only and exposes only privacy-safe published Review cards", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const review = await createReviewViaHttp(fixture.customerToken, {
      orderItemId: fixture.orderItemId,
      rating: 4,
      title: "Original title",
      body: "Customer-owned Review.",
    });
    const otherCustomer = await createSecondReviewCustomer();

    const denied = await request(createApp())
      .patch(`/api/v1/reviews/${review.id}`)
      .set(bearer(otherCustomer.token))
      .send({ title: "Must not be allowed" })
      .expect(403);
    expect(denied.body.error.code).toBe(REVIEWS_ERROR_CODE.SCOPE_FORBIDDEN);

    await request(createApp())
      .patch(`/api/v1/reviews/${review.id}`)
      .set(bearer(fixture.sellerToken))
      .send({ title: "Seller must not edit customer content" })
      .expect(403);

    const updated = await updateReviewViaHttp(fixture.customerToken, review.id, {
      rating: 5,
      title: "Updated by owner",
    });
    expect(updated).toMatchObject({ id: review.id, rating: 5, title: "Updated by owner" });

    const productPage = await listProductReviewsViaHttp(review.productId);
    expect(productPage.rating).toEqual({ ratingAvg: 5, ratingCount: 1 });
    expect(productPage.reviews).toHaveLength(1);
    expect(productPage.reviews[0]).toMatchObject({
      id: review.id,
      rating: 5,
      verifiedPurchase: true,
    });
    expect(productPage.reviews[0]).not.toHaveProperty("customerUserId");
    expect(productPage.reviews[0]).not.toHaveProperty("orderItemId");
    expect(productPage.reviews[0]).not.toHaveProperty("sellerId");

    const storePage = await listStoreReviewsViaHttp(fixture.storeId);
    expect(storePage.reviews[0]?.id).toBe(review.id);
    expect(storePage.rating).toEqual({ ratingAvg: 5, ratingCount: 1 });
  });

  it("lists a bounded privacy-safe moderation queue only for authorized admins", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const review = await createReviewViaHttp(fixture.customerToken, {
      orderItemId: fixture.orderItemId,
      rating: 5,
      title: "Admin queue proof",
      body: "Only moderation-safe fields may leave the API.",
    });

    await request(createApp())
      .get("/api/v1/admin/reviews")
      .set(bearer(fixture.customerToken))
      .expect(403);

    const response = await request(createApp())
      .get("/api/v1/admin/reviews")
      .query({
        status: "published",
        productId: review.productId,
        sellerId: review.sellerId,
        storeId: review.storeId,
        page: 1,
        pageSize: 20,
        sort: "created_desc",
      })
      .set(bearer(fixture.captured.order.adminToken))
      .expect(200);

    expect(response.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: review.id,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      status: REVIEW_STATUS.PUBLISHED,
    });
    for (const privateField of [
      "customerUserId",
      "orderItemId",
      "customerEmail",
      "email",
      "address",
      "accessToken",
      "refreshToken",
      "payment",
    ]) {
      expect(response.body.data[0]).not.toHaveProperty(privateField);
    }

    await request(createApp())
      .get("/api/v1/admin/reviews")
      .query({ customerUserId: fixture.customerUserId })
      .set(bearer(fixture.captured.order.adminToken))
      .expect(422);
  });

  it("keeps Helpful and moderation commands replay-safe while aggregates follow published state", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const review = await createReviewViaHttp(fixture.customerToken, {
      orderItemId: fixture.orderItemId,
      rating: 5,
      title: "Moderation proof",
    });
    const otherCustomer = await createSecondReviewCustomer();

    await expect(markReviewHelpfulViaHttp(otherCustomer.token, review.id)).resolves.toMatchObject({
      helpfulCount: 1,
      markedHelpful: true,
    });
    await expect(markReviewHelpfulViaHttp(otherCustomer.token, review.id)).resolves.toMatchObject({
      helpfulCount: 1,
      markedHelpful: true,
    });
    await expect(countHelpfulVotes(review.id)).resolves.toBe(1);

    await request(createApp())
      .post(`/api/v1/admin/reviews/${review.id}/hide`)
      .set(bearer(fixture.customerToken))
      .send({ reason: "Customer cannot moderate" })
      .expect(403);

    const hidden = await hideReviewViaHttp(
      fixture.captured.order.adminToken,
      review.id,
      "Confirmed abuse",
    );
    expect(hidden.status).toBe(REVIEW_STATUS.HIDDEN);
    await hideReviewViaHttp(
      fixture.captured.order.adminToken,
      review.id,
      "Replay must remain a no-op",
    );
    await expect(countModerationHistory(review.id, "hide")).resolves.toBe(1);

    const hiddenPage = await listProductReviewsViaHttp(review.productId);
    expect(hiddenPage.reviews).toEqual([]);
    expect(hiddenPage.rating).toEqual({ ratingAvg: 0, ratingCount: 0 });
    await expect(readProductRatingAggregate(review.productId)).resolves.toMatchObject({
      ratingAvg: "0.00",
      ratingCount: 0,
    });

    const published = await publishReviewViaHttp(
      fixture.captured.order.adminToken,
      review.id,
      "Content cleared",
    );
    expect(published.status).toBe(REVIEW_STATUS.PUBLISHED);
    await expect(countModerationHistory(review.id, "publish")).resolves.toBe(1);

    const publishedPage = await listProductReviewsViaHttp(review.productId);
    expect(publishedPage.reviews).toHaveLength(1);
    expect(publishedPage.rating).toEqual({ ratingAvg: 5, ratingCount: 1 });
  });
});

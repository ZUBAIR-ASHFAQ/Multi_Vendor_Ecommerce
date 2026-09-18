import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { databasePool } from "../../src/database/db.js";
import type {
  PublicReviewsListData,
  ReviewResponse,
} from "../../src/modules/reviews/reviews.schema.js";
import {
  bearer,
  loginUser,
  registerCustomer,
} from "../module13/module13.test-helpers.js";
import { resetModule11Tables } from "../module11/module11.test-helpers.js";
import { resetModule14Tables } from "../module14/module14.test-helpers.js";

/** Immutable purchase identities required to seed persistence-only Review repository tests. */
export interface ReviewOrderItemFacts {
  orderItemId: string;
  productId: string;
  sellerId: string;
  storeId: string;
}

/** Clears Module 15 rows first, then resets the released Orders prerequisite fixtures. */
export async function resetModule15Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      review_helpful_votes,
      review_moderation_history,
      rating_aggregates,
      reviews
    RESTART IDENTITY CASCADE
  `);
  await resetModule11Tables();
}

/** Clears Module 15 plus Search read-model rows before rebuilding a fully delivered prerequisite fixture. */
export async function resetModule15IntegrationTables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      review_helpful_votes,
      review_moderation_history,
      rating_aggregates,
      reviews,
      product_search_documents,
      search_synonyms,
      search_reindex_runs
    RESTART IDENTITY CASCADE
  `);
  await resetModule14Tables();
}

/** Reads immutable purchased Product/Seller/Store identities for one prepared Order. */
export async function readReviewOrderItemFacts(
  orderId: string,
): Promise<ReviewOrderItemFacts[]> {
  const result = await databasePool.query<{
    order_item_id: string;
    product_id: string;
    seller_id: string;
    store_id: string;
  }>(
    `select item.id as order_item_id,
            item.product_id,
            seller_order.seller_id,
            seller_order.store_id
       from order_items item
       join seller_orders seller_order on seller_order.id = item.seller_order_id
      where item.order_id = $1
      order by item.id asc`,
    [orderId],
  );

  return result.rows.map((row) => ({
    orderItemId: row.order_item_id,
    productId: row.product_id,
    sellerId: row.seller_id,
    storeId: row.store_id,
  }));
}

/** Creates one verified Review through the published customer HTTP command. */
export async function createReviewViaHttp(
  customerToken: string,
  input: { orderItemId: string; rating: number; title?: string; body?: string },
): Promise<ReviewResponse> {
  const response = await request(createApp())
    .post("/api/v1/reviews")
    .set(bearer(customerToken))
    .send(input)
    .expect(201);
  return response.body.data as ReviewResponse;
}

/** Updates only customer-authored Review fields through the published own-Review route. */
export async function updateReviewViaHttp(
  customerToken: string,
  reviewId: string,
  input: { rating?: number; title?: string | null; body?: string | null },
): Promise<ReviewResponse> {
  const response = await request(createApp())
    .patch(`/api/v1/reviews/${reviewId}`)
    .set(bearer(customerToken))
    .send(input)
    .expect(200);
  return response.body.data as ReviewResponse;
}

/** Reads one public Product Review page through the anonymous-safe storefront route. */
export async function listProductReviewsViaHttp(
  productId: string,
): Promise<PublicReviewsListData> {
  const response = await request(createApp())
    .get(`/api/v1/products/${productId}/reviews`)
    .query({ page: 1, pageSize: 20 })
    .expect(200);
  return response.body.data as PublicReviewsListData;
}

/** Reads one public Store Review page and its canonical Seller aggregate. */
export async function listStoreReviewsViaHttp(
  storeId: string,
): Promise<PublicReviewsListData> {
  const response = await request(createApp())
    .get(`/api/v1/stores/${storeId}/reviews`)
    .query({ page: 1, pageSize: 20 })
    .expect(200);
  return response.body.data as PublicReviewsListData;
}

/** Marks one published Review Helpful and returns the replay-safe resulting count. */
export async function markReviewHelpfulViaHttp(
  accessToken: string,
  reviewId: string,
): Promise<{ reviewId: string; helpfulCount: number; markedHelpful: true }> {
  const response = await request(createApp())
    .post(`/api/v1/reviews/${reviewId}/helpful`)
    .set(bearer(accessToken))
    .send({})
    .expect(200);
  return response.body.data as {
    reviewId: string;
    helpfulCount: number;
    markedHelpful: true;
  };
}

/** Hides one Review through the privileged explicit moderation command. */
export async function hideReviewViaHttp(
  adminToken: string,
  reviewId: string,
  reason = "Hidden by Module 15 backend proof",
): Promise<ReviewResponse> {
  const response = await request(createApp())
    .post(`/api/v1/admin/reviews/${reviewId}/hide`)
    .set(bearer(adminToken))
    .send({ reason })
    .expect(200);
  return response.body.data as ReviewResponse;
}

/** Publishes one Review through the privileged explicit moderation command. */
export async function publishReviewViaHttp(
  adminToken: string,
  reviewId: string,
  reason = "Published by Module 15 backend proof",
): Promise<ReviewResponse> {
  const response = await request(createApp())
    .post(`/api/v1/admin/reviews/${reviewId}/publish`)
    .set(bearer(adminToken))
    .send({ reason })
    .expect(200);
  return response.body.data as ReviewResponse;
}

/** Creates a second real Customer identity for customer-to-customer isolation proof. */
export async function createSecondReviewCustomer(): Promise<{
  userId: string;
  token: string;
}> {
  const user = await registerCustomer(`module15-other-${randomUUID()}@example.com`);
  return { userId: user.id, token: await loginUser(user) };
}

/** Counts persisted Helpful votes so replay safety is proven at the database boundary. */
export async function countHelpfulVotes(reviewId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    "select count(*)::int as count from review_helpful_votes where review_id = $1",
    [reviewId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts append-only moderation history rows for one Review and action. */
export async function countModerationHistory(
  reviewId: string,
  action: "hide" | "publish",
): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from review_moderation_history
      where review_id = $1 and action = $2`,
    [reviewId, action],
  );
  return result.rows[0]?.count ?? 0;
}

/** Reads one Product aggregate directly for after-write reconciliation proof. */
export async function readProductRatingAggregate(productId: string): Promise<{
  ratingAvg: string;
  ratingCount: number;
} | null> {
  const result = await databasePool.query<{ rating_avg: string; rating_count: number }>(
    `select rating_avg, rating_count
       from rating_aggregates
      where entity_type = 'product' and entity_id = $1`,
    [productId],
  );
  const row = result.rows[0];
  return row ? { ratingAvg: row.rating_avg, ratingCount: row.rating_count } : null;
}

/** Reads the latest durable rating event emitted for one Product aggregate. */
export async function readLatestRatingAggregateEvent(productId: string): Promise<{
  eventType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
} | null> {
  const result = await databasePool.query<{
    event_type: string;
    aggregate_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `select event_type, aggregate_id, payload
       from outbox_events
      where event_type = 'rating.aggregate_updated'
        and aggregate_id = $1
      order by created_at desc, id desc
      limit 1`,
    [productId],
  );
  const row = result.rows[0];
  return row
    ? { eventType: row.event_type, aggregateId: row.aggregate_id, payload: row.payload }
    : null;
}

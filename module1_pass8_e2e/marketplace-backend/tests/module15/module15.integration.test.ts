import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool } from "../../src/database/db.js";
import { ReviewsService } from "../../src/modules/reviews/reviews.service.js";
import { SearchDiscoveryService } from "../../src/modules/search-discovery/search-discovery.service.js";
import { prepareDeliveredReturnFixture } from "../module14/module14.test-helpers.js";
import {
  createReviewViaHttp,
  hideReviewViaHttp,
  readLatestRatingAggregateEvent,
  resetModule15IntegrationTables,
} from "./module15.test-helpers.js";

beforeEach(async () => {
  await resetModule15IntegrationTables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Reads the public Search rating fields materialized for one Product. */
async function readSearchRating(productId: string): Promise<{
  ratingAvg: string;
  ratingCount: number;
} | null> {
  const result = await databasePool.query<{ rating_avg: string; rating_count: number }>(
    `select rating_avg, rating_count
       from product_search_documents
      where product_id = $1`,
    [productId],
  );
  const row = result.rows[0];
  return row ? { ratingAvg: row.rating_avg, ratingCount: row.rating_count } : null;
}

describe("Module 15 Reviews to Search integration", () => {
  it("propagates published and hidden rating.aggregate_updated events into the Search read model", async () => {
    const fixture = await prepareDeliveredReturnFixture(1);
    const review = await createReviewViaHttp(fixture.customerToken, {
      orderItemId: fixture.orderItemId,
      rating: 5,
      title: "Search rating source",
    });

    const publishedEvent = await readLatestRatingAggregateEvent(review.productId);
    if (!publishedEvent?.aggregateId) {
      throw new Error("Expected published rating event with an aggregate ID.");
    }

    expect(publishedEvent).toMatchObject({
      eventType: "rating.aggregate_updated",
      aggregateId: review.productId,
      payload: expect.objectContaining({
        productId: review.productId,
        productRatingAvg: "5.00",
        productRatingCount: 1,
      }),
    });

    const search = new SearchDiscoveryService({ ratings: new ReviewsService() });
    await expect(
      search.handleSourceEvent({
        eventType: publishedEvent.eventType,
        aggregateId: publishedEvent.aggregateId,
        payload: publishedEvent.payload,
      }),
    ).resolves.toBe("synchronized");
    await expect(readSearchRating(review.productId)).resolves.toMatchObject({
      ratingAvg: "5.00",
      ratingCount: 1,
    });

    await hideReviewViaHttp(
      fixture.captured.order.adminToken,
      review.id,
      "Hide rating source",
    );
    const hiddenEvent = await readLatestRatingAggregateEvent(review.productId);
    if (!hiddenEvent?.aggregateId) {
      throw new Error("Expected hidden rating event with an aggregate ID.");
    }

    expect(hiddenEvent).toMatchObject({
      eventType: "rating.aggregate_updated",
      aggregateId: review.productId,
      payload: expect.objectContaining({
        productId: review.productId,
        productRatingAvg: "0.00",
        productRatingCount: 0,
      }),
    });

    await expect(
      search.handleSourceEvent({
        eventType: hiddenEvent.eventType,
        aggregateId: hiddenEvent.aggregateId,
        payload: hiddenEvent.payload,
      }),
    ).resolves.toBe("synchronized");
    await expect(readSearchRating(review.productId)).resolves.toMatchObject({
      ratingAvg: "0.00",
      ratingCount: 0,
    });
  });
});

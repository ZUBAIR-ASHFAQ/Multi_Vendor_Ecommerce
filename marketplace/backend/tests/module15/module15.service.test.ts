import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACTOR_TYPE, type PermissionCode } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type {
  RatingAggregateRow,
  ReviewRow,
} from "../../src/database/schema/reviews.js";
import type { DatabaseTransaction } from "../../src/database/types.js";
import {
  REVIEW_RATING_ENTITY,
  REVIEW_STATUS,
  REVIEWS_ERROR_CODE,
  REVIEWS_OUTBOX_EVENT,
  REVIEWS_PERMISSION,
} from "../../src/modules/reviews/reviews.constants.js";
import { ReviewsRepository } from "../../src/modules/reviews/reviews.repository.js";
import {
  ReviewsService,
  type ReviewsAuditIntegration,
  type ReviewsOrdersIntegration,
  type ReviewsOutboxIntegration,
  type ReviewsShippingIntegration,
} from "../../src/modules/reviews/reviews.service.js";

const NOW = new Date("2026-09-15T18:30:00.000Z");

/** Runs service transactions immediately so focused business-rule tests do not need PostgreSQL. */
function immediateTransactionRunner<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return work({} as DatabaseTransaction);
}

/** Builds one Customer request context with only the requested Review permissions. */
function customerContext(
  actorId = randomUUID(),
  permissions: PermissionCode[] = [
    REVIEWS_PERMISSION.CREATE_VERIFIED,
    REVIEWS_PERMISSION.UPDATE_OWN,
    REVIEWS_PERMISSION.PUBLIC_READ,
  ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one Seller request context to prove sellers cannot mutate Customer-authored Reviews. */
function sellerContext(actorId = randomUUID()): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set([
      REVIEWS_PERMISSION.UPDATE_OWN,
      REVIEWS_PERMISSION.PUBLIC_READ,
    ]),
    sellerIds: new Set([randomUUID()]),
    storeIds: new Set([randomUUID()]),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one Platform Admin context for the explicit moderation commands. */
function adminContext(
  actorId = randomUUID(),
  includePermission = true,
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(
      includePermission ? [REVIEWS_PERMISSION.ADMIN_MODERATE] : [],
    ),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one persistence-shaped Review row for service orchestration tests. */
function reviewRow(input: Partial<ReviewRow> = {}): ReviewRow {
  const createdAt = input.createdAt ?? NOW;
  const status = input.status ?? REVIEW_STATUS.PUBLISHED;
  return {
    id: input.id ?? randomUUID(),
    customerUserId: input.customerUserId ?? randomUUID(),
    orderItemId: input.orderItemId ?? randomUUID(),
    productId: input.productId ?? randomUUID(),
    sellerId: input.sellerId ?? randomUUID(),
    storeId: input.storeId ?? randomUUID(),
    rating: input.rating ?? 5,
    title: input.title ?? "Excellent purchase",
    body: input.body ?? "Verified Review service proof.",
    status,
    verifiedPurchase: true,
    publishedAt:
      input.publishedAt !== undefined
        ? input.publishedAt
        : status === REVIEW_STATUS.PUBLISHED
          ? createdAt
          : null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

/** Builds one persistence-shaped aggregate row returned by recalculation. */
function aggregateRow(
  entityType: "product" | "seller",
  entityId: string,
  ratingAvg = "5.00",
  ratingCount = 1,
): RatingAggregateRow {
  return {
    entityType,
    entityId,
    ratingAvg,
    ratingCount,
    updatedAt: NOW,
  };
}

/** Creates the small repository surface used by focused Review service tests. */
function repositoryStub(
  overrides: Partial<Record<keyof ReviewsRepository, unknown>> = {},
): ReviewsRepository {
  return {
    findReviewByOrderItemId: vi.fn().mockResolvedValue(null),
    findReviewByIdForUpdate: vi.fn().mockResolvedValue(null),
    findOwnedReviewByIdForUpdate: vi.fn().mockResolvedValue(null),
    createReviewIfMissing: vi.fn().mockResolvedValue(null),
    updateOwnedReview: vi.fn().mockResolvedValue(null),
    updateReviewLifecycle: vi.fn().mockResolvedValue(null),
    createHelpfulVoteIfMissing: vi.fn().mockResolvedValue(true),
    countHelpfulVotes: vi.fn().mockResolvedValue(0),
    appendModerationHistory: vi.fn().mockResolvedValue(randomUUID()),
    recalculateRatingAggregate: vi.fn().mockResolvedValue(null),
    findRatingAggregate: vi.fn().mockResolvedValue(null),
    listRatingAggregates: vi.fn().mockResolvedValue([]),
    listAdminReviews: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    ...overrides,
  } as unknown as ReviewsRepository;
}

/** Creates no-op immutable evidence boundaries while retaining spies for assertions. */
function evidenceBoundaries(): {
  audit: ReviewsAuditIntegration;
  outbox: ReviewsOutboxIntegration;
} {
  return {
    audit: { record: vi.fn().mockResolvedValue(randomUUID()) },
    outbox: { enqueue: vi.fn().mockResolvedValue(randomUUID()) },
  };
}

/** Builds one immutable purchased item snapshot derived from Orders. */
function purchaseSnapshot(input: {
  customerUserId?: string;
  quantity?: number;
  cancelledQuantity?: number;
} = {}) {
  return {
    orderId: randomUUID(),
    customerUserId: input.customerUserId ?? randomUUID(),
    orderItemId: randomUUID(),
    productId: randomUUID(),
    sellerId: randomUUID(),
    storeId: randomUUID(),
    quantity: input.quantity ?? 1,
    cancelledQuantity: input.cancelledQuantity ?? 0,
  };
}

describe("Module 15 Reviews service business rules", () => {
  it("returns bounded published Product rating aggregates with zero defaults", async () => {
    const ratedProductId = randomUUID();
    const unratedProductId = randomUUID();
    const repository = repositoryStub({
      listRatingAggregates: vi.fn().mockResolvedValue([
        aggregateRow(REVIEW_RATING_ENTITY.PRODUCT, ratedProductId, "4.25", 8),
      ]),
    });
    const service = new ReviewsService({ repository });

    const result = await service.getPublishedRatingAggregates([
      ratedProductId,
      unratedProductId,
    ]);

    expect(result).toEqual(new Map([
      [ratedProductId, { average: 4.25, count: 8 }],
      [unratedProductId, { average: 0, count: 0 }],
    ]));
  });

  it("creates a server-derived verified Review only after owned purchase and full-delivery checks", async () => {
    const customerUserId = randomUUID();
    const context = customerContext(customerUserId, [REVIEWS_PERMISSION.CREATE_VERIFIED]);
    const purchase = purchaseSnapshot({ customerUserId, quantity: 2 });
    const created = reviewRow({
      customerUserId,
      orderItemId: purchase.orderItemId,
      productId: purchase.productId,
      sellerId: purchase.sellerId,
      storeId: purchase.storeId,
      rating: 5,
    });
    const repository = repositoryStub({
      createReviewIfMissing: vi.fn().mockResolvedValue(created),
      recalculateRatingAggregate: vi
        .fn()
        .mockResolvedValueOnce(
          aggregateRow(REVIEW_RATING_ENTITY.PRODUCT, purchase.productId),
        )
        .mockResolvedValueOnce(
          aggregateRow(REVIEW_RATING_ENTITY.SELLER, purchase.sellerId),
        ),
    });
    const orders: ReviewsOrdersIntegration = {
      getReviewEligibilitySnapshot: vi.fn().mockResolvedValue(purchase),
    };
    const shipping: ReviewsShippingIntegration = {
      getReviewDeliverySnapshot: vi.fn().mockResolvedValue({
        orderItemId: purchase.orderItemId,
        deliveredQuantity: 2,
        latestDeliveredAt: NOW.toISOString(),
      }),
    };
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReviewsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => orders,
      shippingUsingTransaction: () => shipping,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      now: () => NOW,
      moderationRequired: false,
    });

    const result = await service.createReview(context, {
      orderItemId: purchase.orderItemId,
      rating: 5,
      title: "Excellent purchase",
      body: "Verified Review service proof.",
    });

    expect(result).toMatchObject({
      orderItemId: purchase.orderItemId,
      productId: purchase.productId,
      sellerId: purchase.sellerId,
      storeId: purchase.storeId,
      status: REVIEW_STATUS.PUBLISHED,
      verifiedPurchase: true,
    });
    expect(repository.createReviewIfMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUserId,
        orderItemId: purchase.orderItemId,
        productId: purchase.productId,
        sellerId: purchase.sellerId,
        storeId: purchase.storeId,
      }),
    );
    expect(shipping.getReviewDeliverySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: ACTOR_TYPE.SYSTEM }),
      purchase.orderId,
      purchase.orderItemId,
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: REVIEWS_OUTBOX_EVENT.CREATED }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: REVIEWS_OUTBOX_EVENT.PUBLISHED }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: REVIEWS_OUTBOX_EVENT.RATING_AGGREGATE_UPDATED,
        aggregateId: purchase.productId,
      }),
    );
  });

  it("rejects foreign, cancelled, and incompletely delivered purchases before Review persistence", async () => {
    const customerUserId = randomUUID();
    const context = customerContext(customerUserId, [REVIEWS_PERMISSION.CREATE_VERIFIED]);
    const foreignPurchase = purchaseSnapshot({ customerUserId: randomUUID() });
    const foreignRepository = repositoryStub();
    const foreignShipping: ReviewsShippingIntegration = {
      getReviewDeliverySnapshot: vi.fn(),
    };
    const foreignService = new ReviewsService({
      repositoryUsingTransaction: () => foreignRepository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({
        getReviewEligibilitySnapshot: vi.fn().mockResolvedValue(foreignPurchase),
      }),
      shippingUsingTransaction: () => foreignShipping,
    });

    await expect(
      foreignService.createReview(context, {
        orderItemId: foreignPurchase.orderItemId,
        rating: 4,
      }),
    ).rejects.toMatchObject({ code: REVIEWS_ERROR_CODE.NOT_ELIGIBLE, statusCode: 409 });
    expect(foreignShipping.getReviewDeliverySnapshot).not.toHaveBeenCalled();
    expect(foreignRepository.createReviewIfMissing).not.toHaveBeenCalled();

    const undeliveredPurchase = purchaseSnapshot({ customerUserId, quantity: 2 });
    const undeliveredRepository = repositoryStub();
    const undeliveredService = new ReviewsService({
      repositoryUsingTransaction: () => undeliveredRepository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({
        getReviewEligibilitySnapshot: vi.fn().mockResolvedValue(undeliveredPurchase),
      }),
      shippingUsingTransaction: () => ({
        getReviewDeliverySnapshot: vi.fn().mockResolvedValue({
          orderItemId: undeliveredPurchase.orderItemId,
          deliveredQuantity: 1,
          latestDeliveredAt: NOW.toISOString(),
        }),
      }),
    });

    await expect(
      undeliveredService.createReview(context, {
        orderItemId: undeliveredPurchase.orderItemId,
        rating: 4,
      }),
    ).rejects.toMatchObject({ code: REVIEWS_ERROR_CODE.NOT_ELIGIBLE, statusCode: 409 });
    expect(undeliveredRepository.createReviewIfMissing).not.toHaveBeenCalled();

    const cancelledPurchase = purchaseSnapshot({
      customerUserId,
      quantity: 1,
      cancelledQuantity: 1,
    });
    const cancelledRepository = repositoryStub();
    const cancelledService = new ReviewsService({
      repositoryUsingTransaction: () => cancelledRepository,
      transactionRunner: immediateTransactionRunner,
      ordersUsingTransaction: () => ({
        getReviewEligibilitySnapshot: vi.fn().mockResolvedValue(cancelledPurchase),
      }),
      shippingUsingTransaction: () => ({ getReviewDeliverySnapshot: vi.fn() }),
    });

    await expect(
      cancelledService.createReview(context, {
        orderItemId: cancelledPurchase.orderItemId,
        rating: 4,
      }),
    ).rejects.toMatchObject({ code: REVIEWS_ERROR_CODE.NOT_ELIGIBLE, statusCode: 409 });
    expect(cancelledRepository.createReviewIfMissing).not.toHaveBeenCalled();
  });

  it("keeps customer edits owner-only and returns published Reviews to pending when moderation is required", async () => {
    const customerUserId = randomUUID();
    const current = reviewRow({ customerUserId, rating: 4 });
    const updated = reviewRow({
      ...current,
      rating: 5,
      status: REVIEW_STATUS.PENDING,
      publishedAt: null,
      updatedAt: new Date(NOW.getTime() + 1_000),
    });
    const repository = repositoryStub({
      findOwnedReviewByIdForUpdate: vi.fn().mockResolvedValue(current),
      updateOwnedReview: vi.fn().mockResolvedValue(updated),
      countHelpfulVotes: vi.fn().mockResolvedValue(2),
      recalculateRatingAggregate: vi
        .fn()
        .mockResolvedValueOnce(aggregateRow(REVIEW_RATING_ENTITY.PRODUCT, current.productId, "0.00", 0))
        .mockResolvedValueOnce(aggregateRow(REVIEW_RATING_ENTITY.SELLER, current.sellerId, "0.00", 0)),
    });
    const { audit, outbox } = evidenceBoundaries();
    const service = new ReviewsService({
      repositoryUsingTransaction: () => repository,
      transactionRunner: immediateTransactionRunner,
      auditUsingTransaction: () => audit,
      outboxUsingTransaction: () => outbox,
      moderationRequired: true,
      now: () => updated.updatedAt,
    });

    await expect(
      service.updateOwnReview(sellerContext(), current.id, { rating: 5 }),
    ).rejects.toMatchObject({ code: REVIEWS_ERROR_CODE.SCOPE_FORBIDDEN, statusCode: 403 });

    const result = await service.updateOwnReview(
      customerContext(customerUserId, [REVIEWS_PERMISSION.UPDATE_OWN]),
      current.id,
      { rating: 5 },
    );

    expect(result).toMatchObject({
      id: current.id,
      rating: 5,
      status: REVIEW_STATUS.PENDING,
      publishedAt: null,
      helpfulCount: 2,
    });
    expect(repository.updateOwnedReview).toHaveBeenCalledWith(
      current.id,
      customerUserId,
      expect.objectContaining({
        rating: 5,
        status: REVIEW_STATUS.PENDING,
        publishedAt: null,
      }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: REVIEWS_OUTBOX_EVENT.RATING_AGGREGATE_UPDATED }),
    );
  });

  it("lists only moderation-safe fields for actors with the admin moderation permission", async () => {
    const review = reviewRow({ status: REVIEW_STATUS.PENDING, publishedAt: null });
    const adminRow = {
      id: review.id,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      helpfulCount: 2,
      publishedAt: review.publishedAt,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    } as const;
    const query = {
      page: 1,
      pageSize: 20,
      status: REVIEW_STATUS.PENDING,
      sort: "created_desc" as const,
    };
    const repository = repositoryStub({
      listAdminReviews: vi.fn().mockResolvedValue({ items: [adminRow], totalItems: 1 }),
    });
    const service = new ReviewsService({ repository });

    await expect(
      service.listAdminReviews(adminContext(randomUUID(), false), query),
    ).rejects.toMatchObject({ statusCode: 403 });

    const result = await service.listAdminReviews(adminContext(), query);
    expect(result.meta).toMatchObject({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({
      id: review.id,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      status: REVIEW_STATUS.PENDING,
      helpfulCount: 2,
    });
    expect(result.items[0]).not.toHaveProperty("customerUserId");
    expect(result.items[0]).not.toHaveProperty("orderItemId");
    expect(result.items[0]).not.toHaveProperty("customerEmail");
    expect(repository.listAdminReviews).toHaveBeenCalledWith(query);
  });

  it("keeps Helpful replay-safe and moderation idempotent while refreshing published aggregates", async () => {
    const published = reviewRow({ rating: 4 });
    const hidden = reviewRow({ ...published, status: REVIEW_STATUS.HIDDEN, publishedAt: null });
    const helpfulRepository = repositoryStub({
      findReviewByIdForUpdate: vi.fn().mockResolvedValue(published),
      createHelpfulVoteIfMissing: vi.fn().mockResolvedValue(false),
      countHelpfulVotes: vi.fn().mockResolvedValue(1),
    });
    const helpfulService = new ReviewsService({
      repositoryUsingTransaction: () => helpfulRepository,
      transactionRunner: immediateTransactionRunner,
    });

    await expect(
      helpfulService.markReviewHelpful(
        customerContext(randomUUID(), [REVIEWS_PERMISSION.PUBLIC_READ]),
        published.id,
      ),
    ).resolves.toEqual({ reviewId: published.id, helpfulCount: 1, markedHelpful: true });
    expect(helpfulRepository.createHelpfulVoteIfMissing).toHaveBeenCalledTimes(1);

    const moderationRepository = repositoryStub({
      findReviewByIdForUpdate: vi.fn().mockResolvedValue(published),
      updateReviewLifecycle: vi.fn().mockResolvedValue(hidden),
      countHelpfulVotes: vi.fn().mockResolvedValue(1),
      recalculateRatingAggregate: vi
        .fn()
        .mockResolvedValueOnce(aggregateRow(REVIEW_RATING_ENTITY.PRODUCT, published.productId, "0.00", 0))
        .mockResolvedValueOnce(aggregateRow(REVIEW_RATING_ENTITY.SELLER, published.sellerId, "0.00", 0)),
    });
    const evidence = evidenceBoundaries();
    const moderationService = new ReviewsService({
      repositoryUsingTransaction: () => moderationRepository,
      transactionRunner: immediateTransactionRunner,
      auditUsingTransaction: () => evidence.audit,
      outboxUsingTransaction: () => evidence.outbox,
      now: () => NOW,
    });

    const result = await moderationService.hideReview(
      adminContext(),
      published.id,
      { reason: "Abusive content" },
    );
    expect(result.status).toBe(REVIEW_STATUS.HIDDEN);
    expect(moderationRepository.appendModerationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: published.id, action: "hide", reason: "Abusive content" }),
    );
    expect(evidence.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: REVIEWS_OUTBOX_EVENT.HIDDEN }),
    );
    expect(evidence.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: REVIEWS_OUTBOX_EVENT.RATING_AGGREGATE_UPDATED }),
    );

    const repeatRepository = repositoryStub({
      findReviewByIdForUpdate: vi.fn().mockResolvedValue(hidden),
      countHelpfulVotes: vi.fn().mockResolvedValue(1),
    });
    const repeatEvidence = evidenceBoundaries();
    const repeatService = new ReviewsService({
      repositoryUsingTransaction: () => repeatRepository,
      transactionRunner: immediateTransactionRunner,
      auditUsingTransaction: () => repeatEvidence.audit,
      outboxUsingTransaction: () => repeatEvidence.outbox,
    });
    await expect(
      repeatService.hideReview(adminContext(), hidden.id, { reason: "Replay" }),
    ).resolves.toMatchObject({ status: REVIEW_STATUS.HIDDEN });
    expect(repeatRepository.updateReviewLifecycle).not.toHaveBeenCalled();
    expect(repeatRepository.appendModerationHistory).not.toHaveBeenCalled();
    expect(repeatEvidence.audit.record).not.toHaveBeenCalled();
    expect(repeatEvidence.outbox.enqueue).not.toHaveBeenCalled();

    await expect(
      repeatService.publishReview(adminContext(randomUUID(), false), hidden.id, {
        reason: "No permission",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

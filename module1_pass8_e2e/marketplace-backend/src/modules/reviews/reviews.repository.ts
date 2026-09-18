import {
  and,
  asc,
  count,
  desc,
  eq,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import {
  ratingAggregates,
  reviewHelpfulVotes,
  reviewModerationHistory,
  reviews,
  type NewRatingAggregateRow,
  type NewReviewHelpfulVoteRow,
  type NewReviewModerationHistoryRow,
  type NewReviewRow,
  type RatingAggregateRow,
  type ReviewModerationHistoryRow,
  type ReviewRow,
} from "../../database/schema/reviews.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  REVIEW_RATING_ENTITY,
  REVIEW_STATUS,
} from "./reviews.constants.js";
import type {
  AdminReviewsListQuery,
  PublicReviewsListQuery,
} from "./reviews.schema.js";

type ReviewRatingEntity =
  (typeof REVIEW_RATING_ENTITY)[keyof typeof REVIEW_RATING_ENTITY];
type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

/** Service-approved fields required to persist one verified Review. */
export interface CreateReviewRecordInput {
  customerUserId: string;
  orderItemId: string;
  productId: string;
  sellerId: string;
  storeId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  status: ReviewStatus;
  publishedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Service-approved customer edit fields, including any lifecycle change caused by the edit policy. */
export interface UpdateOwnedReviewRecordInput {
  rating?: number;
  title?: string | null;
  body?: string | null;
  status?: ReviewStatus;
  publishedAt?: Date | null;
  updatedAt?: Date;
}

/** Service-approved privileged lifecycle change for one Review. */
export interface UpdateReviewLifecycleRecordInput {
  status: ReviewStatus;
  publishedAt: Date | null;
  updatedAt?: Date;
}

/** Append-only moderation decision already authorized by the service. */
export interface AppendReviewModerationHistoryInput {
  reviewId: string;
  action: "hide" | "publish";
  moderatorUserId: string;
  reason: string;
  createdAt?: Date;
}

/** Public Review row with a derived Helpful count and no private customer/order identity. */
export interface PublicReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  verifiedPurchase: boolean;
  helpfulCount: number;
  publishedAt: Date;
  updatedAt: Date;
}

/** One bounded public Review page before the service attaches the matching rating summary. */
export interface PaginatedPublicReviewRows {
  items: PublicReviewRow[];
  totalItems: number;
}

/** Privacy-safe Review row returned to the admin moderation service. */
export interface AdminReviewRow {
  id: string;
  productId: string;
  sellerId: string;
  storeId: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: ReviewStatus;
  helpfulCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One bounded admin moderation page with a separate total count. */
export interface PaginatedAdminReviewRows {
  items: AdminReviewRow[];
  totalItems: number;
}

/** Creates the fixed public Review projection and derives Helpful count without exposing voter identity. */
function publicReviewSelection() {
  return {
    id: reviews.id,
    rating: reviews.rating,
    title: reviews.title,
    body: reviews.body,
    verifiedPurchase: reviews.verifiedPurchase,
    helpfulCount: sql<number>`(
      select count(*)::int
      from ${reviewHelpfulVotes} helpful_vote
      where helpful_vote.review_id = ${reviews.id}
    )`,
    publishedAt: sql<Date>`${reviews.publishedAt}`,
    updatedAt: reviews.updatedAt,
  };
}

/** Creates the fixed moderation projection without exposing customer identity or unrelated private data. */
function adminReviewSelection() {
  return {
    id: reviews.id,
    productId: reviews.productId,
    sellerId: reviews.sellerId,
    storeId: reviews.storeId,
    rating: reviews.rating,
    title: reviews.title,
    body: reviews.body,
    status: reviews.status,
    helpfulCount: sql<number>`(
      select count(*)::int
      from ${reviewHelpfulVotes} helpful_vote
      where helpful_vote.review_id = ${reviews.id}
    )`,
    publishedAt: reviews.publishedAt,
    createdAt: reviews.createdAt,
    updatedAt: reviews.updatedAt,
  };
}

/** Combines only active admin Review filters before they reach Drizzle. */
function adminReviewWhere(query: AdminReviewsListQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(reviews.status, query.status));
  if (query.productId) conditions.push(eq(reviews.productId, query.productId));
  if (query.sellerId) conditions.push(eq(reviews.sellerId, query.sellerId));
  if (query.storeId) conditions.push(eq(reviews.storeId, query.storeId));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Returns the approved deterministic admin Review sort order. */
function adminReviewOrder(query: AdminReviewsListQuery): SQL[] {
  const created = query.sort === "created_asc"
    ? asc(reviews.createdAt)
    : desc(reviews.createdAt);
  return [created, asc(reviews.id)];
}

/** Builds the persisted Review ownership predicate for one supported aggregate entity kind. */
function ratingEntityCondition(entityType: ReviewRatingEntity, entityId: string): SQL {
  return entityType === REVIEW_RATING_ENTITY.PRODUCT
    ? eq(reviews.productId, entityId)
    : eq(reviews.sellerId, entityId);
}

/**
 * Persistence-only Module 15 repository.
 * Eligibility, ownership decisions, moderation policy, audit/outbox, and Search orchestration stay in services.
 */
export class ReviewsRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): ReviewsRepository {
    return new ReviewsRepository(executor);
  }

  /** Reads one Review by its unique purchased Order Item identity. */
  async findReviewByOrderItemId(orderItemId: string): Promise<ReviewRow | null> {
    const [row] = await this.executor
      .select()
      .from(reviews)
      .where(eq(reviews.orderItemId, orderItemId))
      .limit(1);

    return row ?? null;
  }

  /** Locks one Review by ID before a lifecycle-sensitive service transaction. */
  async findReviewByIdForUpdate(reviewId: string): Promise<ReviewRow | null> {
    const [row] = await this.executor
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one Review only when it belongs to the authenticated customer. */
  async findOwnedReviewByIdForUpdate(
    reviewId: string,
    customerUserId: string,
  ): Promise<ReviewRow | null> {
    const [row] = await this.executor
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.customerUserId, customerUserId),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Inserts one verified Review and returns null when the Order Item already has a Review. */
  async createReviewIfMissing(input: CreateReviewRecordInput): Promise<ReviewRow | null> {
    const createdAt = input.createdAt ?? input.publishedAt ?? new Date();
    const values: NewReviewRow = {
      customerUserId: input.customerUserId,
      orderItemId: input.orderItemId,
      productId: input.productId,
      sellerId: input.sellerId,
      storeId: input.storeId,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
      status: input.status,
      verifiedPurchase: true,
      publishedAt: input.publishedAt ?? null,
      createdAt,
      updatedAt: input.updatedAt ?? createdAt,
    };

    const [row] = await this.executor
      .insert(reviews)
      .values(values)
      .onConflictDoNothing({ target: reviews.orderItemId })
      .returning();

    return row ?? null;
  }

  /** Persists customer-authored fields and any service-approved edit lifecycle change inside owner scope. */
  async updateOwnedReview(
    reviewId: string,
    customerUserId: string,
    input: UpdateOwnedReviewRecordInput,
  ): Promise<ReviewRow | null> {
    const { updatedAt, ...changes } = input;
    const [row] = await this.executor
      .update(reviews)
      .set({ ...changes, updatedAt: updatedAt ?? new Date() })
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.customerUserId, customerUserId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Persists only the lifecycle state already chosen by an authorized service command. */
  async updateReviewLifecycle(
    reviewId: string,
    input: UpdateReviewLifecycleRecordInput,
  ): Promise<ReviewRow | null> {
    const [row] = await this.executor
      .update(reviews)
      .set({
        status: input.status,
        publishedAt: input.publishedAt,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(reviews.id, reviewId))
      .returning();

    return row ?? null;
  }

  /** Lists published Product Reviews using bounded deterministic pagination and a public-safe projection. */
  async listPublishedProductReviews(
    productId: string,
    query: PublicReviewsListQuery,
  ): Promise<PaginatedPublicReviewRows> {
    return this.listPublishedReviews(eq(reviews.productId, productId), query);
  }

  /** Lists published Store Reviews using bounded deterministic pagination and a public-safe projection. */
  async listPublishedStoreReviews(
    storeId: string,
    query: PublicReviewsListQuery,
  ): Promise<PaginatedPublicReviewRows> {
    return this.listPublishedReviews(eq(reviews.storeId, storeId), query);
  }

  /** Lists permission-scoped moderation rows using only approved filters and a privacy-safe projection. */
  async listAdminReviews(
    query: AdminReviewsListQuery,
  ): Promise<PaginatedAdminReviewRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = adminReviewWhere(query);

    const items = await this.executor
      .select(adminReviewSelection())
      .from(reviews)
      .where(where)
      .orderBy(...adminReviewOrder(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(reviews)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Inserts one Helpful vote once; a replay for the same Review/user pair returns false. */
  async createHelpfulVoteIfMissing(reviewId: string, userId: string): Promise<boolean> {
    const values: NewReviewHelpfulVoteRow = { reviewId, userId };
    const [row] = await this.executor
      .insert(reviewHelpfulVotes)
      .values(values)
      .onConflictDoNothing({
        target: [reviewHelpfulVotes.reviewId, reviewHelpfulVotes.userId],
      })
      .returning({ reviewId: reviewHelpfulVotes.reviewId });

    return Boolean(row);
  }

  /** Counts Helpful votes for one Review without returning voter identities. */
  async countHelpfulVotes(reviewId: string): Promise<number> {
    const [row] = await this.executor
      .select({ totalItems: count() })
      .from(reviewHelpfulVotes)
      .where(eq(reviewHelpfulVotes.reviewId, reviewId));

    return Number(row?.totalItems ?? 0);
  }

  /** Appends one immutable moderation decision after the service has authorized the command. */
  async appendModerationHistory(
    input: AppendReviewModerationHistoryInput,
  ): Promise<ReviewModerationHistoryRow> {
    const values: NewReviewModerationHistoryRow = {
      reviewId: input.reviewId,
      action: input.action,
      moderatorUserId: input.moderatorUserId,
      reason: input.reason,
      createdAt: input.createdAt,
    };
    const [row] = await this.executor
      .insert(reviewModerationHistory)
      .values(values)
      .returning();

    if (!row) {
      throw new Error("Review moderation history insert completed without returning a row.");
    }

    return row;
  }

  /** Recalculates and persists one Product/Seller aggregate from current published Review rows only. */
  async recalculateRatingAggregate(
    entityType: ReviewRatingEntity,
    entityId: string,
    updatedAt = new Date(),
  ): Promise<RatingAggregateRow> {
    const [calculation] = await this.executor
      .select({
        ratingAvg: sql<string>`
          coalesce(round(avg(${reviews.rating})::numeric, 2), 0)::numeric(4, 2)::text
        `,
        ratingCount: count(),
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.status, REVIEW_STATUS.PUBLISHED),
          ratingEntityCondition(entityType, entityId),
        ),
      );

    const values: NewRatingAggregateRow = {
      entityType,
      entityId,
      ratingAvg: calculation?.ratingAvg ?? "0.00",
      ratingCount: Number(calculation?.ratingCount ?? 0),
      updatedAt,
    };
    const [row] = await this.executor
      .insert(ratingAggregates)
      .values(values)
      .onConflictDoUpdate({
        target: [ratingAggregates.entityType, ratingAggregates.entityId],
        set: {
          ratingAvg: values.ratingAvg,
          ratingCount: values.ratingCount,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    if (!row) {
      throw new Error("Review rating aggregate upsert completed without returning a row.");
    }

    return row;
  }

  /** Reads one previously materialized Product/Seller rating aggregate. */
  async findRatingAggregate(
    entityType: ReviewRatingEntity,
    entityId: string,
  ): Promise<RatingAggregateRow | null> {
    const [row] = await this.executor
      .select()
      .from(ratingAggregates)
      .where(
        and(
          eq(ratingAggregates.entityType, entityType),
          eq(ratingAggregates.entityId, entityId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Shares the published-only page query used by Product and Store public list boundaries. */
  private async listPublishedReviews(
    ownerCondition: SQL,
    query: PublicReviewsListQuery,
  ): Promise<PaginatedPublicReviewRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = and(
      ownerCondition,
      eq(reviews.status, REVIEW_STATUS.PUBLISHED),
      sql`${reviews.publishedAt} is not null`,
    );

    const items = await this.executor
      .select(publicReviewSelection())
      .from(reviews)
      .where(where)
      .orderBy(desc(reviews.publishedAt), asc(reviews.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(reviews)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }
}

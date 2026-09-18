import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type {
  RatingAggregateRow,
  ReviewRow,
} from "../../database/schema/reviews.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import type { OrderReviewEligibilitySnapshot } from "../orders/orders.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { SellersService } from "../sellers/sellers.service.js";
import type { ReviewDeliveryItemSnapshot } from "../shipping/shipping.service.js";
import { ShippingService } from "../shipping/shipping.service.js";
import {
  REVIEW_MODERATION_ACTION,
  REVIEW_RATING_ENTITY,
  REVIEW_STATUS,
  REVIEWS_AUDIT_ACTION,
  REVIEWS_ERROR_CODE,
  REVIEWS_OUTBOX_EVENT,
  REVIEWS_PERMISSION,
  REVIEWS_RESOURCE_TYPE,
} from "./reviews.constants.js";
import {
  ReviewsRepository,
  type AdminReviewRow,
  type PublicReviewRow,
} from "./reviews.repository.js";
import type {
  AdminReviewResponse,
  AdminReviewsListQuery,
  CreateReviewBody,
  ModerateReviewBody,
  PublicReviewResponse,
  PublicReviewsListData,
  PublicReviewsListQuery,
  ReviewResponse,
  UpdateReviewBody,
} from "./reviews.schema.js";

/** Runs one Reviews transaction and allows focused service tests to replace PostgreSQL. */
export type ReviewsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Narrow Orders boundary that exposes only immutable purchase facts needed for Review eligibility. */
export interface ReviewsOrdersIntegration {
  /** Returns one purchased Order Item snapshot for trusted internal Review validation. */
  getReviewEligibilitySnapshot(
    context: RequestContext,
    orderItemId: string,
  ): Promise<OrderReviewEligibilitySnapshot | null>;
}

/** Narrow Shipping boundary that exposes only delivered quantity for one purchased Order Item. */
export interface ReviewsShippingIntegration {
  /** Returns trusted delivery completion facts for one Order Item. */
  getReviewDeliverySnapshot(
    context: RequestContext,
    orderId: string,
    orderItemId: string,
  ): Promise<ReviewDeliveryItemSnapshot | null>;
}

/** Narrow Seller boundary used only to resolve a public Store to its canonical Seller aggregate. */
export interface ReviewsSellerIntegration {
  /** Resolves one currently public commerce Store without exposing Seller persistence. */
  resolveCommerceStoreById(storeId: string): Promise<{ sellerId: string; storeId: string }>;
}

/** Transaction-aware audit boundary used by meaningful Review lifecycle writes. */
export interface ReviewsAuditIntegration {
  /** Appends one immutable redacted audit record. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Transaction-aware outbox boundary used by durable Review and rating events. */
export interface ReviewsOutboxIntegration {
  /** Appends one durable event inside the current business transaction. */
  enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit dependencies keep Review business rules readable and easy to unit test. */
export interface ReviewsServiceDependencies {
  repository?: ReviewsRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => ReviewsRepository;
  transactionRunner?: ReviewsTransactionRunner;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => ReviewsOrdersIntegration;
  shippingUsingTransaction?: (transaction: DatabaseTransaction) => ReviewsShippingIntegration;
  sellers?: ReviewsSellerIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => ReviewsAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => ReviewsOutboxIntegration;
  moderationRequired?: boolean;
  now?: () => Date;
}

/** One public Review page plus its Product/Seller rating summary and pagination metadata. */
export interface PaginatedPublicReviewsResult {
  data: PublicReviewsListData;
  meta: PaginationMeta;
}

/** One privileged moderation page with safe Review rows and pagination metadata. */
export interface PaginatedAdminReviewsResult {
  items: AdminReviewResponse[];
  meta: PaginationMeta;
}

/** Creates the trusted system identity used only for internal Orders/Shipping Review checks. */
function systemContext(requestId: string): RequestContext {
  return {
    requestId,
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates one stable Module 15 business error without exposing persistence details. */
function reviewsError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Module 15 business service for verified Reviews, moderation, Helpful votes, and rating aggregates. */
export class ReviewsService {
  private readonly repository: ReviewsRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReviewsRepository;
  private readonly transactionRunner: ReviewsTransactionRunner;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReviewsOrdersIntegration;
  private readonly shippingUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReviewsShippingIntegration;
  private readonly sellers: ReviewsSellerIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReviewsAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ReviewsOutboxIntegration;
  private readonly moderationRequired: boolean;
  private readonly now: () => Date;

  /** Stores explicit dependencies and uses existing released services as production defaults. */
  constructor(dependencies: ReviewsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new ReviewsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ??
      ((transaction) => new ReviewsRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.shippingUsingTransaction =
      dependencies.shippingUsingTransaction ??
      ((transaction) => ShippingService.using(transaction));
    this.sellers = dependencies.sellers ?? new SellersService();
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.moderationRequired = dependencies.moderationRequired ?? false;
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Creates one Review only after server-derived ownership and full delivery eligibility succeed. */
  async createReview(
    context: RequestContext,
    input: CreateReviewBody,
  ): Promise<ReviewResponse> {
    const customerUserId = this.requireCustomer(
      context,
      REVIEWS_PERMISSION.CREATE_VERIFIED,
    );

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const purchase = await this.ordersUsingTransaction(
        transaction,
      ).getReviewEligibilitySnapshot(systemContext(context.requestId), input.orderItemId);

      const eligiblePurchase = this.requireEligiblePurchaseOwner(
        purchase,
        customerUserId,
      );
      await this.assertFullyDelivered(
        transaction,
        context.requestId,
        eligiblePurchase,
      );

      if (await repository.findReviewByOrderItemId(input.orderItemId)) {
        throw this.alreadyExists();
      }

      const now = this.now();
      const status = this.moderationRequired
        ? REVIEW_STATUS.PENDING
        : REVIEW_STATUS.PUBLISHED;
      const created = await repository.createReviewIfMissing({
        customerUserId,
        orderItemId: eligiblePurchase.orderItemId,
        productId: eligiblePurchase.productId,
        sellerId: eligiblePurchase.sellerId,
        storeId: eligiblePurchase.storeId,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body ?? null,
        status,
        publishedAt: status === REVIEW_STATUS.PUBLISHED ? now : null,
        createdAt: now,
        updatedAt: now,
      });

      if (!created) throw this.alreadyExists();

      const audit = this.auditUsingTransaction(transaction);
      const outbox = this.outboxUsingTransaction(transaction);
      await audit.record({
        actorId: customerUserId,
        actorType: context.actorType,
        action: REVIEWS_AUDIT_ACTION.CREATED,
        entityType: REVIEWS_RESOURCE_TYPE.REVIEW,
        entityId: created.id,
        sellerId: created.sellerId,
        requestId: context.requestId,
        after: this.auditReviewState(created),
      });
      await outbox.enqueue({
        eventType: REVIEWS_OUTBOX_EVENT.CREATED,
        aggregateType: REVIEWS_RESOURCE_TYPE.REVIEW,
        aggregateId: created.id,
        payload: this.reviewEventPayload(created),
      });

      if (created.status === REVIEW_STATUS.PUBLISHED) {
        await outbox.enqueue({
          eventType: REVIEWS_OUTBOX_EVENT.PUBLISHED,
          aggregateType: REVIEWS_RESOURCE_TYPE.REVIEW,
          aggregateId: created.id,
          payload: this.reviewEventPayload(created),
        });
        await this.refreshRatingAggregates(
          repository,
          outbox,
          created,
          now,
          "review_created",
        );
      }

      return this.toReviewResponse(created, 0);
    });
  }

  /** Updates only the authenticated customer's Review and applies the frozen edit/moderation policy. */
  async updateOwnReview(
    context: RequestContext,
    reviewId: string,
    input: UpdateReviewBody,
  ): Promise<ReviewResponse> {
    const customerUserId = this.requireCustomer(context, REVIEWS_PERMISSION.UPDATE_OWN);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findOwnedReviewByIdForUpdate(reviewId, customerUserId);
      if (!current) throw this.scopeForbidden();

      const now = this.now();
      const nextLifecycle = this.lifecycleAfterCustomerEdit(current);
      const updated = await repository.updateOwnedReview(reviewId, customerUserId, {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(nextLifecycle.status !== current.status
          ? { status: nextLifecycle.status }
          : {}),
        ...(nextLifecycle.publishedAt !== current.publishedAt
          ? { publishedAt: nextLifecycle.publishedAt }
          : {}),
        updatedAt: now,
      });
      if (!updated) throw this.scopeForbidden();

      await this.auditUsingTransaction(transaction).record({
        actorId: customerUserId,
        actorType: context.actorType,
        action: REVIEWS_AUDIT_ACTION.UPDATED,
        entityType: REVIEWS_RESOURCE_TYPE.REVIEW,
        entityId: updated.id,
        sellerId: updated.sellerId,
        requestId: context.requestId,
        before: this.auditReviewState(current),
        after: this.auditReviewState(updated),
      });

      if (this.editChangesPublishedAggregate(current, updated)) {
        await this.refreshRatingAggregates(
          repository,
          this.outboxUsingTransaction(transaction),
          updated,
          now,
          "review_edited",
        );
      }

      const helpfulCount = await repository.countHelpfulVotes(updated.id);
      return this.toReviewResponse(updated, helpfulCount);
    });
  }

  /** Lists public published Product Reviews and the matching recalculable Product rating summary. */
  async listProductReviews(
    productId: string,
    query: PublicReviewsListQuery,
  ): Promise<PaginatedPublicReviewsResult> {
    const result = await this.repository.listPublishedProductReviews(productId, query);
    const aggregate = await this.repository.findRatingAggregate(
      REVIEW_RATING_ENTITY.PRODUCT,
      productId,
    );

    return {
      data: {
        reviews: result.items.map((item) => this.toPublicReviewResponse(item)),
        rating: this.toRatingSummary(aggregate),
      },
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists public published Store Reviews and the owning Seller's canonical rating aggregate. */
  async listStoreReviews(
    storeId: string,
    query: PublicReviewsListQuery,
  ): Promise<PaginatedPublicReviewsResult> {
    const store = await this.sellers.resolveCommerceStoreById(storeId);
    const [result, aggregate] = await Promise.all([
      this.repository.listPublishedStoreReviews(store.storeId, query),
      this.repository.findRatingAggregate(REVIEW_RATING_ENTITY.SELLER, store.sellerId),
    ]);

    return {
      data: {
        reviews: result.items.map((item) => this.toPublicReviewResponse(item)),
        rating: this.toRatingSummary(aggregate),
      },
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists the privileged moderation queue after platform permission enforcement. */
  async listAdminReviews(
    context: RequestContext,
    query: AdminReviewsListQuery,
  ): Promise<PaginatedAdminReviewsResult> {
    this.requireActor(context);
    assertPermission(context, REVIEWS_PERMISSION.ADMIN_MODERATE as PermissionCode);

    const result = await this.repository.listAdminReviews(query);
    return {
      items: result.items.map((review) => this.toAdminReviewResponse(review)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Marks one currently published Review Helpful exactly once for the authenticated actor. */
  async markReviewHelpful(
    context: RequestContext,
    reviewId: string,
  ): Promise<{ reviewId: string; helpfulCount: number; markedHelpful: true }> {
    const actorId = this.requireActor(context);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const review = await repository.findReviewByIdForUpdate(reviewId);
      if (!review || review.status !== REVIEW_STATUS.PUBLISHED) {
        throw this.notFound();
      }

      await repository.createHelpfulVoteIfMissing(review.id, actorId);
      const helpfulCount = await repository.countHelpfulVotes(review.id);
      return { reviewId: review.id, helpfulCount, markedHelpful: true };
    });
  }

  /** Hides one Review through an explicit admin moderation command with append-only evidence. */
  async hideReview(
    context: RequestContext,
    reviewId: string,
    input: ModerateReviewBody,
  ): Promise<ReviewResponse> {
    return this.moderateReview(
      context,
      reviewId,
      input,
      REVIEW_STATUS.HIDDEN,
      REVIEW_MODERATION_ACTION.HIDE,
      REVIEWS_AUDIT_ACTION.HIDDEN,
      REVIEWS_OUTBOX_EVENT.HIDDEN,
    );
  }

  /** Publishes one Review through an explicit admin moderation command with append-only evidence. */
  async publishReview(
    context: RequestContext,
    reviewId: string,
    input: ModerateReviewBody,
  ): Promise<ReviewResponse> {
    return this.moderateReview(
      context,
      reviewId,
      input,
      REVIEW_STATUS.PUBLISHED,
      REVIEW_MODERATION_ACTION.PUBLISH,
      REVIEWS_AUDIT_ACTION.PUBLISHED,
      REVIEWS_OUTBOX_EVENT.PUBLISHED,
    );
  }

  /** Exposes the current published Product aggregate through the narrow Search rating boundary. */
  async getPublishedRatingAggregate(
    productId: string,
  ): Promise<{ average: number; count: number }> {
    const aggregate = await this.repository.findRatingAggregate(
      REVIEW_RATING_ENTITY.PRODUCT,
      productId,
    );
    return {
      average: aggregate ? Number(aggregate.ratingAvg) : 0,
      count: aggregate?.ratingCount ?? 0,
    };
  }

  /** Applies one idempotent moderation transition and refreshes aggregates when publication changes. */
  private async moderateReview(
    context: RequestContext,
    reviewId: string,
    input: ModerateReviewBody,
    targetStatus: typeof REVIEW_STATUS.HIDDEN | typeof REVIEW_STATUS.PUBLISHED,
    action: typeof REVIEW_MODERATION_ACTION.HIDE | typeof REVIEW_MODERATION_ACTION.PUBLISH,
    auditAction: string,
    eventType: string,
  ): Promise<ReviewResponse> {
    const moderatorUserId = this.requireActor(context);
    assertPermission(context, REVIEWS_PERMISSION.ADMIN_MODERATE as PermissionCode);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findReviewByIdForUpdate(reviewId);
      if (!current) throw this.notFound();

      if (current.status === targetStatus) {
        const helpfulCount = await repository.countHelpfulVotes(current.id);
        return this.toReviewResponse(current, helpfulCount);
      }

      const now = this.now();
      const updated = await repository.updateReviewLifecycle(current.id, {
        status: targetStatus,
        publishedAt:
          targetStatus === REVIEW_STATUS.PUBLISHED ? now : current.publishedAt,
        updatedAt: now,
      });
      if (!updated) throw this.notFound();

      await repository.appendModerationHistory({
        reviewId: updated.id,
        action,
        moderatorUserId,
        reason: input.reason,
        createdAt: now,
      });

      const audit = this.auditUsingTransaction(transaction);
      const outbox = this.outboxUsingTransaction(transaction);
      await audit.record({
        actorId: moderatorUserId,
        actorType: context.actorType,
        action: auditAction,
        entityType: REVIEWS_RESOURCE_TYPE.REVIEW,
        entityId: updated.id,
        sellerId: updated.sellerId,
        requestId: context.requestId,
        before: this.auditReviewState(current),
        after: this.auditReviewState(updated),
        metadata: { reason: input.reason },
      });
      await outbox.enqueue({
        eventType,
        aggregateType: REVIEWS_RESOURCE_TYPE.REVIEW,
        aggregateId: updated.id,
        payload: {
          ...this.reviewEventPayload(updated),
          reason: input.reason,
        },
      });

      if (this.publicationChanged(current, updated)) {
        await this.refreshRatingAggregates(
          repository,
          outbox,
          updated,
          now,
          targetStatus === REVIEW_STATUS.PUBLISHED
            ? "review_published"
            : "review_hidden",
        );
      }

      const helpfulCount = await repository.countHelpfulVotes(updated.id);
      return this.toReviewResponse(updated, helpfulCount);
    });
  }

  /** Returns one owned commercial purchase or raises the stable non-leaking eligibility error. */
  private requireEligiblePurchaseOwner(
    purchase: OrderReviewEligibilitySnapshot | null,
    customerUserId: string,
  ): OrderReviewEligibilitySnapshot {
    if (
      !purchase ||
      purchase.customerUserId !== customerUserId ||
      purchase.quantity - purchase.cancelledQuantity <= 0
    ) {
      throw this.notEligible();
    }
    return purchase;
  }

  /** Requires the remaining commercial quantity for the purchased Order Item to be fully delivered. */
  private async assertFullyDelivered(
    transaction: DatabaseTransaction,
    requestId: string,
    purchase: OrderReviewEligibilitySnapshot,
  ): Promise<void> {
    const delivery = await this.shippingUsingTransaction(
      transaction,
    ).getReviewDeliverySnapshot(
      systemContext(requestId),
      purchase.orderId,
      purchase.orderItemId,
    );
    const commercialQuantity = purchase.quantity - purchase.cancelledQuantity;
    if (!delivery || delivery.deliveredQuantity < commercialQuantity) {
      throw this.notEligible();
    }
  }

  /** Applies the frozen customer-edit moderation policy without changing hidden/pending Reviews implicitly. */
  private lifecycleAfterCustomerEdit(
    current: ReviewRow,
  ): { status: ReviewRow["status"]; publishedAt: Date | null } {
    if (current.status !== REVIEW_STATUS.PUBLISHED) {
      return { status: current.status, publishedAt: current.publishedAt };
    }

    if (this.moderationRequired) {
      return { status: REVIEW_STATUS.PENDING, publishedAt: null };
    }

    return { status: REVIEW_STATUS.PUBLISHED, publishedAt: current.publishedAt };
  }

  /** Returns true when a customer edit changes the set or rating values of published Reviews. */
  private editChangesPublishedAggregate(current: ReviewRow, updated: ReviewRow): boolean {
    const wasPublished = current.status === REVIEW_STATUS.PUBLISHED;
    const isPublished = updated.status === REVIEW_STATUS.PUBLISHED;
    if (wasPublished !== isPublished) return true;
    return wasPublished && current.rating !== updated.rating;
  }

  /** Returns true when moderation moves a Review into or out of the published aggregate set. */
  private publicationChanged(current: ReviewRow, updated: ReviewRow): boolean {
    return (
      (current.status === REVIEW_STATUS.PUBLISHED) !==
      (updated.status === REVIEW_STATUS.PUBLISHED)
    );
  }

  /** Recalculates Product/Seller aggregates and emits one durable Search-refresh source event. */
  private async refreshRatingAggregates(
    repository: ReviewsRepository,
    outbox: ReviewsOutboxIntegration,
    review: ReviewRow,
    updatedAt: Date,
    reason: string,
  ): Promise<void> {
    const product = await repository.recalculateRatingAggregate(
      REVIEW_RATING_ENTITY.PRODUCT,
      review.productId,
      updatedAt,
    );
    const seller = await repository.recalculateRatingAggregate(
      REVIEW_RATING_ENTITY.SELLER,
      review.sellerId,
      updatedAt,
    );

    await outbox.enqueue({
      eventType: REVIEWS_OUTBOX_EVENT.RATING_AGGREGATE_UPDATED,
      aggregateType: REVIEWS_RESOURCE_TYPE.RATING_AGGREGATE,
      aggregateId: review.productId,
      payload: {
        reviewId: review.id,
        productId: review.productId,
        sellerId: review.sellerId,
        storeId: review.storeId,
        productRatingAvg: product.ratingAvg,
        productRatingCount: product.ratingCount,
        sellerRatingAvg: seller.ratingAvg,
        sellerRatingCount: seller.ratingCount,
        reason,
        updatedAt: updatedAt.toISOString(),
      },
    });

  }

  /** Requires a normal authenticated actor before one Review command proceeds. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw reviewsError(
        ERROR_CODE.UNAUTHENTICATED,
        "Authenticated Review access is required.",
        401,
      );
    }
    return context.actorId;
  }

  /** Requires an authenticated Customer actor with one source-defined own-Review permission. */
  private requireCustomer(context: RequestContext, permission: PermissionCode): string {
    const actorId = this.requireActor(context);
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) throw this.scopeForbidden();
    assertPermission(context, permission);
    return actorId;
  }

  /** Maps one internal Review row to the authenticated Review response without customer-profile PII. */
  private toReviewResponse(review: ReviewRow, helpfulCount: number): ReviewResponse {
    return {
      id: review.id,
      orderItemId: review.orderItemId,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status as ReviewResponse["status"],
      verifiedPurchase: true,
      helpfulCount,
      publishedAt: review.publishedAt?.toISOString() ?? null,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  /** Maps one privacy-safe moderation projection to the authenticated Review response. */
  private toAdminReviewResponse(review: AdminReviewRow): AdminReviewResponse {
    return {
      id: review.id,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status as AdminReviewResponse["status"],
      verifiedPurchase: true,
      helpfulCount: review.helpfulCount,
      publishedAt: review.publishedAt?.toISOString() ?? null,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  /** Maps one repository public projection to the privacy-safe public Review response. */
  private toPublicReviewResponse(review: PublicReviewRow): PublicReviewResponse {
    return {
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      verifiedPurchase: true,
      helpfulCount: review.helpfulCount,
      publishedAt: review.publishedAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  /** Maps one materialized aggregate to the public numeric summary, defaulting to the documented zero state. */
  private toRatingSummary(
    aggregate: RatingAggregateRow | null,
  ): { ratingAvg: number; ratingCount: number } {
    return {
      ratingAvg: aggregate ? Number(aggregate.ratingAvg) : 0,
      ratingCount: aggregate?.ratingCount ?? 0,
    };
  }

  /** Returns the redacted Review lifecycle/content subset stored in audit before/after snapshots. */
  private auditReviewState(review: ReviewRow): Record<string, unknown> {
    return {
      reviewId: review.id,
      orderItemId: review.orderItemId,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      rating: review.rating,
      status: review.status,
      verifiedPurchase: review.verifiedPurchase,
      publishedAt: review.publishedAt?.toISOString() ?? null,
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  /** Builds the stable server-derived Review payload consumed by asynchronous integrations. */
  private reviewEventPayload(review: ReviewRow): Record<string, unknown> {
    return {
      reviewId: review.id,
      orderItemId: review.orderItemId,
      productId: review.productId,
      sellerId: review.sellerId,
      storeId: review.storeId,
      status: review.status,
      verifiedPurchase: review.verifiedPurchase,
      publishedAt: review.publishedAt?.toISOString() ?? null,
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  /** Returns the stable eligibility error without revealing foreign Order Item existence. */
  private notEligible(): AppError {
    return reviewsError(
      REVIEWS_ERROR_CODE.NOT_ELIGIBLE,
      "This purchase is not eligible for a Review.",
      409,
    );
  }

  /** Returns the stable one-Review-per-purchase conflict. */
  private alreadyExists(): AppError {
    return reviewsError(
      REVIEWS_ERROR_CODE.ALREADY_EXISTS,
      "A Review already exists for this purchase item.",
      409,
    );
  }

  /** Returns the stable non-public Review lookup error. */
  private notFound(): AppError {
    return reviewsError(
      REVIEWS_ERROR_CODE.NOT_FOUND,
      "Review was not found.",
      404,
    );
  }

  /** Returns one customer-scope error without distinguishing missing and foreign Reviews. */
  private scopeForbidden(): AppError {
    return reviewsError(
      REVIEWS_ERROR_CODE.SCOPE_FORBIDDEN,
      "Review is outside the authorized customer scope.",
      403,
    );
  }
}

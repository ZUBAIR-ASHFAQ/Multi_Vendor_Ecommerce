import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminReviewsListQuerySchema,
  createReviewBodySchema,
  moderateReviewBodySchema,
  productReviewsParamsSchema,
  publicReviewsListQuerySchema,
  reviewIdParamsSchema,
  storeReviewsParamsSchema,
  updateReviewBodySchema,
} from "./reviews.schema.js";
import { ReviewsService } from "./reviews.service.js";

/** Thin HTTP adapter for the eight approved Module 15 Reviews & Ratings operations. */
export class ReviewsController {
  /** Stores the already-composed Review service so handlers contain no business rules. */
  constructor(private readonly reviewsService: ReviewsService) {}

  /** Creates one verified-purchase Review for the authenticated customer. */
  createReview = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createReviewBodySchema.parse(request.body);
      const result = await this.reviewsService.createReview(
        getRequestContext(response),
        input,
      );
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates authored Review fields only after service-level ownership checks succeed. */
  updateOwnReview = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = reviewIdParamsSchema.parse(request.params);
      const input = updateReviewBodySchema.parse(request.body);
      const result = await this.reviewsService.updateOwnReview(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one bounded public page of published Reviews for a Product. */
  listProductReviews = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { productId } = productReviewsParamsSchema.parse(request.params);
      const query = publicReviewsListQuerySchema.parse(request.query);
      const result = await this.reviewsService.listProductReviews(productId, query);
      response.status(200).json(
        successResponse(result.data, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one bounded public page of published Reviews for a Store. */
  listStoreReviews = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { storeId } = storeReviewsParamsSchema.parse(request.params);
      const query = publicReviewsListQuerySchema.parse(request.query);
      const result = await this.reviewsService.listStoreReviews(storeId, query);
      response.status(200).json(
        successResponse(result.data, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Marks one published Review Helpful for the authenticated actor without duplicating a vote. */
  markReviewHelpful = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = reviewIdParamsSchema.parse(request.params);
      const result = await this.reviewsService.markReviewHelpful(
        getRequestContext(response),
        id,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one bounded permission-scoped admin Review moderation page. */
  listAdminReviews = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminReviewsListQuerySchema.parse(request.query);
      const result = await this.reviewsService.listAdminReviews(
        getRequestContext(response),
        query,
      );
      response.status(200).json(
        successResponse(result.items, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Hides one Review through the explicit privileged moderation command. */
  hideReview = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = reviewIdParamsSchema.parse(request.params);
      const input = moderateReviewBodySchema.parse(request.body);
      const result = await this.reviewsService.hideReview(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Publishes one Review through the explicit privileged moderation command. */
  publishReview = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = reviewIdParamsSchema.parse(request.params);
      const input = moderateReviewBodySchema.parse(request.body);
      const result = await this.reviewsService.publishReview(
        getRequestContext(response),
        id,
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };
}

import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminPromotionListQuerySchema,
  createPlatformPromotionBodySchema,
  createSellerPromotionBodySchema,
  emptyPromotionCommandBodySchema,
  promotionIdParamsSchema,
  sellerPromotionListQuerySchema,
  updatePromotionBodySchema,
  validatePromotionQuerySchema,
} from "./promotions.schema.js";
import { PromotionsService } from "./promotions.service.js";

/** Thin HTTP adapter for the approved Module 9 Promotions & Coupons operations. */
export class PromotionsController {
  /** Receives the Promotions service explicitly so HTTP handling stays easy to test. */
  constructor(private readonly promotionsService: PromotionsService) {}

  /** Returns the paginated platform-promotion list for an authorized administrator. */
  listAdminPromotions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminPromotionListQuerySchema.parse(request.query);
      const result = await this.promotionsService.listAdminPromotions(
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

  /** Creates one platform-owned promotion from validated administrator input. */
  createAdminPromotion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createPlatformPromotionBodySchema.parse(request.body);
      const result = await this.promotionsService.createPlatformPromotion(
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

  /** Updates editable fields on one platform promotion without exposing lifecycle status writes. */
  updateAdminPromotion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = promotionIdParamsSchema.parse(request.params);
      const input = updatePromotionBodySchema.parse(request.body);
      const result = await this.promotionsService.updateAdminPromotion(
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

  /** Creates one seller-funded promotion inside the authenticated seller scope. */
  createSellerPromotion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createSellerPromotionBodySchema.parse(request.body);
      const result = await this.promotionsService.createSellerPromotion(
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

  /** Returns the paginated promotion list inside the authenticated seller scope. */
  listSellerPromotions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerPromotionListQuerySchema.parse(request.query);
      const result = await this.promotionsService.listSellerPromotions(
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

  /** Validates one coupon against the authenticated customer's current Cart. */
  validateCoupon = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = validatePromotionQuerySchema.parse(request.query);
      const result = await this.promotionsService.validateCoupon(
        getRequestContext(response),
        query,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Activates or schedules one promotion through the explicit lifecycle command. */
  activateAdminPromotion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = promotionIdParamsSchema.parse(request.params);
      emptyPromotionCommandBodySchema.parse(request.body);
      const result = await this.promotionsService.activateAdminPromotion(
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

  /** Deactivates one promotion through the explicit lifecycle command without deleting history. */
  deactivateAdminPromotion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = promotionIdParamsSchema.parse(request.params);
      emptyPromotionCommandBodySchema.parse(request.body);
      const result = await this.promotionsService.deactivateAdminPromotion(
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
}

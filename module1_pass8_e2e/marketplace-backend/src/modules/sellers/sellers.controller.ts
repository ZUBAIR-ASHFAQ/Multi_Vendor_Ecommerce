import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminSellerApplicationListQuerySchema,
  adminSellerIdParamsSchema,
  approveSellerApplicationBodySchema,
  createStoreBodySchema,
  publicStoreSlugParamsSchema,
  rejectSellerApplicationBodySchema,
  sellerApplicationIdParamsSchema,
  sellerStoreIdParamsSchema,
  submitSellerApplicationBodySchema,
  suspendSellerBodySchema,
  updateSellerProfileBodySchema,
  updateStoreBodySchema,
} from "./sellers.schema.js";
import { SellersService } from "./sellers.service.js";

/** Thin HTTP adapter for the ten approved Module 4 seller/store endpoints. */
export class SellersController {
  /** Receives the application-composed service so cross-module integrations stay outside HTTP code. */
  constructor(private readonly sellersService: SellersService) {}

  /** Submits one validated seller application for the authenticated customer. */
  submitApplication = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = submitSellerApplicationBodySchema.parse(request.body);
      const result = await this.sellersService.submitApplication(
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

  /** Lists one bounded administrator seller-application review page. */
  listApplications = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminSellerApplicationListQuerySchema.parse(request.query);
      const result = await this.sellersService.listApplications(
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

  /** Approves one submitted seller application using the server-owned application snapshot. */
  approveApplication = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = sellerApplicationIdParamsSchema.parse(request.params);
      approveSellerApplicationBodySchema.parse(request.body ?? {});
      const result = await this.sellersService.approveApplication(
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

  /** Rejects one submitted seller application with a validated review reason. */
  rejectApplication = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = sellerApplicationIdParamsSchema.parse(request.params);
      const input = rejectSellerApplicationBodySchema.parse(request.body);
      const result = await this.sellersService.rejectApplication(
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

  /** Returns the current seller profile, stores and staff summary for the active seller scope. */
  getMySeller = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.sellersService.getMySeller(
        getRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates only the validated seller profile fields owned by Module 4. */
  updateMySeller = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = updateSellerProfileBodySchema.parse(request.body);
      const result = await this.sellersService.updateMySeller(
        getRequestContext(response),
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates one validated store inside the authenticated seller scope. */
  createStore = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createStoreBodySchema.parse(request.body);
      const result = await this.sellersService.createStore(
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

  /** Returns one public-safe active store by its normalized slug. */
  getPublicStore = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { slug } = publicStoreSlugParamsSchema.parse(request.params);
      const result = await this.sellersService.getPublicStore(slug);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates one validated store only after service-level seller ownership checks. */
  updateStore = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = sellerStoreIdParamsSchema.parse(request.params);
      const input = updateStoreBodySchema.parse(request.body);
      const result = await this.sellersService.updateStore(
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

  /** Suspends one approved seller through the explicit privileged lifecycle command. */
  suspendSeller = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = adminSellerIdParamsSchema.parse(request.params);
      const input = suspendSellerBodySchema.parse(request.body ?? {});
      const result = await this.sellersService.suspendSeller(
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

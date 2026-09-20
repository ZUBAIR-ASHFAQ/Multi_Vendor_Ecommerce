import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminReturnListQuerySchema,
  approveReturnBodySchema,
  createReturnRequestBodySchema,
  customerReturnListQuerySchema,
  issueReturnRefundBodySchema,
  receiveReturnBodySchema,
  rejectReturnBodySchema,
  returnOrderIdParamsSchema,
  returnRefundIdempotencyHeadersSchema,
  returnRequestIdParamsSchema,
  sellerReturnListQuerySchema,
} from "./returns-refunds.schema.js";
import { ReturnsRefundsService } from "./returns-refunds.service.js";

/** Thin HTTP adapter for the eight approved Module 14 Returns, Refunds & Disputes operations. */
export class ReturnsRefundsController {
  /** Stores the already-composed Module 14 service used by every handler. */
  constructor(private readonly returnsRefundsService: ReturnsRefundsService) {}

  /** Creates one Return Request for an authenticated customer's eligible delivered Order items. */
  createReturnRequest = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { orderId } = returnOrderIdParamsSchema.parse(request.params);
      const input = createReturnRequestBodySchema.parse(request.body);
      const result = await this.returnsRefundsService.createReturnRequest(
        getRequestContext(response),
        orderId,
        input,
      );
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists only Return Requests owned by the authenticated customer. */
  listCustomerReturns = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = customerReturnListQuerySchema.parse(request.query);
      const result = await this.returnsRefundsService.listCustomerReturns(
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

  /** Lists Return Requests only inside the authenticated seller actor's effective scope. */
  listSellerReturns = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerReturnListQuerySchema.parse(request.query);
      const result = await this.returnsRefundsService.listSellerReturns(
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

  /** Approves one requested Return inside the authenticated seller actor's scope. */
  approveReturn = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = returnRequestIdParamsSchema.parse(request.params);
      const input = approveReturnBodySchema.parse(request.body ?? {});
      const result = await this.returnsRefundsService.approveReturn(
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

  /** Rejects one requested Return and records the required seller/support reason. */
  rejectReturn = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = returnRequestIdParamsSchema.parse(request.params);
      const input = rejectReturnBodySchema.parse(request.body);
      const result = await this.returnsRefundsService.rejectReturn(
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

  /** Records complete physical inspection decisions for one approved seller-scoped Return. */
  receiveReturn = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = returnRequestIdParamsSchema.parse(request.params);
      const input = receiveReturnBodySchema.parse(request.body);
      const result = await this.returnsRefundsService.receiveReturn(
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

  /** Executes one provider-authoritative Return refund using the required Foundation idempotency key. */
  issueRefund = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = returnRequestIdParamsSchema.parse(request.params);
      const input = issueReturnRefundBodySchema.parse(request.body ?? {});
      const headers = returnRefundIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.returnsRefundsService.issueRefund(
        getRequestContext(response),
        id,
        input,
        headers["idempotency-key"],
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists Return Requests for an authorized platform support/admin actor. */
  listAdminReturns = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminReturnListQuerySchema.parse(request.query);
      const result = await this.returnsRefundsService.listAdminReturns(
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
}

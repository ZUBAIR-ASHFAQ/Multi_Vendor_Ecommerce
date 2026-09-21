import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  checkoutAttemptIdParamsSchema,
  checkoutConfirmHeadersSchema,
  checkoutQuoteIdParamsSchema,
  confirmCheckoutQuoteBodySchema,
  createCheckoutQuoteBodySchema,
} from "./checkout.schema.js";
import { CheckoutService } from "./checkout.service.js";

/** Thin HTTP adapter for the four approved Module 10 Checkout operations. */
export class CheckoutController {
  /** Stores the already-composed Checkout service used by this HTTP adapter. */
  constructor(private readonly checkoutService: CheckoutService) {}

  /** Creates one authoritative short-lived quote from the authenticated customer's Cart or one Buy Now item. */
  createQuote = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createCheckoutQuoteBodySchema.parse(request.body);
      const result = await this.checkoutService.createQuote(
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

  /** Returns one unexpired quote only when it belongs to the authenticated customer. */
  getQuote = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = checkoutQuoteIdParamsSchema.parse(request.params);
      const result = await this.checkoutService.getQuote(
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

  /** Confirms one quote using the required Idempotency-Key header and client-echoed state hash. */
  confirmQuote = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = checkoutQuoteIdParamsSchema.parse(request.params);
      const input = confirmCheckoutQuoteBodySchema.parse(request.body);
      const headers = checkoutConfirmHeadersSchema.parse(request.headers);
      const result = await this.checkoutService.confirmQuote(
        getRequestContext(response),
        id,
        input.stateHash,
        headers["idempotency-key"],
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns the authenticated customer's Checkout-attempt status without mixing in Order or Payment state. */
  getAttemptStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { attemptId } = checkoutAttemptIdParamsSchema.parse(request.params);
      const result = await this.checkoutService.getAttemptStatus(
        getRequestContext(response),
        attemptId,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };
}

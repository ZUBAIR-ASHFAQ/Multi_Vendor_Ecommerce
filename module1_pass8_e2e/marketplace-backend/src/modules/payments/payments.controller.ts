import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import { PAYMENTS_ERROR_CODE } from "./payments.constants.js";
import {
  adminPaymentListQuerySchema,
  createPaymentIntentBodySchema,
  internalRefundBodySchema,
  paymentIdParamsSchema,
  paymentIntentHeadersSchema,
  paymentOrderIdParamsSchema,
  stripeWebhookHeadersSchema,
  stripeWebhookRawBodySchema,
} from "./payments.schema.js";
import { PaymentsService } from "./payments.service.js";

/** Thin HTTP adapter for the six approved Module 12 Payments operations. */
export class PaymentsController {
  /** Stores the composed Payments service used by this HTTP adapter. */
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Creates or reuses the authenticated customer's provider PaymentIntent idempotently. */
  createPaymentIntent = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { orderId } = paymentOrderIdParamsSchema.parse(request.params);
      createPaymentIntentBodySchema.parse(request.body ?? {});
      const headers = paymentIntentHeadersSchema.parse(request.headers);
      const result = await this.paymentsService.createPaymentIntent(
        getRequestContext(response),
        orderId,
        headers["idempotency-key"],
      );

      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns marketplace Payment state only for the authenticated customer's own Order. */
  getCustomerPaymentStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { orderId } = paymentOrderIdParamsSchema.parse(request.params);
      const result = await this.paymentsService.getCustomerPaymentStatus(
        getRequestContext(response),
        orderId,
      );

      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Verifies and processes one Stripe webhook from the exact raw request bytes. */
  processStripeWebhook = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const headers = stripeWebhookHeadersSchema.safeParse(request.headers);
      if (!headers.success) {
        throw new AppError({
          code: PAYMENTS_ERROR_CODE.WEBHOOK_INVALID,
          message: "Stripe webhook signature is required.",
          statusCode: 400,
        });
      }

      const rawBody = stripeWebhookRawBodySchema.safeParse(request.body);
      if (!rawBody.success) {
        throw new AppError({
          code: PAYMENTS_ERROR_CODE.WEBHOOK_INVALID,
          message: "Stripe webhook body must be raw application/json bytes.",
          statusCode: 400,
        });
      }

      const result = await this.paymentsService.processStripeWebhook(
        rawBody.data,
        headers.data["stripe-signature"],
      );

      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists permission-filtered finance Payment summaries using allow-listed query filters. */
  listAdminPayments = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminPaymentListQuerySchema.parse(request.query);
      const result = await this.paymentsService.listAdminPayments(
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

  /** Returns one finance Payment detail with its safe ordered transaction timeline. */
  getAdminPaymentDetail = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = paymentIdParamsSchema.parse(request.params);
      const result = await this.paymentsService.getAdminPaymentDetail(
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

  /** Executes the trusted internal refund command after internal-service authentication. */
  refundPayment = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = paymentIdParamsSchema.parse(request.params);
      const input = internalRefundBodySchema.parse(request.body);
      const result = await this.paymentsService.refundPayment(
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

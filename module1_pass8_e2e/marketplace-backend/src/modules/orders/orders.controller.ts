import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  acceptSellerOrderBodySchema,
  adminOrderListQuerySchema,
  cancelOrderBodySchema,
  customerOrderListQuerySchema,
  orderCancelHeadersSchema,
  orderIdParamsSchema,
  paymentConfirmedBodySchema,
  sellerOrderIdParamsSchema,
  sellerOrderListQuerySchema,
} from "./orders.schema.js";
import { OrdersService } from "./orders.service.js";

/** Thin HTTP adapter for the nine approved Module 11 Order operations. */
export class OrdersController {
  /** Stores the already-composed Orders service used by this HTTP adapter. */
  constructor(private readonly ordersService: OrdersService) {}

  /** Returns the authenticated customer's own parent Order history. */
  listCustomerOrders = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = customerOrderListQuerySchema.parse(request.query);
      const result = await this.ordersService.listCustomerOrders(
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

  /** Returns one authenticated customer-owned parent Order detail. */
  getCustomerOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const result = await this.ordersService.getCustomerOrder(
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

  /** Returns Seller Orders only inside the authenticated actor's seller/store read scope. */
  listSellerOrders = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerOrderListQuerySchema.parse(request.query);
      const result = await this.ordersService.listSellerOrders(
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

  /** Returns one Seller Order only inside the authenticated actor's seller/store scope. */
  getSellerOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = sellerOrderIdParamsSchema.parse(request.params);
      const result = await this.ordersService.getSellerOrder(
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

  /** Accepts one paid Seller Order without accepting any client-controlled lifecycle state. */
  acceptSellerOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = sellerOrderIdParamsSchema.parse(request.params);
      acceptSellerOrderBodySchema.parse(request.body ?? {});
      const result = await this.ordersService.acceptSellerOrder(
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

  /** Cancels eligible quantities from the authenticated customer's own pre-capture Order. */
  cancelCustomerOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const input = cancelOrderBodySchema.parse(request.body);
      const headers = orderCancelHeadersSchema.parse(request.headers);
      const result = await this.ordersService.cancelCustomerOrder(
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

  /** Cancels eligible pre-capture Order quantities through the privileged admin command. */
  cancelAdminOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const input = cancelOrderBodySchema.parse(request.body);
      const headers = orderCancelHeadersSchema.parse(request.headers);
      const result = await this.ordersService.cancelAdminOrder(
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

  /** Searches parent Customer Orders for an authorized platform admin/support actor. */
  listAdminOrders = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminOrderListQuerySchema.parse(request.query);
      const result = await this.ordersService.listAdminOrders(
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

  /** Applies one provider-authoritative, replay-safe Payment-confirmed transition from a trusted internal caller. */
  confirmPayment = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const input = paymentConfirmedBodySchema.parse(request.body);
      const result = await this.ordersService.confirmPayment(
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

import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  createShipmentBodySchema,
  createShipmentParamsSchema,
  orderShipmentsParamsSchema,
  sellerShipmentListQuerySchema,
  shipmentIdempotencyHeadersSchema,
  shipmentIdParamsSchema,
  shipmentLifecycleCommandBodySchema,
  shippingOptionsQuerySchema,
  updateShipmentTrackingBodySchema,
} from "./shipping.schema.js";
import { ShippingService } from "./shipping.service.js";

/** Thin HTTP adapter for the seven approved Module 13 Shipping operations. */
export class ShippingController {
  /** Stores the already-composed Shipping service used by every HTTP handler. */
  constructor(private readonly shippingService: ShippingService) {}

  /** Returns server-derived shipping options for the authenticated customer's current Cart. */
  getCheckoutShippingOptions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = shippingOptionsQuerySchema.parse(request.query);
      const result = await this.shippingService.getCheckoutShippingOptions(
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

  /** Lists Shipments only inside the authenticated seller actor's effective scope. */
  listSellerShipments = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerShipmentListQuerySchema.parse(request.query);
      const result = await this.shippingService.listSellerShipments(
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

  /** Creates one immutable Shipment allocation for an eligible Seller Order. */
  createShipment = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { sellerOrderId } = createShipmentParamsSchema.parse(request.params);
      const input = createShipmentBodySchema.parse(request.body);
      const headers = shipmentIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.shippingService.createShipment(
        getRequestContext(response),
        sellerOrderId,
        input,
        headers["idempotency-key"],
      );
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Sets or corrects Shipment tracking without accepting lifecycle state from the client. */
  updateShipmentTracking = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = shipmentIdParamsSchema.parse(request.params);
      const input = updateShipmentTrackingBodySchema.parse(request.body);
      const result = await this.shippingService.updateShipmentTracking(
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

  /** Marks one created Shipment shipped and issues its committed Inventory exactly once. */
  markShipmentShipped = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = shipmentIdParamsSchema.parse(request.params);
      shipmentLifecycleCommandBodySchema.parse(request.body ?? {});
      const headers = shipmentIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.shippingService.markShipmentShipped(
        getRequestContext(response),
        id,
        headers["idempotency-key"],
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Marks one shipped Shipment delivered using the server clock for deliveredAt. */
  markShipmentDelivered = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = shipmentIdParamsSchema.parse(request.params);
      shipmentLifecycleCommandBodySchema.parse(request.body ?? {});
      const headers = shipmentIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.shippingService.markShipmentDelivered(
        getRequestContext(response),
        id,
        headers["idempotency-key"],
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns customer-safe tracking for one owned Order or an authorized platform support read. */
  getOrderShipments = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { orderId } = orderShipmentsParamsSchema.parse(request.params);
      const result = await this.shippingService.getOrderShipments(
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
}

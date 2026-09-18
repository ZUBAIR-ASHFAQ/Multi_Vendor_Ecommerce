import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adjustStockBodySchema,
  inventoryVariantParamsSchema,
  releaseStockBodySchema,
  reserveStockBodySchema,
  sellerInventoryListQuerySchema,
  shipStockBodySchema,
  stockMovementListQuerySchema,
  updateReorderLevelBodySchema,
} from "./inventory.schema.js";
import { InventoryService } from "./inventory.service.js";

/** Thin HTTP adapter for the audited Module 7 Inventory endpoints. */
export class InventoryController {
  /** Receives the Inventory service explicitly so HTTP handling stays easy to test. */
  constructor(private readonly inventoryService: InventoryService) {}

  /** Returns seller-scoped Inventory with standard pagination metadata. */
  listSellerInventory = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerInventoryListQuerySchema.parse(request.query);
      const result = await this.inventoryService.listSellerInventory(
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

  /** Returns immutable movement history for one seller-owned Product variant. */
  listStockMovements = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { variantId } = inventoryVariantParamsSchema.parse(request.params);
      const query = stockMovementListQuerySchema.parse(request.query);
      const result = await this.inventoryService.listStockMovements(
        getRequestContext(response),
        variantId,
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

  /** Applies one controlled stock adjustment to a seller-owned variant. */
  adjustStock = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { variantId } = inventoryVariantParamsSchema.parse(request.params);
      const input = adjustStockBodySchema.parse(request.body);
      const result = await this.inventoryService.adjustStock(
        getRequestContext(response),
        variantId,
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates the low-stock reorder threshold for one seller-owned variant. */
  updateReorderLevel = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { variantId } = inventoryVariantParamsSchema.parse(request.params);
      const input = updateReorderLevelBodySchema.parse(request.body);
      const result = await this.inventoryService.updateReorderLevel(
        getRequestContext(response),
        variantId,
        input,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates or replays one trusted idempotent Inventory reservation command. */
  reserveStock = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = reserveStockBodySchema.parse(request.body);
      const result = await this.inventoryService.reserveStock(
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

  /** Releases or replays one trusted Inventory reservation command. */
  releaseStock = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = releaseStockBodySchema.parse(request.body);
      const result = await this.inventoryService.releaseStock(
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

  /** Consumes one committed reservation through a trusted fulfillment command. */
  shipStock = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = shipStockBodySchema.parse(request.body);
      const result = await this.inventoryService.shipStock(
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
}

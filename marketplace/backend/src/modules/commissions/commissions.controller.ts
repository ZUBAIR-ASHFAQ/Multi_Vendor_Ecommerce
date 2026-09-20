import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminCommissionEntryListQuerySchema,
  adminCommissionRuleListQuerySchema,
  commissionRuleIdParamsSchema,
  createCommissionRuleBodySchema,
  internalCommissionOrderSettleBodySchema,
  internalCommissionRefundAdjustBodySchema,
  sellerCommissionStatementQuerySchema,
  updateCommissionRuleBodySchema,
} from "./commissions.schema.js";
import { CommissionsService } from "./commissions.service.js";

/** Thin HTTP adapter for the seven approved Module 16 Commission operations. */
export class CommissionsController {
  /** Stores the composed Commission service used by this HTTP adapter. */
  constructor(private readonly commissionsService: CommissionsService) {}

  /** Lists effective-dated Commission rules for an authorized finance/admin actor. */
  listRules = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminCommissionRuleListQuerySchema.parse(request.query);
      const result = await this.commissionsService.listRules(
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

  /** Creates one validated Commission rule for future Order Item snapshots. */
  createRule = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createCommissionRuleBodySchema.parse(request.body);
      const result = await this.commissionsService.createRule(
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

  /** Updates one future-effective Commission rule without rewriting historical snapshots. */
  updateRule = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = commissionRuleIdParamsSchema.parse(request.params);
      const input = updateCommissionRuleBodySchema.parse(request.body);
      const result = await this.commissionsService.updateRule(
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

  /** Returns the authenticated seller's own Commission statement and immutable entries. */
  getSellerStatement = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerCommissionStatementQuerySchema.parse(request.query);
      const result = await this.commissionsService.getSellerStatement(
        getRequestContext(response),
        query,
      );

      response.status(200).json(
        successResponse(result.statement, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists the immutable Commission finance ledger for an authorized admin actor. */
  listAdminEntries = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminCommissionEntryListQuerySchema.parse(request.query);
      const result = await this.commissionsService.listAdminEntries(
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

  /** Posts idempotent sale Commission entries from trusted captured-Order state. */
  settleOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = internalCommissionOrderSettleBodySchema.parse(request.body);
      const result = await this.commissionsService.settleOrder(
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

  /** Appends an idempotent Commission refund adjustment from trusted provider refund state. */
  adjustRefund = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = internalCommissionRefundAdjustBodySchema.parse(request.body);
      const result = await this.commissionsService.adjustRefund(
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

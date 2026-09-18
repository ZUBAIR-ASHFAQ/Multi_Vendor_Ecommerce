import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adjustWalletBodySchema,
  adminPayoutListQuerySchema,
  approvePayoutBodySchema,
  createPayoutAccountBodySchema,
  payoutIdParamsSchema,
  requestPayoutBodySchema,
  sellerPayoutListQuerySchema,
  sellerWalletQuerySchema,
  sendPayoutBodySchema,
  settleWalletBodySchema,
  walletPayoutIdempotencyHeadersSchema,
} from "./seller-wallet-payouts.schema.js";
import { SellerWalletPayoutsService } from "./seller-wallet-payouts.service.js";

/** Thin HTTP adapter for the exact nine approved Module 17 Seller Wallet & Payouts operations. */
export class SellerWalletPayoutsController {
  /** Stores the already-composed Module 17 service used by every handler. */
  constructor(private readonly service: SellerWalletPayoutsService) {}

  /** Returns the authenticated seller's Wallet snapshots, immutable ledger page, and safe payout accounts. */
  getSellerWallet = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerWalletQuerySchema.parse(request.query);
      const result = await this.service.getSellerWallet(getRequestContext(response), query);
      response.status(200).json(
        successResponse(result.wallet, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists only Payout history owned by the authenticated seller scope. */
  listSellerPayouts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerPayoutListQuerySchema.parse(request.query);
      const result = await this.service.listSellerPayouts(getRequestContext(response), query);
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

  /** Creates one seller Payout request with the required Foundation idempotency key. */
  requestPayout = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = requestPayoutBodySchema.parse(request.body);
      const headers = walletPayoutIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.service.requestPayout(
        getRequestContext(response),
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

  /** Adds one already-tokenized seller payout destination after provider-side validation. */
  createPayoutAccount = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createPayoutAccountBodySchema.parse(request.body);
      const result = await this.service.createPayoutAccount(getRequestContext(response), input);
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Lists the permission-filtered finance Payout queue for an authorized platform actor. */
  listAdminPayouts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminPayoutListQuerySchema.parse(request.query);
      const result = await this.service.listAdminPayouts(getRequestContext(response), query);
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

  /** Approves one requested Payout and atomically reserves the authoritative Wallet balance. */
  approvePayout = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = payoutIdParamsSchema.parse(request.params);
      approvePayoutBodySchema.parse(request.body ?? {});
      const headers = walletPayoutIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.service.approvePayout(
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

  /** Sends or reconciles one approved/processing Payout through the configured provider adapter. */
  sendPayout = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = payoutIdParamsSchema.parse(request.params);
      sendPayoutBodySchema.parse(request.body ?? {});
      const headers = walletPayoutIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.service.sendPayout(
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

  /** Runs one bounded trusted settlement scan using the server clock and authoritative delivery facts. */
  settleWallet = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = settleWalletBodySchema.parse(request.body ?? {});
      const headers = walletPayoutIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.service.settleWallet(
        getRequestContext(response),
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

  /** Re-drives one trusted negative Commission adjustment without accepting caller-owned money. */
  adjustWallet = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = adjustWalletBodySchema.parse(request.body);
      const headers = walletPayoutIdempotencyHeadersSchema.parse(request.headers);
      const result = await this.service.adjustWallet(
        getRequestContext(response),
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
}

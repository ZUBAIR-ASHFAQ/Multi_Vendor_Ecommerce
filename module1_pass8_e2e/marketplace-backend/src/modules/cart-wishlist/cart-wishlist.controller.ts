import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  addCartItemBodySchema,
  addWishlistItemBodySchema,
  cartItemIdParamsSchema,
  updateCartItemBodySchema,
  wishlistItemIdParamsSchema,
} from "./cart-wishlist.schema.js";
import { CartWishlistService } from "./cart-wishlist.service.js";

/** Thin HTTP adapter for the eight approved Module 8 Cart/Wishlist endpoints. */
export class CartWishlistController {
  /** Stores the already-composed Cart/Wishlist service used by this thin HTTP adapter. */
  constructor(private readonly service: CartWishlistService) {}

  /** Returns the authenticated customer's cart with current preview display data. */
  getCart = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.getCart(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Adds one validated variant quantity to the authenticated customer's cart. */
  addCartItem = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = addCartItemBodySchema.parse(request.body);
      const result = await this.service.addCartItem(
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

  /** Updates one customer-owned cart item's quantity after strict param/body validation. */
  updateCartItem = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = cartItemIdParamsSchema.parse(request.params);
      const input = updateCartItemBodySchema.parse(request.body);
      const result = await this.service.updateCartItem(
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

  /** Removes one customer-owned cart item without accepting ownership from the client. */
  removeCartItem = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = cartItemIdParamsSchema.parse(request.params);
      const result = await this.service.removeCartItem(
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

  /** Clears only the authenticated customer's cart and returns the empty cart preview. */
  clearCart = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.clearCart(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns the authenticated customer's default wishlist with current public display data. */
  getWishlist = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.getWishlist(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Adds one validated Product or Product variant to the customer's default wishlist. */
  addWishlistItem = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = addWishlistItemBodySchema.parse(request.body);
      const result = await this.service.addWishlistItem(
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

  /** Removes one customer-owned wishlist item after validating the path parameter. */
  removeWishlistItem = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = wishlistItemIdParamsSchema.parse(request.params);
      const result = await this.service.removeWishlistItem(
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


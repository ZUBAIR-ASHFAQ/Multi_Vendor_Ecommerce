import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  createProductBodySchema,
  createProductVariantBodySchema,
  emptyProductCommandBodySchema,
  linkProductMediaBodySchema,
  productIdParamsSchema,
  productVariantIdParamsSchema,
  publicProductListQuerySchema,
  publicProductSlugParamsSchema,
  sellerProductListQuerySchema,
  updateProductBodySchema,
  updateProductVariantBodySchema,
} from "./products.schema.js";
import { ProductsService } from "./products.service.js";

/** Thin HTTP adapter for the audited Module 6 Product Management endpoints. */
export class ProductsController {
  /** Receives the Product service explicitly so HTTP handling stays easy to test and understand. */
  constructor(private readonly productsService: ProductsService) {}

  /** Returns a paginated list containing only public-safe published Products. */
  listPublicProducts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = publicProductListQuerySchema.parse(request.query);
      const result = await this.productsService.listPublicProducts(query);
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

  /** Returns one published Product by its globally unique validated slug. */
  getPublicProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { slug } = publicProductSlugParamsSchema.parse(request.params);
      const result = await this.productsService.getPublicProduct(slug);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns seller-scoped Products using only server-derived seller/store permissions. */
  listSellerProducts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellerProductListQuerySchema.parse(request.query);
      const result = await this.productsService.listSellerProducts(
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

  /** Returns one complete seller-private Product aggregate for the edit workflow. */
  getSellerProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      const result = await this.productsService.getSellerProduct(
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

  /** Creates one draft Product inside the authenticated seller/store scope. */
  createProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createProductBodySchema.parse(request.body);
      const result = await this.productsService.createProduct(
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

  /** Updates editable Product fields after validating seller ownership and request data. */
  updateProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      const input = updateProductBodySchema.parse(request.body);
      const result = await this.productsService.updateProduct(
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

  /** Adds one validated SKU/variant to an owned Product. */
  addVariant = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      const input = createProductVariantBodySchema.parse(request.body);
      const result = await this.productsService.addVariant(
        getRequestContext(response),
        id,
        input,
      );
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates one owned Product variant and records immutable price history when its price changes. */
  updateVariant = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id, variantId } = productVariantIdParamsSchema.parse(request.params);
      const input = updateProductVariantBodySchema.parse(request.body);
      const result = await this.productsService.updateVariant(
        getRequestContext(response),
        id,
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

  /** Links one previously confirmed authorized file as Product media. */
  linkMedia = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      const input = linkProductMediaBodySchema.parse(request.body);
      const result = await this.productsService.linkMedia(
        getRequestContext(response),
        id,
        input,
      );
      response.status(201).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Publishes a valid Product or submits it for approval according to marketplace policy. */
  publishProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      emptyProductCommandBodySchema.parse(request.body);
      const result = await this.productsService.publishProduct(
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

  /** Unpublishes one seller-owned Product through the explicit lifecycle command. */
  unpublishProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      emptyProductCommandBodySchema.parse(request.body);
      const result = await this.productsService.unpublishProduct(
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

  /** Approves one pending Product after the service revalidates all current publication rules. */
  approveProduct = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = productIdParamsSchema.parse(request.params);
      emptyProductCommandBodySchema.parse(request.body);
      const result = await this.productsService.approveProduct(
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

import type { NextFunction, Request, Response } from "express";
import {
  getOptionalRequestContext,
  getRequestContext,
} from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  categoryIdParamsSchema,
  createAttributeBodySchema,
  createBrandBodySchema,
  createCategoryBodySchema,
  replaceCategoryAttributesBodySchema,
  updateCategoryBodySchema,
} from "./catalog-taxonomy.schema.js";
import { CatalogTaxonomyService } from "./catalog-taxonomy.service.js";

/** Thin HTTP adapter for the audited Module 5 Catalog Taxonomy HTTP endpoints. */
export class CatalogTaxonomyController {
  /** Receives the service explicitly so HTTP code stays easy to test and understand. */
  constructor(private readonly catalogTaxonomyService: CatalogTaxonomyService) {}

  /** Returns the category tree, using authenticated context when an optional bearer token is present. */
  listCategories = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.catalogTaxonomyService.listCategories(
        getOptionalRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns the current attribute mapping for one validated category ID. */
  listCategoryAttributeMappings = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const result = await this.catalogTaxonomyService.listCategoryAttributeMappings(
        getOptionalRequestContext(response),
        id,
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates one category from the validated administrator request body. */
  createCategory = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createCategoryBodySchema.parse(request.body);
      const result = await this.catalogTaxonomyService.createCategory(
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

  /** Updates one category after validating its UUID path parameter and editable fields. */
  updateCategory = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const input = updateCategoryBodySchema.parse(request.body);
      const result = await this.catalogTaxonomyService.updateCategory(
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

  /** Returns brands visible to the public or the authenticated catalog actor. */
  listBrands = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.catalogTaxonomyService.listBrands(
        getOptionalRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates one brand from the validated administrator request body. */
  createBrand = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createBrandBodySchema.parse(request.body);
      const result = await this.catalogTaxonomyService.createBrand(
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

  /** Returns reusable attribute definitions and allowed values visible to the caller. */
  listAttributes = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.catalogTaxonomyService.listAttributes(
        getOptionalRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates one attribute definition and its optional allowed values atomically. */
  createAttribute = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createAttributeBodySchema.parse(request.body);
      const result = await this.catalogTaxonomyService.createAttribute(
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

  /** Replaces one category's complete attribute mapping using the validated command body. */
  replaceCategoryAttributes = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const input = replaceCategoryAttributesBodySchema.parse(request.body);
      const result = await this.catalogTaxonomyService.replaceCategoryAttributes(
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

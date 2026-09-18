import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  queueSearchReindexBodySchema,
  searchProductsQuerySchema,
  searchReindexIdParamsSchema,
  searchStoresQuerySchema,
  searchSuggestionsQuerySchema,
} from "./search-discovery.schema.js";
import { SearchDiscoveryService } from "./search-discovery.service.js";

/** Thin HTTP adapter for the public and privileged Module 19 Search endpoints. */
export class SearchDiscoveryController {
  /** Receives the Search service explicitly so HTTP behavior stays easy to isolate in tests. */
  constructor(private readonly searchService: SearchDiscoveryService) {}

  /** Parses a public Search query and maps Zod failures to the module's stable query error. */
  private parsePublicQuery<TOutput>(schema: ZodType<TOutput>, value: unknown): TOutput {
    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) throw this.searchService.searchQueryInvalid();
      throw error;
    }
  }

  /** Returns public Product cards, facets, and standard pagination metadata. */
  searchProducts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = this.parsePublicQuery(searchProductsQuerySchema, request.query);
      const result = await this.searchService.searchProducts(query);
      response.status(200).json(
        successResponse(result.data, {
          meta: result.meta,
          requestId: getRequestId(response),
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns bounded public autocomplete suggestions for the submitted text. */
  searchSuggestions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = this.parsePublicQuery(searchSuggestionsQuerySchema, request.query);
      const result = await this.searchService.searchSuggestions(query);
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns only public-safe Store records with standard pagination metadata. */
  searchStores = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = this.parsePublicQuery(searchStoresQuerySchema, request.query);
      const result = await this.searchService.searchStores(query);
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

  /** Queues one bounded full-catalog reindex for an authenticated Search administrator. */
  queueFullReindex = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      queueSearchReindexBodySchema.parse(request.body);
      const result = await this.searchService.queueFullReindex(
        getRequestContext(response),
      );
      response.status(202).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Reads one persisted full-reindex lifecycle status for an authorized administrator. */
  getReindexStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = searchReindexIdParamsSchema.parse(request.params);
      const result = await this.searchService.getReindexStatus(
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

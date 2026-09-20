import type { NextFunction, Request, Response } from "express";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  createCustomerAddressBodySchema,
  customerAddressIdParamsSchema,
  updateCustomerAddressBodySchema,
  updateCustomerProfileBodySchema,
} from "./customers.schema.js";
import { CustomersService } from "./customers.service.js";

/** Thin HTTP adapter for the eight approved Module 3 customer endpoints. */
export class CustomersController {
  /** Accepts an injectable service so HTTP tests can isolate controller behavior. */
  constructor(private readonly service: CustomersService) {}

  /** Returns the authenticated customer's commerce profile. */
  getMyProfile = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.getMyProfile(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Updates only validated self-service customer profile fields. */
  updateMyProfile = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = updateCustomerProfileBodySchema.parse(request.body);
      const result = await this.service.updateMyProfile(
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

  /** Lists active saved addresses owned by the authenticated customer. */
  listMyAddresses = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.listMyAddresses(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Creates one validated saved address for the authenticated customer. */
  createMyAddress = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createCustomerAddressBodySchema.parse(request.body);
      const result = await this.service.createMyAddress(
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

  /** Updates one validated address inside the authenticated customer's scope. */
  updateMyAddress = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = customerAddressIdParamsSchema.parse(request.params);
      const input = updateCustomerAddressBodySchema.parse(request.body);
      const result = await this.service.updateMyAddress(
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

  /** Archives one customer-owned saved address without hard-deleting it. */
  archiveMyAddress = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = customerAddressIdParamsSchema.parse(request.params);
      const result = await this.service.archiveMyAddress(
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

  /** Returns one bounded, permission-protected page of customers for administrators. */
  listCustomersForAdmin = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminCustomerListQuerySchema.parse(request.query);
      const result = await this.service.searchCustomersForAdmin(
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

  /** Returns one permission-protected customer summary using only Module 2 and Module 3 data. */
  getCustomerForAdmin = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = adminCustomerIdParamsSchema.parse(request.params);
      const result = await this.service.getCustomerSummaryForAdmin(
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


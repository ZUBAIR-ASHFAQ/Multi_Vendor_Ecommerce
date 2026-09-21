import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  commissionsReportQuerySchema,
  createReportRunBodySchema,
  inventoryReportQuerySchema,
  payoutsReportQuerySchema,
  refundsReportQuerySchema,
  reportRunIdParamsSchema,
  reportRunListQuerySchema,
  salesReportQuerySchema,
  sellersReportQuerySchema,
} from "./reports.schema.js";
import { ReportsService } from "./reports.service.js";

/** Thin HTTP adapter for the bounded Reports & Analytics operations. */
export class ReportsController {
  /** Stores the composed Reports service so handlers contain validation and transport mapping only. */
  constructor(private readonly reportsService: ReportsService) {}

  /** Returns the permission-filtered report catalog for the authenticated actor. */
  getCatalog = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.reportsService.getCatalog(getRequestContext(response));
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one bounded page of the permission-safe Sales/Orders report. */
  getSalesReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = salesReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getSalesReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of seller performance and settlement reporting. */
  getSellersReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = sellersReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getSellersReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of current Inventory and low-stock reporting. */
  getInventoryReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = inventoryReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getInventoryReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of finalized Return/Refund reporting. */
  getRefundsReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = refundsReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getRefundsReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of immutable Commission revenue reporting. */
  getCommissionsReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = commissionsReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getCommissionsReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of paid Payouts and seller-liability reporting. */
  getPayoutsReport = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = payoutsReportQuerySchema.parse(request.query);
      const result = await this.reportsService.getPayoutsReport(
        getRequestContext(response),
        query,
      );
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

  /** Returns one bounded page of durable requester-owned export history. */
  listReportRuns = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = reportRunListQuerySchema.parse(request.query);
      const result = await this.reportsService.listReportRuns(
        getRequestContext(response),
        query,
      );
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

  /** Queues one authorized asynchronous CSV/PDF export run. */
  createReportRun = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = createReportRunBodySchema.parse(request.body);
      const result = await this.reportsService.createReportRun(
        getRequestContext(response),
        body,
      );
      response.status(202).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns one requester-owned export run and an authorized download when complete. */
  getReportRun = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = reportRunIdParamsSchema.parse(request.params);
      const result = await this.reportsService.getReportRun(
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

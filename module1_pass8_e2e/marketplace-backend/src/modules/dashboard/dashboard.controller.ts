import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error.js";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import { DASHBOARD_ERROR_CODE } from "./dashboard.constants.js";
import {
  dashboardAlertsQuerySchema,
  dashboardOrdersQuerySchema,
  dashboardSellersQuerySchema,
  dashboardSummaryQuerySchema,
  updateDashboardPreferencesBodySchema,
} from "./dashboard.schema.js";
import { DashboardService } from "./dashboard.service.js";

/** Parses a Dashboard read query and maps malformed filters to the module's stable error code. */
function parseDashboardQuery<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new AppError({
    code: DASHBOARD_ERROR_CODE.FILTER_INVALID,
    message: "The Dashboard filter is invalid.",
    statusCode: 422,
  });
}

/** Thin HTTP adapter for the exact five documented Module 1 Dashboard operations. */
export class DashboardController {
  /** Stores the composed Dashboard service so handlers only validate transport input and map responses. */
  constructor(private readonly dashboardService: DashboardService) {}

  /** Returns the role/scope-aware Dashboard KPI summary and effective user preferences. */
  getSummary = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = parseDashboardQuery(dashboardSummaryQuerySchema, request.query);
      const result = await this.dashboardService.getSummary(
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

  /** Returns Dashboard Order status counts plus the exact-money GMV trend. */
  getOrders = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = parseDashboardQuery(dashboardOrdersQuerySchema, request.query);
      const result = await this.dashboardService.getOrders(
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

  /** Returns one permission-safe page of seller performance rows. */
  getSellers = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = parseDashboardQuery(dashboardSellersQuerySchema, request.query);
      const result = await this.dashboardService.getSellers(
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

  /** Returns one globally ordered page of source-owned operational alerts. */
  getAlerts = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = parseDashboardQuery(dashboardAlertsQuerySchema, request.query);
      const result = await this.dashboardService.getAlerts(
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

  /** Updates only the authenticated user's validated Dashboard preferences and saved filters. */
  updatePreferences = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = updateDashboardPreferencesBodySchema.parse(request.body);
      const result = await this.dashboardService.updatePreferences(
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

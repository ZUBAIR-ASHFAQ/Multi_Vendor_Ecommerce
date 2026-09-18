import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/middleware/authentication.middleware.js";
import { successResponse } from "../../common/utils/api-response.js";
import { getRequestId } from "../../http/request-id.js";
import {
  adminNotificationDeliveriesQuerySchema,
  markAllNotificationsReadBodySchema,
  markNotificationReadBodySchema,
  notificationDeliveryIdParamsSchema,
  notificationIdParamsSchema,
  notificationsListQuerySchema,
  retryNotificationDeliveryBodySchema,
  updateNotificationPreferencesBodySchema,
} from "./notifications.schema.js";
import { NotificationsService } from "./notifications.service.js";

/** Thin HTTP adapter for the seven documented Module 18 Notification operations. */
export class NotificationsController {
  /** Stores the composed Notifications service so HTTP handlers contain no business rules. */
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Returns one bounded page of Notifications owned by the authenticated user. */
  listNotifications = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = notificationsListQuerySchema.parse(request.query);
      const result = await this.notificationsService.listNotifications(
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

  /** Marks one owned Notification read without accepting client-owned read-state fields. */
  markNotificationRead = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = notificationIdParamsSchema.parse(request.params);
      markNotificationReadBodySchema.parse(request.body);
      const result = await this.notificationsService.markNotificationRead(
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

  /** Marks all unread Notifications for the authenticated user read. */
  markAllNotificationsRead = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      markAllNotificationsReadBodySchema.parse(request.body);
      const result = await this.notificationsService.markAllNotificationsRead(
        getRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Returns the authenticated user's editable Notification preferences. */
  getPreferences = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.notificationsService.getPreferences(
        getRequestContext(response),
      );
      response.status(200).json(
        successResponse(result, { requestId: getRequestId(response) }),
      );
    } catch (error) {
      next(error);
    }
  };

  /** Replaces the authenticated user's allowed Notification preferences after service policy checks. */
  updatePreferences = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = updateNotificationPreferencesBodySchema.parse(request.body);
      const result = await this.notificationsService.updatePreferences(
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

  /** Returns one bounded privacy-safe page of failed Notification deliveries for administrators. */
  listFailedDeliveries = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = adminNotificationDeliveriesQuerySchema.parse(request.query);
      const result = await this.notificationsService.listFailedDeliveries(
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

  /** Requeues one failed Notification delivery through the service's audited replay-safe command. */
  retryFailedDelivery = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = notificationDeliveryIdParamsSchema.parse(request.params);
      retryNotificationDeliveryBodySchema.parse(request.body);
      const result = await this.notificationsService.retryFailedDelivery(
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

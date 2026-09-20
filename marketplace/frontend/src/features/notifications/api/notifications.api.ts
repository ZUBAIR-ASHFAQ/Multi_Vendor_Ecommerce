import { apiClient } from "@/lib/api-client";
import type { ApiResponse, PaginationMeta } from "@/types/api";
import {
  adminNotificationDeliverySchema,
  markAllNotificationsReadResponseSchema,
  markNotificationReadResponseSchema,
  notificationPreferenceSchema,
  notificationSchema,
} from "../schemas/notifications.schemas";
import type {
  AdminNotificationDeliveryListParams,
  AdminNotificationDeliveryPage,
  NotificationListMeta,
  NotificationListParams,
  NotificationPage,
  UpdateNotificationPreferencesInput,
} from "../types/notifications.types";

/** Unwraps and validates one successful non-paginated Notification response. */
async function one<T>(
  request: Promise<{ data: ApiResponse<unknown> }>,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  return parse(response.data.data);
}

/** Unwraps the current-user Notification page and requires the bell unread count. */
async function notificationsPage(
  request: Promise<{ data: ApiResponse<unknown, NotificationListMeta> }>,
): Promise<NotificationPage> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Notification pagination metadata is missing.");
  return {
    items: notificationSchema.array().parse(response.data.data),
    meta: response.data.meta,
  };
}

/** Unwraps one privacy-safe failed-delivery admin page. */
async function deliveryPage(
  request: Promise<{ data: ApiResponse<unknown, PaginationMeta> }>,
): Promise<AdminNotificationDeliveryPage> {
  const response = await request;
  if (!response.data.success) throw new Error(response.data.error.message);
  if (!response.data.meta) throw new Error("Notification delivery pagination metadata is missing.");
  return {
    items: adminNotificationDeliverySchema.array().parse(response.data.data),
    meta: response.data.meta,
  };
}

export const notificationsApi = {
  /** Lists one bounded page of Notifications owned by the authenticated user. */
  listNotifications: (params: NotificationListParams) =>
    notificationsPage(apiClient.get("/notifications", { params })),

  /** Marks one owned in-app Notification read using the explicit command endpoint. */
  markRead: (notificationId: string) =>
    one(apiClient.post(`/notifications/${notificationId}/read`, {}), (value) =>
      markNotificationReadResponseSchema.parse(value),
    ),

  /** Marks all owned unread Notifications read. */
  markAllRead: () =>
    one(apiClient.post("/notifications/read-all", {}), (value) =>
      markAllNotificationsReadResponseSchema.parse(value),
    ),

  /** Reads only the authenticated user's editable event/channel preferences. */
  getPreferences: () =>
    one(apiClient.get("/notifications/preferences"), (value) =>
      notificationPreferenceSchema.array().parse(value),
    ),

  /** Atomically replaces the authenticated user's editable Notification preferences. */
  updatePreferences: (input: UpdateNotificationPreferencesInput) =>
    one(apiClient.put("/notifications/preferences", input), (value) =>
      notificationPreferenceSchema.array().parse(value),
    ),

  /** Lists one bounded page of privacy-safe failed deliveries for administrators. */
  listFailedDeliveries: (params: AdminNotificationDeliveryListParams) =>
    deliveryPage(apiClient.get("/admin/notification-deliveries", { params })),

  /** Requeues one failed delivery without accepting provider or destination overrides. */
  retryFailedDelivery: (deliveryId: string) =>
    one(apiClient.post(`/admin/notification-deliveries/${deliveryId}/retry`, {}), (value) =>
      adminNotificationDeliverySchema.parse(value),
    ),
};

import type { PaginationMeta } from "@/types/api";
import type { z } from "zod";
import type {
  adminNotificationDeliverySchema,
  notificationPreferenceSchema,
  notificationSchema,
  updateNotificationPreferencesSchema,
} from "../schemas/notifications.schemas";

export type NotificationItem = z.infer<typeof notificationSchema>;
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
export type AdminNotificationDelivery = z.infer<typeof adminNotificationDeliverySchema>;
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export interface NotificationListParams {
  page: number;
  pageSize: number;
}

export interface NotificationListMeta extends PaginationMeta {
  unreadCount: number;
}

export interface NotificationPage {
  items: NotificationItem[];
  meta: NotificationListMeta;
}

export interface AdminNotificationDeliveryListParams {
  page: number;
  pageSize: number;
}

export interface AdminNotificationDeliveryPage {
  items: AdminNotificationDelivery[];
  meta: PaginationMeta;
}

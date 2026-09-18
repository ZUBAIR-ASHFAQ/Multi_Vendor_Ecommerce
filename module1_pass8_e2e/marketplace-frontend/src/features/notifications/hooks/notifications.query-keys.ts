import type {
  AdminNotificationDeliveryListParams,
  NotificationListParams,
} from "../types/notifications.types";

/** Stable TanStack Query keys owned by Module 18. */
export const notificationsQueryKeys = {
  all: ["notifications"] as const,
  list: (params: NotificationListParams) => ["notifications", "list", params] as const,
  preferences: ["notifications", "preferences"] as const,
  adminDeliveries: (params: AdminNotificationDeliveryListParams) =>
    ["notifications", "admin-deliveries", params] as const,
};

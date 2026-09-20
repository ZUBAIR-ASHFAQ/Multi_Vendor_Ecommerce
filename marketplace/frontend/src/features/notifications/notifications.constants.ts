/** Permissions enforced by Module 18 HTTP routes and mirrored only for UI visibility. */
export const NOTIFICATIONS_PERMISSION = {
  READ_OWN: "notifications.read_own",
  PREFERENCES_MANAGE_OWN: "notifications.preferences.manage_own",
  ADMIN_READ: "admin.notifications.read",
  ADMIN_RETRY: "admin.notifications.retry",
} as const;

/** Delivery channels currently supported by the backend persistence contract. */
export const NOTIFICATION_CHANNEL_VALUES = ["in_app", "email"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

export const NOTIFICATION_CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "In app",
  email: "Email",
};

/** Delivery statuses returned by the admin failure/retry API. */
export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  "queued",
  "processing",
  "sent",
  "failed",
] as const;

export type NotificationDeliveryStatus =
  (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

export const NOTIFICATION_DELIVERY_STATUS_LABEL: Record<
  NotificationDeliveryStatus,
  string
> = {
  queued: "Queued",
  processing: "Processing",
  sent: "Sent",
  failed: "Failed",
};

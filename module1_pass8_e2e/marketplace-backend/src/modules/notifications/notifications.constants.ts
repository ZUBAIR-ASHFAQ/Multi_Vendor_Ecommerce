/** Delivery channels supported by the Module 18 persistence and delivery contract. */
export const NOTIFICATION_CHANNEL = {
  IN_APP: "in_app",
  EMAIL: "email",
} as const;

export const NOTIFICATION_CHANNEL_VALUES = [
  NOTIFICATION_CHANNEL.IN_APP,
  NOTIFICATION_CHANNEL.EMAIL,
] as const;

/** Versioned template lifecycle states persisted by Module 18. */
export const NOTIFICATION_TEMPLATE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export const NOTIFICATION_TEMPLATE_STATUS_VALUES = [
  NOTIFICATION_TEMPLATE_STATUS.ACTIVE,
  NOTIFICATION_TEMPLATE_STATUS.INACTIVE,
] as const;

/** Retryable delivery lifecycle states persisted by Module 18. */
export const NOTIFICATION_DELIVERY_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED: "failed",
} as const;

export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  NOTIFICATION_DELIVERY_STATUS.QUEUED,
  NOTIFICATION_DELIVERY_STATUS.PROCESSING,
  NOTIFICATION_DELIVERY_STATUS.SENT,
  NOTIFICATION_DELIVERY_STATUS.FAILED,
] as const;


/** BullMQ names owned by Module 18 so Foundation fan-out and the worker cannot drift. */
export const NOTIFICATIONS_JOB = {
  SOURCE_EVENT_QUEUE: "notifications-source-events",
} as const;

/** Stable provider-facing error codes persisted without leaking provider response bodies. */
export const NOTIFICATIONS_PROVIDER_ERROR_CODE = {
  UNCONFIGURED: "EMAIL_PROVIDER_UNCONFIGURED",
  REQUEST_FAILED: "EMAIL_PROVIDER_REQUEST_FAILED",
  RESPONSE_INVALID: "EMAIL_PROVIDER_RESPONSE_INVALID",
  DELIVERY_FAILED: "EMAIL_PROVIDER_DELIVERY_FAILED",
} as const;

/** Module 18 permissions required by the controlling guide. */
export const NOTIFICATIONS_PERMISSION = {
  READ_OWN: "notifications.read_own",
  PREFERENCES_MANAGE_OWN: "notifications.preferences.manage_own",
  ADMIN_READ: "admin.notifications.read",
  ADMIN_RETRY: "admin.notifications.retry",
} as const;

/** Permission metadata composed into the central platform RBAC seed. */
export const NOTIFICATIONS_PERMISSION_CATALOG = [
  {
    code: NOTIFICATIONS_PERMISSION.READ_OWN,
    domain: "notifications",
    description: "Read and update read-state for the authenticated user's own Notifications.",
  },
  {
    code: NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
    domain: "notifications",
    description: "Read and update the authenticated user's allowed Notification preferences.",
  },
  {
    code: NOTIFICATIONS_PERMISSION.ADMIN_READ,
    domain: "notifications",
    description: "Read privacy-safe Notification delivery failure information for platform support.",
  },
  {
    code: NOTIFICATIONS_PERMISSION.ADMIN_RETRY,
    domain: "notifications",
    description: "Retry a failed Notification delivery using the original durable event identity.",
  },
] as const;

/** Stable Module 18 business error codes required by the controlling guide. */
export const NOTIFICATIONS_ERROR_CODE = {
  NOT_FOUND: "NOTIFICATION_NOT_FOUND",
  TEMPLATE_MISSING: "NOTIFICATION_TEMPLATE_MISSING",
  DELIVERY_FAILED: "NOTIFICATION_DELIVERY_FAILED",
  SCOPE_FORBIDDEN: "NOTIFICATION_SCOPE_FORBIDDEN",
} as const;

/** Exact Module 18 HTTP paths required by the controlling guide. */
export const NOTIFICATIONS_PATH = {
  LIST: "/api/v1/notifications",
  READ_ONE: "/api/v1/notifications/:id/read",
  READ_ALL: "/api/v1/notifications/read-all",
  PREFERENCES_GET: "/api/v1/notifications/preferences",
  PREFERENCES_UPDATE: "/api/v1/notifications/preferences",
  ADMIN_DELIVERIES: "/api/v1/admin/notification-deliveries",
  ADMIN_RETRY: "/api/v1/admin/notification-deliveries/:id/retry",
} as const;

/** Stable audit actions for privileged Module 18 lifecycle commands. */
export const NOTIFICATIONS_AUDIT_ACTION = {
  DELIVERY_RETRY_REQUESTED: "notifications.delivery_retry_requested",
} as const;

/** Resource names shared by Notification audit and durable lifecycle events. */
export const NOTIFICATIONS_RESOURCE_TYPE = {
  NOTIFICATION: "notification",
  NOTIFICATION_USER: "notification_user",
  DELIVERY: "notification_delivery",
} as const;

/** Durable Module 18 events named by the controlling guide. */
export const NOTIFICATIONS_OUTBOX_EVENT = {
  QUEUED: "notification.queued",
  SENT: "notification.sent",
  FAILED: "notification.failed",
  READ: "notification.read",
} as const;

/** Database-backed string limits shared by the Module 18 boundary schemas. */
export const NOTIFICATIONS_LIMITS = {
  CODE_MAX_LENGTH: 120,
  TYPE_MAX_LENGTH: 120,
  TITLE_MAX_LENGTH: 240,
  DESTINATION_MASKED_MAX_LENGTH: 320,
  PROVIDER_REF_MAX_LENGTH: 255,
  ERROR_CODE_MAX_LENGTH: 100,
} as const;

/** Normalized code format already enforced by the Module 18 database constraints. */
export const NOTIFICATION_CODE_PATTERN = /^[a-z][a-z0-9_.-]*$/u;

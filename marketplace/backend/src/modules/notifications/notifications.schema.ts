import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_CODE_PATTERN,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
  NOTIFICATION_TEMPLATE_STATUS_VALUES,
  NOTIFICATIONS_LIMITS,
} from "./notifications.constants.js";

/** Builds one trimmed non-blank string contract with a database-backed maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Normalizes event/template/type codes to the format enforced by PostgreSQL. */
function normalizedNotificationCode(maxLength = NOTIFICATIONS_LIMITS.CODE_MAX_LENGTH) {
  return z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(maxLength)
    .regex(NOTIFICATION_CODE_PATTERN, "Invalid notification code");
}

/** Supported in-app/email channel contract. */
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNEL_VALUES);

/** Persisted Notification template lifecycle contract. */
export const notificationTemplateStatusSchema = z.enum(
  NOTIFICATION_TEMPLATE_STATUS_VALUES,
);

/** Persisted Notification delivery lifecycle contract. */
export const notificationDeliveryStatusSchema = z.enum(
  NOTIFICATION_DELIVERY_STATUS_VALUES,
);

/** Normalized event code used by user preference records. */
export const notificationEventCodeSchema = normalizedNotificationCode();

/** Normalized template code used by template and delivery records. */
export const notificationTemplateCodeSchema = normalizedNotificationCode();

/** Normalized in-app Notification type derived from a committed domain event. */
export const notificationTypeSchema = normalizedNotificationCode(
  NOTIFICATIONS_LIMITS.TYPE_MAX_LENGTH,
);

/** Notification identifier used by the mark-read command. */
export const notificationIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Delivery identifier used by the privileged retry command. */
export const notificationDeliveryIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Current-user Notification list accepts bounded pagination only; no undocumented filters are exposed. */
export const notificationsListQuerySchema = paginationQuerySchema.strict();

/** Admin failure queue accepts bounded pagination only; failure state is fixed by route semantics. */
export const adminNotificationDeliveriesQuerySchema = paginationQuerySchema.strict();

/** Mark-read is a replay-safe command and accepts no client-owned state. */
export const markNotificationReadBodySchema = z.object({}).strict().default({});

/** Mark-all-read is a replay-safe command and accepts no client-owned state. */
export const markAllNotificationsReadBodySchema = z.object({}).strict().default({});

/** Admin retry reuses the original delivery/event identity and accepts no provider-owned overrides. */
export const retryNotificationDeliveryBodySchema = z.object({}).strict().default({});

/** One user-selectable Notification preference entry. Mandatory policy is enforced later in the service. */
export const notificationPreferenceInputSchema = z
  .object({
    eventCode: notificationEventCodeSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();

/** Updates the caller's allow-listed event/channel preferences without accepting user identity. */
export const updateNotificationPreferencesBodySchema = z
  .object({
    preferences: z.array(notificationPreferenceInputSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.preferences.forEach((preference, index) => {
      const key = `${preference.eventCode}:${preference.channel}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Each notification event/channel preference may appear only once.",
          path: ["preferences", index],
        });
      }
      seen.add(key);
    });
  });

/** Safe in-app Notification representation scoped to its owning user by the service/repository layers. */
export const notificationResponseSchema = z
  .object({
    id: uuidSchema,
    type: notificationTypeSchema,
    title: nonBlankString(NOTIFICATIONS_LIMITS.TITLE_MAX_LENGTH),
    body: z.string().trim().min(1),
    data: z.record(z.string(), z.unknown()),
    readAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Current-user Notification list data follows the normal paginated-list envelope. */
export const notificationsListDataSchema = z.array(notificationResponseSchema);

/** Pagination metadata extended with a global unread count for the required notification bell. */
export const notificationsListMetaSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    unreadCount: z.number().int().nonnegative(),
  })
  .strict();

/** User preference response contains only the event/channel choice and no identity field. */
export const notificationPreferenceResponseSchema = notificationPreferenceInputSchema;

/** Preference GET/PUT responses return the caller's current effective editable entries. */
export const notificationPreferencesResponseSchema = z.array(
  notificationPreferenceResponseSchema,
);

/** Mark-one-read result exposes only the owned Notification identifier and resulting read timestamp. */
export const markNotificationReadResponseSchema = z
  .object({
    id: uuidSchema,
    readAt: isoDateTimeSchema,
  })
  .strict();

/** Mark-all-read result reports the number of the caller's rows changed by the command. */
export const markAllNotificationsReadResponseSchema = z
  .object({
    updatedCount: z.number().int().nonnegative(),
  })
  .strict();

/** Privacy-safe admin delivery row keeps the stored destination masked and omits provider credentials. */
export const adminNotificationDeliveryResponseSchema = z
  .object({
    id: uuidSchema,
    notificationId: uuidSchema.nullable(),
    userId: uuidSchema,
    channel: notificationChannelSchema,
    templateCode: notificationTemplateCodeSchema,
    destinationMasked: nonBlankString(NOTIFICATIONS_LIMITS.DESTINATION_MASKED_MAX_LENGTH),
    status: notificationDeliveryStatusSchema,
    attempts: z.number().int().nonnegative(),
    providerRef: nonBlankString(NOTIFICATIONS_LIMITS.PROVIDER_REF_MAX_LENGTH).nullable(),
    lastErrorCode: nonBlankString(NOTIFICATIONS_LIMITS.ERROR_CODE_MAX_LENGTH).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Admin failure queue uses the normal paginated list envelope. */
export const adminNotificationDeliveriesListDataSchema = z.array(
  adminNotificationDeliveryResponseSchema,
);

/** Internal template boundary used by later repository/service work without exposing template CRUD routes. */
export const notificationTemplateRecordSchema = z
  .object({
    id: uuidSchema,
    code: notificationTemplateCodeSchema,
    channel: notificationChannelSchema,
    subjectTemplate: z.string().trim().min(1).nullable(),
    bodyTemplate: z.string().trim().min(1),
    status: notificationTemplateStatusSchema,
    version: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationDeliveryStatus = z.infer<typeof notificationDeliveryStatusSchema>;
export type NotificationsListQuery = z.infer<typeof notificationsListQuerySchema>;
export type AdminNotificationDeliveriesQuery = z.infer<
  typeof adminNotificationDeliveriesQuerySchema
>;
export type UpdateNotificationPreferencesBody = z.infer<
  typeof updateNotificationPreferencesBodySchema
>;
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
export type NotificationsListMeta = z.infer<typeof notificationsListMetaSchema>;
export type NotificationPreferenceResponse = z.infer<
  typeof notificationPreferenceResponseSchema
>;
export type AdminNotificationDeliveryResponse = z.infer<
  typeof adminNotificationDeliveryResponseSchema
>;

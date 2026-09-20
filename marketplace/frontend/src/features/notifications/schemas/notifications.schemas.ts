import { z } from "zod";
import {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
} from "../notifications.constants";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const notificationCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Event code is required.")
  .max(120)
  .regex(/^[a-z][a-z0-9_.-]*$/, "Use a normalized event code starting with a letter, such as order.created.");

/** Safe current-user in-app Notification returned by Module 18. */
export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationCodeSchema,
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  data: z.record(z.string(), z.unknown()),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
}).strict();

/** Editable event/channel preference returned to and submitted by the current user. */
export const notificationPreferenceSchema = z.object({
  eventCode: notificationCodeSchema,
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  enabled: z.boolean(),
}).strict();

/** TanStack Form contract for adding or replacing one editable preference. */
export const notificationPreferenceFormSchema = notificationPreferenceSchema;

/** PUT payload mirrors the backend replace-all preference contract. */
export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
}).strict();

/** Privacy-safe failed delivery row returned to administrators. */
export const adminNotificationDeliverySchema = z.object({
  id: z.string().uuid(),
  notificationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  templateCode: notificationCodeSchema,
  destinationMasked: z.string().trim().min(1),
  status: z.enum(NOTIFICATION_DELIVERY_STATUS_VALUES),
  attempts: z.number().int().nonnegative(),
  providerRef: z.string().trim().min(1).nullable(),
  lastErrorCode: z.string().trim().min(1).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

/** Mark-read response keeps only the owned Notification id and server timestamp. */
export const markNotificationReadResponseSchema = z.object({
  id: z.string().uuid(),
  readAt: isoDateTimeSchema,
}).strict();

/** Mark-all-read response reports the number of changed rows. */
export const markAllNotificationsReadResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
}).strict();

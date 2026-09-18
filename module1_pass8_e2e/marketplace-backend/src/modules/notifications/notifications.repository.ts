import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import { outboxEvents, type OutboxEventRow } from "../../database/schema/foundation.js";
import {
  notificationDeliveries,
  notificationPreferences,
  notifications,
  notificationTemplates,
  type NewNotificationDeliveryRow,
  type NewNotificationPreferenceRow,
  type NewNotificationRow,
  type NewNotificationTemplateRow,
  type NotificationDeliveryRow,
  type NotificationPreferenceRow,
  type NotificationRow,
  type NotificationTemplateRow,
} from "../../database/schema/notifications.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_TEMPLATE_STATUS,
} from "./notifications.constants.js";
import type {
  AdminNotificationDeliveriesQuery,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationsListQuery,
} from "./notifications.schema.js";

/** One bounded page of user-owned in-app Notifications plus the global unread count. */
export interface PaginatedNotificationRows {
  items: NotificationRow[];
  totalItems: number;
  unreadCount: number;
}

/** One editable preference already normalized and policy-approved by the service. */
export interface NotificationPreferenceRecordInput {
  eventCode: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/** Stable built-in template values inserted only when the same version does not already exist. */
export interface EnsureNotificationTemplateInput {
  code: string;
  channel: NotificationChannel;
  subjectTemplate: string | null;
  bodyTemplate: string;
  version: number;
}

/** Service-approved fields required to create one durable in-app Notification. */
export interface CreateNotificationRecordInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  dataJson?: Record<string, unknown>;
  createdAt?: Date;
}

/** Service-approved identity and routing fields for one idempotent delivery record. */
export interface CreateNotificationDeliveryRecordInput {
  notificationId?: string | null;
  sourceEventId: string;
  userId: string;
  channel: NotificationChannel;
  templateCode: string;
  destinationMasked: string;
  status?: NotificationDeliveryStatus;
  attempts?: number;
  providerRef?: string | null;
  lastErrorCode?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Complete service-approved delivery state persisted after one queue/provider attempt. */
export interface UpdateNotificationDeliveryRecordInput {
  status: NotificationDeliveryStatus;
  attempts: number;
  providerRef: string | null;
  lastErrorCode: string | null;
  updatedAt?: Date;
}

/** Privacy-safe failed-delivery projection used by the privileged admin queue. */
export interface AdminNotificationDeliveryRow {
  id: string;
  notificationId: string | null;
  userId: string;
  channel: string;
  templateCode: string;
  destinationMasked: string;
  status: string;
  attempts: number;
  providerRef: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One bounded page of failed deliveries before the service maps them to API responses. */
export interface PaginatedAdminNotificationDeliveryRows {
  items: AdminNotificationDeliveryRow[];
  totalItems: number;
}

/** Builds the privacy-safe admin delivery projection without exposing source payloads or raw destinations. */
function adminDeliverySelection() {
  return {
    id: notificationDeliveries.id,
    notificationId: notificationDeliveries.notificationId,
    userId: notificationDeliveries.userId,
    channel: notificationDeliveries.channel,
    templateCode: notificationDeliveries.templateCode,
    destinationMasked: notificationDeliveries.destinationMasked,
    status: notificationDeliveries.status,
    attempts: notificationDeliveries.attempts,
    providerRef: notificationDeliveries.providerRef,
    lastErrorCode: notificationDeliveries.lastErrorCode,
    createdAt: notificationDeliveries.createdAt,
    updatedAt: notificationDeliveries.updatedAt,
  };
}

/**
 * Drizzle-only persistence boundary for Module 18 Notifications.
 * Recipient policy, mandatory channels, rendering, retry eligibility, audit, queueing, and provider calls stay in services/workers.
 */
export class NotificationsRepository {
  /** Creates a repository around the root database client or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): NotificationsRepository {
    return new NotificationsRepository(executor);
  }

  /** Lists only Notifications owned by one authenticated user with deterministic newest-first pagination. */
  async listOwnedNotifications(
    userId: string,
    query: NotificationsListQuery,
  ): Promise<PaginatedNotificationRows> {
    const { limit, offset } = toLimitOffset(query);

    const items = await this.executor
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), asc(notifications.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(notifications)
      .where(eq(notifications.userId, userId));

    const [unreadRow] = await this.executor
      .select({ unreadCount: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
      unreadCount: Number(unreadRow?.unreadCount ?? 0),
    };
  }

  /** Reads one Notification only when it belongs to the authenticated user. */
  async findOwnedNotificationById(
    notificationId: string,
    userId: string,
  ): Promise<NotificationRow | null> {
    const [row] = await this.executor
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Marks one unread Notification read only inside the authenticated user's ownership scope. */
  async markOwnedNotificationRead(
    notificationId: string,
    userId: string,
    readAt: Date,
  ): Promise<NotificationRow | null> {
    const [row] = await this.executor
      .update(notifications)
      .set({ readAt })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Marks every currently unread Notification for one authenticated user and returns the changed-row count. */
  async markAllOwnedNotificationsRead(userId: string, readAt: Date): Promise<number> {
    const rows = await this.executor
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });

    return rows.length;
  }

  /** Creates one durable in-app Notification using fields already rendered and approved by the service. */
  async createNotification(input: CreateNotificationRecordInput): Promise<NotificationRow> {
    const values: NewNotificationRow = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      dataJson: input.dataJson ?? {},
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
    };

    const [row] = await this.executor.insert(notifications).values(values).returning();
    if (!row) throw new Error("Notification insert completed without returning a row.");
    return row;
  }

  /** Lists one user's editable event/channel preferences in deterministic order. */
  async listUserPreferences(userId: string): Promise<NotificationPreferenceRow[]> {
    return this.executor
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .orderBy(asc(notificationPreferences.eventCode), asc(notificationPreferences.channel));
  }

  /** Reads one persisted preference for dispatcher policy resolution without applying defaults itself. */
  async findUserPreference(
    userId: string,
    eventCode: string,
    channel: NotificationChannel,
  ): Promise<NotificationPreferenceRow | null> {
    const [row] = await this.executor
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.eventCode, eventCode),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Replaces one user's persisted editable preferences; callers bind a transaction when replacement must be atomic. */
  async replaceUserPreferences(
    userId: string,
    inputs: NotificationPreferenceRecordInput[],
    updatedAt = new Date(),
  ): Promise<NotificationPreferenceRow[]> {
    await this.executor
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    if (inputs.length > 0) {
      const values: NewNotificationPreferenceRow[] = inputs.map((input) => ({
        userId,
        eventCode: input.eventCode,
        channel: input.channel,
        enabled: input.enabled,
        updatedAt,
      }));
      await this.executor.insert(notificationPreferences).values(values);
    }

    return this.listUserPreferences(userId);
  }

  /** Ensures one built-in active template version exists without overwriting operator-managed rows. */
  async ensureTemplate(input: EnsureNotificationTemplateInput): Promise<NotificationTemplateRow> {
    const current = await this.findActiveTemplate(input.code, input.channel);
    if (current) return current;

    const values: NewNotificationTemplateRow = {
      code: input.code,
      channel: input.channel,
      subjectTemplate: input.subjectTemplate,
      bodyTemplate: input.bodyTemplate,
      status: NOTIFICATION_TEMPLATE_STATUS.ACTIVE,
      version: input.version,
    };
    await this.executor
      .insert(notificationTemplates)
      .values(values)
      .onConflictDoNothing({
        target: [
          notificationTemplates.code,
          notificationTemplates.channel,
          notificationTemplates.version,
        ],
      });

    const ensured = await this.findActiveTemplate(input.code, input.channel);
    if (!ensured) {
      throw new Error(`Active Notification template could not be ensured: ${input.code}/${input.channel}.`);
    }
    return ensured;
  }

  /** Resolves the single active template for an exact normalized template code and supported channel. */
  async findActiveTemplate(
    code: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplateRow | null> {
    const [row] = await this.executor
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.code, code),
          eq(notificationTemplates.channel, channel),
          eq(notificationTemplates.status, NOTIFICATION_TEMPLATE_STATUS.ACTIVE),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Reads the durable Foundation source event by ID without making notification-policy decisions. */
  async findSourceEventById(sourceEventId: string): Promise<OutboxEventRow | null> {
    const [row] = await this.executor
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, sourceEventId))
      .limit(1);

    return row ?? null;
  }

  /** Reads one delivery using the database-enforced event/recipient/channel idempotency identity. */
  async findDeliveryByEventRecipientChannel(
    sourceEventId: string,
    userId: string,
    channel: NotificationChannel,
  ): Promise<NotificationDeliveryRow | null> {
    const [row] = await this.executor
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.sourceEventId, sourceEventId),
          eq(notificationDeliveries.userId, userId),
          eq(notificationDeliveries.channel, channel),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Inserts one delivery and returns null when the same event/recipient/channel identity already exists. */
  async createDeliveryIfMissing(
    input: CreateNotificationDeliveryRecordInput,
  ): Promise<NotificationDeliveryRow | null> {
    const values: NewNotificationDeliveryRow = {
      notificationId: input.notificationId ?? null,
      sourceEventId: input.sourceEventId,
      userId: input.userId,
      channel: input.channel,
      templateCode: input.templateCode,
      destinationMasked: input.destinationMasked,
      status: input.status ?? NOTIFICATION_DELIVERY_STATUS.QUEUED,
      attempts: input.attempts ?? 0,
      providerRef: input.providerRef ?? null,
      lastErrorCode: input.lastErrorCode ?? null,
      ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
      ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    };

    const [row] = await this.executor
      .insert(notificationDeliveries)
      .values(values)
      .onConflictDoNothing({
        target: [
          notificationDeliveries.sourceEventId,
          notificationDeliveries.userId,
          notificationDeliveries.channel,
        ],
      })
      .returning();

    return row ?? null;
  }

  /** Attaches one newly created in-app Notification to its already-idempotent delivery row exactly once. */
  async attachNotificationToDelivery(
    deliveryId: string,
    notificationId: string,
    updatedAt = new Date(),
  ): Promise<NotificationDeliveryRow | null> {
    const [row] = await this.executor
      .update(notificationDeliveries)
      .set({ notificationId, updatedAt })
      .where(
        and(
          eq(notificationDeliveries.id, deliveryId),
          isNull(notificationDeliveries.notificationId),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Locks one delivery before a retry/lifecycle service transaction so attempt state cannot race. */
  async findDeliveryByIdForUpdate(
    deliveryId: string,
  ): Promise<NotificationDeliveryRow | null> {
    const [row] = await this.executor
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Persists the complete delivery lifecycle state already chosen by the service/worker. */
  async updateDeliveryState(
    deliveryId: string,
    input: UpdateNotificationDeliveryRecordInput,
  ): Promise<NotificationDeliveryRow | null> {
    const [row] = await this.executor
      .update(notificationDeliveries)
      .set({
        status: input.status,
        attempts: input.attempts,
        providerRef: input.providerRef,
        lastErrorCode: input.lastErrorCode,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(eq(notificationDeliveries.id, deliveryId))
      .returning();

    return row ?? null;
  }

  /** Lists only failed delivery rows for the privileged admin queue using a privacy-safe projection. */
  async listFailedDeliveries(
    query: AdminNotificationDeliveriesQuery,
  ): Promise<PaginatedAdminNotificationDeliveryRows> {
    const { limit, offset } = toLimitOffset(query);
    const failed = eq(
      notificationDeliveries.status,
      NOTIFICATION_DELIVERY_STATUS.FAILED,
    );

    const items = await this.executor
      .select(adminDeliverySelection())
      .from(notificationDeliveries)
      .where(failed)
      .orderBy(desc(notificationDeliveries.createdAt), asc(notificationDeliveries.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(notificationDeliveries)
      .where(failed);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }
}

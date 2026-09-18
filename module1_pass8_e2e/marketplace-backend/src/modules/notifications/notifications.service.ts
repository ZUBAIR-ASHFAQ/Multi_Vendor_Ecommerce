import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { uuidSchema } from "../../common/schemas/primitives.schema.js";
import type { PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import type { NotificationRealtimePublisher } from "../../common/realtime/realtime.service.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type { OutboxEventRow } from "../../database/schema/foundation.js";
import type {
  NotificationDeliveryRow,
  NotificationRow,
  NotificationTemplateRow,
} from "../../database/schema/notifications.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import type { NotificationEmailProvider } from "../../integrations/email/notification-email-provider.contract.js";
import { DisabledNotificationEmailProvider } from "../../integrations/email/notification-email-provider.factory.js";
import { AdministrationService } from "../administration/administration.service.js";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATIONS_AUDIT_ACTION,
  NOTIFICATIONS_ERROR_CODE,
  NOTIFICATIONS_OUTBOX_EVENT,
  NOTIFICATIONS_PERMISSION,
  NOTIFICATIONS_RESOURCE_TYPE,
} from "./notifications.constants.js";
import {
  NotificationsRepository,
  type AdminNotificationDeliveryRow,
} from "./notifications.repository.js";
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DefaultNotificationDispatchPolicy,
} from "./notifications.policy.js";
import {
  notificationChannelSchema,
  notificationEventCodeSchema,
  notificationTemplateCodeSchema,
  notificationTypeSchema,
  type AdminNotificationDeliveriesQuery,
  type AdminNotificationDeliveryResponse,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationPreferenceResponse,
  type NotificationResponse,
  type NotificationsListMeta,
  type NotificationsListQuery,
  type UpdateNotificationPreferencesBody,
} from "./notifications.schema.js";

/** Scalar values accepted by the deliberately non-executable template renderer. */
export type NotificationTemplateValue = string | number | boolean | null;

/** One recipient/channel instruction returned by source-event notification policy. */
export interface NotificationDispatchTarget {
  userId: string;
  channel: NotificationChannel;
  templateCode: string;
  notificationType?: string;
  mandatory?: boolean;
  variables: Record<string, NotificationTemplateValue>;
  allowedVariables: readonly string[];
  data?: Record<string, unknown>;
}

/** Source-event policy keeps event-to-recipient/template knowledge outside transactional source modules. */
export interface NotificationDispatchPolicy {
  /** Maps one already-committed Foundation outbox event to zero or more Notification targets. */
  resolveTargets(sourceEvent: OutboxEventRow): Promise<readonly NotificationDispatchTarget[]>;

  /** Returns whether a user may disable one event/channel preference. */
  isMandatory(eventCode: string, channel: NotificationChannel): boolean;
}

/** Summary returned after one committed source event is prepared for Notification delivery. */
export interface NotificationDispatchResult {
  sourceEventId: string;
  preparedCount: number;
  replayedCount: number;
  skippedCount: number;
  deliveries: NotificationPreparedDelivery[];
}

/** Privacy-safe result for one target prepared, replayed, or skipped by preference policy. */
export interface NotificationPreparedDelivery {
  userId: string;
  channel: NotificationChannel;
  deliveryId: string | null;
  notificationId: string | null;
  replayed: boolean;
  skipped: boolean;
}

/** Paginated current-user Notification result consumed by the later HTTP controller pass. */
export interface PaginatedNotificationsResult {
  items: NotificationResponse[];
  meta: NotificationsListMeta;
}

/** Paginated privileged delivery-failure result consumed by the later HTTP controller pass. */
export interface PaginatedAdminNotificationDeliveriesResult {
  items: AdminNotificationDeliveryResponse[];
  meta: PaginationMeta;
}

/** Narrow repository surface used by service orchestration and easy service-level test doubles. */
type NotificationsRepositoryPort = Pick<
  NotificationsRepository,
  | "listOwnedNotifications"
  | "findOwnedNotificationById"
  | "markOwnedNotificationRead"
  | "markAllOwnedNotificationsRead"
  | "listUserPreferences"
  | "findUserPreference"
  | "replaceUserPreferences"
  | "ensureTemplate"
  | "findActiveTemplate"
  | "findSourceEventById"
  | "findDeliveryByEventRecipientChannel"
  | "createDeliveryIfMissing"
  | "attachNotificationToDelivery"
  | "createNotification"
  | "findDeliveryByIdForUpdate"
  | "updateDeliveryState"
  | "listFailedDeliveries"
>;

/** Minimal Module 2 identity boundary needed to mask an email destination before persistence. */
interface NotificationRecipientDirectory {
  /** Resolves only the durable user id and normalized email needed to prepare a masked delivery destination. */
  resolveNotificationRecipient(userId: string): Promise<{ id: string; email: string } | null>;
}

/** Transaction-aware audit boundary used only for privileged Notification lifecycle commands. */
interface NotificationsAuditIntegration {
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Transaction-aware outbox boundary used for durable Notification lifecycle events. */
interface NotificationsOutboxIntegration {
  enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Transaction runner kept injectable so service invariants can be tested without HTTP wiring. */
type NotificationsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Explicit service dependencies keep persistence, policy, identity, audit, and outbox concerns replaceable in tests. */
export interface NotificationsServiceDependencies {
  repository?: NotificationsRepositoryPort;
  repositoryUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => NotificationsRepositoryPort;
  administration?: NotificationRecipientDirectory;
  emailProvider?: NotificationEmailProvider;
  realtimePublisher?: NotificationRealtimePublisher;
  administrationUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => NotificationRecipientDirectory;
  auditUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => NotificationsAuditIntegration;
  outboxUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => NotificationsOutboxIntegration;
  transactionRunner?: NotificationsTransactionRunner;
  dispatchPolicy?: NotificationDispatchPolicy;
  now?: () => Date;
}

/** Returns true only for a plain object that can safely back the public Notification data field. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Masks a normalized email while retaining enough domain context for support diagnostics. */
function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return "***";
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${localPart.slice(0, 1)}***@${domain}`;
}

/** Converts one allow-listed scalar template value without evaluating expressions or object paths. */
function renderTemplateValue(value: NotificationTemplateValue): string {
  if (value === null) return "";
  return String(value);
}

/** Creates one stable Module 18 application error with a safe public message. */
function notificationError(
  code: string,
  message: string,
  statusCode: number,
): AppError {
  return new AppError({ code, message, statusCode });
}

/**
 * Module 18 business service.
 * Source modules only commit outbox events; this service owns preference policy, templates, durable delivery preparation,
 * read state, privileged retry policy, audit evidence, and Notification lifecycle outbox events.
 */
export class NotificationsService {
  private readonly repository: NotificationsRepositoryPort;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => NotificationsRepositoryPort;
  private readonly administration: NotificationRecipientDirectory;
  private readonly emailProvider: NotificationEmailProvider;
  private readonly realtimePublisher: NotificationRealtimePublisher | null;
  private readonly administrationUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => NotificationRecipientDirectory;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => NotificationsAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => NotificationsOutboxIntegration;
  private readonly transactionRunner: NotificationsTransactionRunner;
  private readonly dispatchPolicy: NotificationDispatchPolicy;
  private readonly now: () => Date;

  /** Stores explicit dependencies while preserving the released database/audit/outbox services as defaults. */
  constructor(dependencies: NotificationsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new NotificationsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ??
      ((transaction) => new NotificationsRepository(transaction));
    this.administration = dependencies.administration ?? new AdministrationService();
    this.emailProvider = dependencies.emailProvider ?? new DisabledNotificationEmailProvider();
    this.realtimePublisher = dependencies.realtimePublisher ?? null;
    this.administrationUsingTransaction =
      dependencies.administrationUsingTransaction ??
      ((transaction) => AdministrationService.using(transaction));
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.dispatchPolicy = dependencies.dispatchPolicy ?? new DefaultNotificationDispatchPolicy();
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Ensures the small built-in direct-recipient template catalog exists before background delivery starts. */
  async ensureDefaultTemplates(): Promise<void> {
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      await this.repository.ensureTemplate(template);
    }
  }

  /** Processes one queued delivery idempotently; email provider calls happen outside database transactions. */
  async processQueuedDelivery(deliveryId: string): Promise<void> {
    const claim = await this.claimDeliveryAttempt(deliveryId);
    if (!claim.shouldDeliver) return;

    let providerRef: string | null = null;
    if (claim.delivery.channel === NOTIFICATION_CHANNEL.EMAIL) {
      const message = await this.resolveEmailMessage(claim.delivery);
      const result = await this.emailProvider.sendEmail({
        to: message.to,
        subject: message.subject,
        text: message.body,
        idempotencyKey: claim.delivery.id,
      });
      providerRef = result.providerRef;
    }

    await this.markDeliverySent(claim.delivery.id, providerRef);
  }

  /** Records one worker attempt failure and emits notification.failed only after BullMQ exhausts retries. */
  async recordDeliveryFailure(
    deliveryId: string,
    errorCode: string,
    finalAttempt: boolean,
  ): Promise<void> {
    await this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findDeliveryByIdForUpdate(deliveryId);
      if (!current || current.status === NOTIFICATION_DELIVERY_STATUS.SENT) return;

      const updated = await repository.updateDeliveryState(deliveryId, {
        status: finalAttempt
          ? NOTIFICATION_DELIVERY_STATUS.FAILED
          : NOTIFICATION_DELIVERY_STATUS.QUEUED,
        attempts: current.attempts,
        providerRef: current.providerRef,
        lastErrorCode: errorCode,
        updatedAt: this.now(),
      });
      if (!updated) return;

      if (finalAttempt) {
        await this.outboxUsingTransaction(transaction).enqueue({
          eventType: NOTIFICATIONS_OUTBOX_EVENT.FAILED,
          aggregateType: NOTIFICATIONS_RESOURCE_TYPE.DELIVERY,
          aggregateId: updated.id,
          payload: this.deliveryEventPayload(updated, "source_event"),
        });
      }
    });
  }

  /** Lists only the authenticated user's Notifications and includes the global unread count for the bell UI. */
  async listNotifications(
    context: RequestContext,
    query: NotificationsListQuery,
  ): Promise<PaginatedNotificationsResult> {
    const userId = this.requireActorWithPermission(context, NOTIFICATIONS_PERMISSION.READ_OWN);
    const result = await this.repository.listOwnedNotifications(userId, query);
    return {
      items: result.items.map((row) => this.toNotificationResponse(row)),
      meta: {
        ...paginationMeta(query, result.totalItems),
        unreadCount: result.unreadCount,
      },
    };
  }

  /** Marks one owned Notification read exactly once and emits notification.read only for the state-changing attempt. */
  async markNotificationRead(
    context: RequestContext,
    notificationId: string,
  ): Promise<{ id: string; readAt: string }> {
    const userId = this.requireActorWithPermission(context, NOTIFICATIONS_PERMISSION.READ_OWN);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findOwnedNotificationById(notificationId, userId);
      if (!current) throw this.notFound();
      if (current.readAt) return { id: current.id, readAt: current.readAt.toISOString() };

      const readAt = this.now();
      const updated = await repository.markOwnedNotificationRead(notificationId, userId, readAt);
      if (!updated) {
        const replay = await repository.findOwnedNotificationById(notificationId, userId);
        if (replay?.readAt) return { id: replay.id, readAt: replay.readAt.toISOString() };
        throw this.notFound();
      }

      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: NOTIFICATIONS_OUTBOX_EVENT.READ,
        aggregateType: NOTIFICATIONS_RESOURCE_TYPE.NOTIFICATION,
        aggregateId: updated.id,
        payload: {
          notificationId: updated.id,
          userId,
          readAt: updated.readAt?.toISOString() ?? readAt.toISOString(),
        },
      });

      return { id: updated.id, readAt: (updated.readAt ?? readAt).toISOString() };
    });
  }

  /** Marks every unread Notification for the authenticated user and emits one aggregate read event when rows changed. */
  async markAllNotificationsRead(
    context: RequestContext,
  ): Promise<{ updatedCount: number }> {
    const userId = this.requireActorWithPermission(context, NOTIFICATIONS_PERMISSION.READ_OWN);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const readAt = this.now();
      const updatedCount = await repository.markAllOwnedNotificationsRead(userId, readAt);

      if (updatedCount > 0) {
        await this.outboxUsingTransaction(transaction).enqueue({
          eventType: NOTIFICATIONS_OUTBOX_EVENT.READ,
          aggregateType: NOTIFICATIONS_RESOURCE_TYPE.NOTIFICATION_USER,
          aggregateId: userId,
          payload: { userId, readAll: true, updatedCount, readAt: readAt.toISOString() },
        });
      }

      return { updatedCount };
    });
  }

  /** Returns the authenticated user's persisted event/channel preferences without exposing identity fields. */
  async getPreferences(context: RequestContext): Promise<NotificationPreferenceResponse[]> {
    const userId = this.requireActorWithPermission(
      context,
      NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
    );
    const rows = await this.repository.listUserPreferences(userId);
    return rows.map((row) => ({
      eventCode: row.eventCode,
      channel: row.channel as NotificationChannel,
      enabled: row.enabled,
    }));
  }

  /** Atomically replaces editable preferences while preventing policy-mandatory channels from being disabled. */
  async updatePreferences(
    context: RequestContext,
    input: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferenceResponse[]> {
    const userId = this.requireActorWithPermission(
      context,
      NOTIFICATIONS_PERMISSION.PREFERENCES_MANAGE_OWN,
    );

    for (const preference of input.preferences) {
      if (
        !preference.enabled &&
        this.dispatchPolicy.isMandatory(preference.eventCode, preference.channel)
      ) {
        throw this.scopeForbidden("This mandatory notification channel cannot be disabled.");
      }
    }

    return this.transactionRunner(async (transaction) => {
      const rows = await this.repositoryUsingTransaction(transaction).replaceUserPreferences(
        userId,
        input.preferences,
        this.now(),
      );
      return rows.map((row) => ({
        eventCode: row.eventCode,
        channel: row.channel as NotificationChannel,
        enabled: row.enabled,
      }));
    });
  }

  /** Lists only failed delivery rows after enforcing the privileged admin read permission. */
  async listFailedDeliveries(
    context: RequestContext,
    query: AdminNotificationDeliveriesQuery,
  ): Promise<PaginatedAdminNotificationDeliveriesResult> {
    this.requireActorWithPermission(context, NOTIFICATIONS_PERMISSION.ADMIN_READ);
    const result = await this.repository.listFailedDeliveries(query);
    return {
      items: result.items.map((row) => this.toAdminDeliveryResponse(row)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Requeues one failed delivery transactionally, audits the privileged action, and makes duplicate retry requests harmless. */
  async retryFailedDelivery(
    context: RequestContext,
    deliveryId: string,
  ): Promise<AdminNotificationDeliveryResponse> {
    const actorId = this.requireActorWithPermission(
      context,
      NOTIFICATIONS_PERMISSION.ADMIN_RETRY,
    );

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findDeliveryByIdForUpdate(deliveryId);
      if (!current) throw this.notFound();

      if (
        current.status === NOTIFICATION_DELIVERY_STATUS.QUEUED ||
        current.status === NOTIFICATION_DELIVERY_STATUS.PROCESSING
      ) {
        return this.toAdminDeliveryResponse(current);
      }
      if (current.status !== NOTIFICATION_DELIVERY_STATUS.FAILED) {
        throw this.deliveryFailed("Only a failed notification delivery can be retried.");
      }

      const retriedAt = this.now();
      const updated = await repository.updateDeliveryState(current.id, {
        status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
        attempts: current.attempts,
        providerRef: null,
        lastErrorCode: null,
        updatedAt: retriedAt,
      });
      if (!updated) throw this.deliveryFailed("Notification delivery retry could not be persisted.");

      await this.auditUsingTransaction(transaction).record({
        actorId,
        actorType: context.actorType,
        action: NOTIFICATIONS_AUDIT_ACTION.DELIVERY_RETRY_REQUESTED,
        entityType: NOTIFICATIONS_RESOURCE_TYPE.DELIVERY,
        entityId: updated.id,
        requestId: context.requestId,
        before: this.auditDeliveryState(current),
        after: this.auditDeliveryState(updated),
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: NOTIFICATIONS_OUTBOX_EVENT.QUEUED,
        aggregateType: NOTIFICATIONS_RESOURCE_TYPE.DELIVERY,
        aggregateId: updated.id,
        payload: this.deliveryEventPayload(updated, "admin_retry"),
      });

      return this.toAdminDeliveryResponse(updated);
    });
  }

  /**
   * Converts one committed Foundation outbox event into durable Notification deliveries.
   * The source transaction has already completed; failures here can never roll back order/payment/etc. state.
   */
  async dispatchCommittedEvent(sourceEventId: string): Promise<NotificationDispatchResult> {
    const sourceEvent = await this.repository.findSourceEventById(sourceEventId);
    if (!sourceEvent) {
      throw this.deliveryFailed("The committed notification source event is unavailable.");
    }

    const rawTargets = await this.dispatchPolicy.resolveTargets(sourceEvent);
    const targets = rawTargets.map((target) => this.normalizeDispatchTarget(target, sourceEvent));
    this.assertUniqueTargets(targets);

    const deliveries: NotificationPreparedDelivery[] = [];
    for (const target of targets) {
      const prepared = await this.prepareDispatchTarget(sourceEvent, target);
      deliveries.push(prepared);
      this.publishPreparedInAppNotification(prepared);
    }

    return {
      sourceEventId: sourceEvent.id,
      preparedCount: deliveries.filter((item) => !item.skipped && !item.replayed).length,
      replayedCount: deliveries.filter((item) => item.replayed).length,
      skippedCount: deliveries.filter((item) => item.skipped).length,
      deliveries,
    };
  }

  /** Prepares one target in its own transaction so partial multi-recipient failure remains safely replayable. */
  private async prepareDispatchTarget(
    sourceEvent: OutboxEventRow,
    target: NotificationDispatchTarget,
  ): Promise<NotificationPreparedDelivery> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const existing = await repository.findDeliveryByEventRecipientChannel(
        sourceEvent.id,
        target.userId,
        target.channel,
      );
      if (existing) return this.preparedDelivery(existing, true);

      const eventCode = this.normalizeEventCode(sourceEvent.eventType);
      if (await this.shouldSkipTarget(repository, eventCode, target)) {
        return this.skippedDelivery(target);
      }

      const template = await repository.findActiveTemplate(target.templateCode, target.channel);
      if (!template) throw this.templateMissing();
      const rendered = this.renderTemplate(template, target);
      const destinationMasked = await this.resolveMaskedDestination(transaction, target);
      const created = await this.createIdempotentDelivery(
        repository,
        sourceEvent,
        target,
        destinationMasked,
      );
      if (!created) {
        const replay = await repository.findDeliveryByEventRecipientChannel(
          sourceEvent.id,
          target.userId,
          target.channel,
        );
        if (!replay) {
          throw this.deliveryFailed("Notification delivery idempotency could not be resolved.");
        }
        return this.preparedDelivery(replay, true);
      }

      const prepared =
        target.channel === NOTIFICATION_CHANNEL.IN_APP
          ? await this.attachInAppNotification(repository, sourceEvent, target, rendered, created)
          : created;
      await this.enqueuePreparedDelivery(transaction, prepared);
      return this.preparedDelivery(prepared, false);
    });
  }


  /** Pushes only newly committed in-app rows; replayed/skipped deliveries never create duplicate browser events. */
  private publishPreparedInAppNotification(prepared: NotificationPreparedDelivery): void {
    if (
      prepared.skipped ||
      prepared.replayed ||
      !prepared.notificationId ||
      !this.realtimePublisher
    ) {
      return;
    }
    this.realtimePublisher.publishNotificationCreated(
      prepared.userId,
      prepared.notificationId,
    );
  }

  /** Locks one queued/retrying delivery, increments its attempt count, and makes already-sent jobs harmless. */
  private async claimDeliveryAttempt(
    deliveryId: string,
  ): Promise<{ delivery: NotificationDeliveryRow; shouldDeliver: boolean }> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findDeliveryByIdForUpdate(deliveryId);
      if (!current) throw this.notFound();
      if (current.status === NOTIFICATION_DELIVERY_STATUS.SENT) {
        return { delivery: current, shouldDeliver: false };
      }
      if (current.status === NOTIFICATION_DELIVERY_STATUS.FAILED) {
        throw this.deliveryFailed("Failed notification delivery must be requeued before processing.");
      }

      const updated = await repository.updateDeliveryState(deliveryId, {
        status: NOTIFICATION_DELIVERY_STATUS.PROCESSING,
        attempts: current.attempts + 1,
        providerRef: current.providerRef,
        lastErrorCode: null,
        updatedAt: this.now(),
      });
      if (!updated) throw this.deliveryFailed("Notification delivery attempt could not be claimed.");
      return { delivery: updated, shouldDeliver: true };
    });
  }

  /** Rehydrates one email target from its durable source event without persisting the raw email address. */
  private async resolveEmailMessage(
    delivery: NotificationDeliveryRow,
  ): Promise<{ to: string; subject: string; body: string }> {
    const sourceEvent = await this.repository.findSourceEventById(delivery.sourceEventId);
    if (!sourceEvent) throw this.deliveryFailed("Notification source event is unavailable.");
    const targets = await this.dispatchPolicy.resolveTargets(sourceEvent);
    const target = targets
      .map((candidate) => this.normalizeDispatchTarget(candidate, sourceEvent))
      .find((candidate) =>
        candidate.userId === delivery.userId &&
        candidate.channel === delivery.channel &&
        candidate.templateCode === delivery.templateCode
      );
    if (!target) throw this.deliveryFailed("Notification delivery policy no longer resolves this recipient.");

    const template = await this.repository.findActiveTemplate(delivery.templateCode, NOTIFICATION_CHANNEL.EMAIL);
    if (!template) throw this.templateMissing();
    const rendered = this.renderTemplate(template, target);
    if (!rendered.subject) throw this.templateMissing("Email notification templates require a subject.");

    const recipient = await this.administration.resolveNotificationRecipient(delivery.userId);
    if (!recipient) throw this.deliveryFailed("Notification recipient identity is unavailable.");
    return { to: recipient.email, subject: rendered.subject, body: rendered.body };
  }

  /** Marks one successful delivery sent once and appends the durable notification.sent lifecycle event. */
  private async markDeliverySent(deliveryId: string, providerRef: string | null): Promise<void> {
    await this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findDeliveryByIdForUpdate(deliveryId);
      if (!current || current.status === NOTIFICATION_DELIVERY_STATUS.SENT) return;

      const updated = await repository.updateDeliveryState(deliveryId, {
        status: NOTIFICATION_DELIVERY_STATUS.SENT,
        attempts: current.attempts,
        providerRef,
        lastErrorCode: null,
        updatedAt: this.now(),
      });
      if (!updated) throw this.deliveryFailed("Notification delivery success could not be persisted.");
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: NOTIFICATIONS_OUTBOX_EVENT.SENT,
        aggregateType: NOTIFICATIONS_RESOURCE_TYPE.DELIVERY,
        aggregateId: updated.id,
        payload: this.deliveryEventPayload(updated, "source_event"),
      });
    });
  }

  /** Applies stored user preference only when the source policy does not mark the event/channel mandatory. */
  private async shouldSkipTarget(
    repository: NotificationsRepositoryPort,
    eventCode: string,
    target: NotificationDispatchTarget,
  ): Promise<boolean> {
    const mandatory =
      target.mandatory === true || this.dispatchPolicy.isMandatory(eventCode, target.channel);
    const preference = await repository.findUserPreference(
      target.userId,
      eventCode,
      target.channel,
    );
    return preference?.enabled === false && !mandatory;
  }

  /** Inserts one queued delivery using the database-enforced event/user/channel replay identity. */
  private async createIdempotentDelivery(
    repository: NotificationsRepositoryPort,
    sourceEvent: OutboxEventRow,
    target: NotificationDispatchTarget,
    destinationMasked: string,
  ): Promise<NotificationDeliveryRow | null> {
    const now = this.now();
    return repository.createDeliveryIfMissing({
      sourceEventId: sourceEvent.id,
      userId: target.userId,
      channel: target.channel,
      templateCode: target.templateCode,
      destinationMasked,
      status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Creates the durable in-app row and attaches it to the already-idempotent delivery in the same transaction. */
  private async attachInAppNotification(
    repository: NotificationsRepositoryPort,
    sourceEvent: OutboxEventRow,
    target: NotificationDispatchTarget,
    rendered: { subject: string | null; body: string },
    delivery: NotificationDeliveryRow,
  ): Promise<NotificationDeliveryRow> {
    if (!rendered.subject) {
      throw this.templateMissing("In-app notification templates require a subject/title.");
    }
    const notification = await repository.createNotification({
      userId: target.userId,
      type: target.notificationType ?? sourceEvent.eventType,
      title: rendered.subject,
      body: rendered.body,
      dataJson: target.data ?? {},
      createdAt: this.now(),
    });
    const attached = await repository.attachNotificationToDelivery(
      delivery.id,
      notification.id,
      this.now(),
    );
    if (!attached) {
      throw this.deliveryFailed("In-app notification could not be attached to its delivery.");
    }
    return attached;
  }

  /** Emits one durable queued lifecycle event after delivery preparation succeeds. */
  private async enqueuePreparedDelivery(
    transaction: DatabaseTransaction,
    delivery: NotificationDeliveryRow,
  ): Promise<void> {
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: NOTIFICATIONS_OUTBOX_EVENT.QUEUED,
      aggregateType: NOTIFICATIONS_RESOURCE_TYPE.DELIVERY,
      aggregateId: delivery.id,
      payload: this.deliveryEventPayload(delivery, "source_event"),
    });
  }

  /** Returns the explicit no-delivery result used when an optional user preference disables one target. */
  private skippedDelivery(target: NotificationDispatchTarget): NotificationPreparedDelivery {
    return {
      userId: target.userId,
      channel: target.channel,
      deliveryId: null,
      notificationId: null,
      replayed: false,
      skipped: true,
    };
  }

  /** Normalizes internal policy output through the same code/UUID contracts used by persistence boundaries. */
  private normalizeDispatchTarget(
    target: NotificationDispatchTarget,
    sourceEvent: OutboxEventRow,
  ): NotificationDispatchTarget {
    const userId = uuidSchema.safeParse(target.userId);
    const channel = notificationChannelSchema.safeParse(target.channel);
    const templateCode = notificationTemplateCodeSchema.safeParse(target.templateCode);
    const notificationType = notificationTypeSchema.safeParse(
      target.notificationType ?? sourceEvent.eventType,
    );
    if (!userId.success || !channel.success || !templateCode.success || !notificationType.success) {
      throw this.deliveryFailed("Notification policy returned an invalid target contract.");
    }
    return {
      ...target,
      userId: userId.data,
      channel: channel.data,
      templateCode: templateCode.data,
      notificationType: notificationType.data,
    };
  }

  /** Validates a source event code before it is used as the persisted user-preference identity. */
  private normalizeEventCode(eventType: string): string {
    const eventCode = notificationEventCodeSchema.safeParse(eventType);
    if (!eventCode.success) {
      throw this.deliveryFailed("Notification source event code is invalid.");
    }
    return eventCode.data;
  }

  /** Rejects ambiguous policy output because persistence allows only one delivery per event/user/channel identity. */
  private assertUniqueTargets(targets: readonly NotificationDispatchTarget[]): void {
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.userId}:${target.channel}`;
      if (seen.has(key)) {
        throw this.deliveryFailed(
          "Notification policy returned duplicate recipient/channel targets for one source event.",
        );
      }
      seen.add(key);
    }
  }

  /** Renders one active template using explicit scalar variables only; arbitrary expressions are never evaluated. */
  private renderTemplate(
    template: NotificationTemplateRow,
    target: NotificationDispatchTarget,
  ): { subject: string | null; body: string } {
    const allowed = new Set(target.allowedVariables);
    for (const variableName of Object.keys(target.variables)) {
      if (!allowed.has(variableName)) {
        throw this.templateMissing("Notification template variables are not allow-listed by policy.");
      }
    }

    return {
      subject:
        template.subjectTemplate === null
          ? null
          : this.renderTemplateText(template.subjectTemplate, target.variables, allowed),
      body: this.renderTemplateText(template.bodyTemplate, target.variables, allowed),
    };
  }

  /** Replaces only simple {{name}} placeholders and rejects missing, non-allow-listed, or executable-looking syntax. */
  private renderTemplateText(
    template: string,
    variables: Record<string, NotificationTemplateValue>,
    allowed: ReadonlySet<string>,
  ): string {
    const tokenPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/gu;
    const rendered = template.replace(tokenPattern, (_match, variableName: string) => {
      if (!allowed.has(variableName) || !(variableName in variables)) {
        throw this.templateMissing("Notification template references an unavailable variable.");
      }
      return renderTemplateValue(variables[variableName] ?? null);
    });

    if (rendered.includes("{{") || rendered.includes("}}")) {
      throw this.templateMissing("Notification template contains unsupported template syntax.");
    }
    return rendered;
  }

  /** Resolves and masks the delivery destination without ever storing or returning a raw email address. */
  private async resolveMaskedDestination(
    transaction: DatabaseTransaction,
    target: NotificationDispatchTarget,
  ): Promise<string> {
    if (target.channel === NOTIFICATION_CHANNEL.IN_APP) return "in-app";

    const recipient = await this.administrationUsingTransaction(
      transaction,
    ).resolveNotificationRecipient(target.userId);
    if (!recipient) {
      throw this.deliveryFailed("Notification recipient identity is unavailable.");
    }
    return maskEmail(recipient.email);
  }

  /** Builds a privacy-safe delivery result without exposing source payloads or raw destinations. */
  private preparedDelivery(
    delivery: NotificationDeliveryRow,
    replayed: boolean,
  ): NotificationPreparedDelivery {
    return {
      userId: delivery.userId,
      channel: delivery.channel as NotificationChannel,
      deliveryId: delivery.id,
      notificationId: delivery.notificationId,
      replayed,
      skipped: false,
    };
  }

  /** Converts one persisted in-app row into the safe API-domain response shape. */
  private toNotificationResponse(row: NotificationRow): NotificationResponse {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: isRecord(row.dataJson) ? row.dataJson : {},
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Converts one persistence/admin delivery row into the privacy-safe response contract. */
  private toAdminDeliveryResponse(
    row: NotificationDeliveryRow | AdminNotificationDeliveryRow,
  ): AdminNotificationDeliveryResponse {
    return {
      id: row.id,
      notificationId: row.notificationId,
      userId: row.userId,
      channel: row.channel as NotificationChannel,
      templateCode: row.templateCode,
      destinationMasked: row.destinationMasked,
      status: row.status as NotificationDeliveryStatus,
      attempts: row.attempts,
      providerRef: row.providerRef,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Returns the small redacted delivery lifecycle snapshot stored in the privileged retry audit record. */
  private auditDeliveryState(row: NotificationDeliveryRow): Record<string, unknown> {
    return {
      id: row.id,
      userId: row.userId,
      channel: row.channel,
      templateCode: row.templateCode,
      destinationMasked: row.destinationMasked,
      status: row.status,
      attempts: row.attempts,
      providerRef: row.providerRef,
      lastErrorCode: row.lastErrorCode,
    };
  }

  /** Builds the safe Notification lifecycle payload shared by initial queueing and privileged retry queueing. */
  private deliveryEventPayload(
    row: NotificationDeliveryRow,
    reason: "source_event" | "admin_retry",
  ): Record<string, unknown> {
    return {
      deliveryId: row.id,
      sourceEventId: row.sourceEventId,
      notificationId: row.notificationId,
      userId: row.userId,
      channel: row.channel,
      templateCode: row.templateCode,
      reason,
    };
  }

  /** Enforces authentication and one server-derived permission, then returns the persisted actor identifier. */
  private requireActorWithPermission(
    context: RequestContext,
    permission: string,
  ): string {
    if (!context.actorId) {
      throw new AppError({
        code: ERROR_CODE.UNAUTHENTICATED,
        message: "Authentication is required.",
        statusCode: 401,
      });
    }
    assertPermission(context, permission as PermissionCode);
    return context.actorId;
  }

  /** Returns the non-enumerating resource-not-found error for user-owned Notification/delivery reads. */
  private notFound(): AppError {
    return notificationError(
      NOTIFICATIONS_ERROR_CODE.NOT_FOUND,
      "Notification was not found.",
      404,
    );
  }

  /** Returns the stable template-unavailable error without exposing template contents. */
  private templateMissing(message = "Notification template is unavailable."): AppError {
    return notificationError(
      NOTIFICATIONS_ERROR_CODE.TEMPLATE_MISSING,
      message,
      503,
    );
  }

  /** Returns the stable delivery failure/lifecycle error for asynchronous preparation and retry failures. */
  private deliveryFailed(message: string): AppError {
    return notificationError(
      NOTIFICATIONS_ERROR_CODE.DELIVERY_FAILED,
      message,
      409,
    );
  }

  /** Returns the stable policy-forbidden error for preference choices blocked by mandatory-channel rules. */
  private scopeForbidden(message: string): AppError {
    return notificationError(
      NOTIFICATIONS_ERROR_CODE.SCOPE_FORBIDDEN,
      message,
      403,
    );
  }
}

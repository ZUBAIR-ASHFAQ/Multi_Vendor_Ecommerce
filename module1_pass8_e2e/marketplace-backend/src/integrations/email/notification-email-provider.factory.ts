import {
  NotificationEmailProviderError,
  type NotificationEmailProvider,
  type NotificationEmailResult,
  type SendNotificationEmailInput,
} from "./notification-email-provider.contract.js";
import { ResendEmailProviderAdapter } from "./resend-email-provider.adapter.js";
import { NOTIFICATIONS_PROVIDER_ERROR_CODE } from "../../modules/notifications/notifications.constants.js";

export const NOTIFICATION_EMAIL_PROVIDER_MODE = {
  DISABLED: "disabled",
  RESEND: "resend",
  DETERMINISTIC_TEST: "deterministic_test",
} as const;

export type NotificationEmailProviderMode =
  (typeof NOTIFICATION_EMAIL_PROVIDER_MODE)[keyof typeof NOTIFICATION_EMAIL_PROVIDER_MODE];

export interface CreateNotificationEmailProviderOptions {
  mode: NotificationEmailProviderMode;
  apiKey?: string;
  from?: string;
  baseUrl?: string;
}

/** Fail-closed provider used when email delivery has not been configured for an environment. */
export class DisabledNotificationEmailProvider implements NotificationEmailProvider {
  /** Rejects delivery with a stable code instead of silently pretending an email was sent. */
  async sendEmail(_input: SendNotificationEmailInput): Promise<NotificationEmailResult> {
    throw new NotificationEmailProviderError(
      NOTIFICATIONS_PROVIDER_ERROR_CODE.UNCONFIGURED,
      "Notification email provider is not configured.",
    );
  }
}

/** Non-production deterministic provider used by Module 18 integration tests without network access. */
export class DeterministicNotificationEmailProvider implements NotificationEmailProvider {
  /** Returns a stable provider reference derived from the replay-safe delivery idempotency key. */
  async sendEmail(input: SendNotificationEmailInput): Promise<NotificationEmailResult> {
    return { providerRef: `test-email:${input.idempotencyKey}` };
  }
}

/** Composes the configured Notification email adapter while validating provider-specific required values. */
export function createNotificationEmailProvider(
  options: CreateNotificationEmailProviderOptions,
): NotificationEmailProvider {
  if (options.mode === NOTIFICATION_EMAIL_PROVIDER_MODE.DISABLED) {
    return new DisabledNotificationEmailProvider();
  }
  if (options.mode === NOTIFICATION_EMAIL_PROVIDER_MODE.DETERMINISTIC_TEST) {
    return new DeterministicNotificationEmailProvider();
  }
  if (!options.apiKey || !options.from) {
    throw new Error("Resend Notification email mode requires RESEND_API_KEY and NOTIFICATION_EMAIL_FROM.");
  }
  return new ResendEmailProviderAdapter({
    apiKey: options.apiKey,
    from: options.from,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
}

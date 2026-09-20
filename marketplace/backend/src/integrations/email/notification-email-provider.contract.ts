/** Provider-neutral email request produced only after Module 18 resolves policy, template, and recipient. */
export interface SendNotificationEmailInput {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

/** Provider-neutral result stored by Module 18 without persisting raw provider payloads. */
export interface NotificationEmailResult {
  providerRef: string;
}

/** Small email boundary keeps provider SDK/HTTP details outside Notification business logic. */
export interface NotificationEmailProvider {
  /** Sends one replay-safe email and returns only the provider reference required for reconciliation. */
  sendEmail(input: SendNotificationEmailInput): Promise<NotificationEmailResult>;
}

/** Safe provider error carrying a stable code suitable for the delivery failure record. */
export class NotificationEmailProviderError extends Error {
  /** Stores the stable redacted code while preserving a non-secret diagnostic message. */
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NotificationEmailProviderError";
  }
}

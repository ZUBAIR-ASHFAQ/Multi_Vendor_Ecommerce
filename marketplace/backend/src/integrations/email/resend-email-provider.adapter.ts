import {
  NotificationEmailProviderError,
  type NotificationEmailProvider,
  type NotificationEmailResult,
  type SendNotificationEmailInput,
} from "./notification-email-provider.contract.js";
import { NOTIFICATIONS_PROVIDER_ERROR_CODE } from "../../modules/notifications/notifications.constants.js";

interface ResendEmailProviderOptions {
  apiKey: string;
  from: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

/** Minimal response fields needed from Resend; all other provider response data is discarded. */
interface ResendEmailResponse {
  id?: unknown;
}

/** Resend HTTP adapter implemented with Node's fetch so Notification delivery has no extra SDK dependency. */
export class ResendEmailProviderAdapter implements NotificationEmailProvider {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  /** Stores deployment credentials privately and normalizes the provider base URL once. */
  constructor(private readonly options: ResendEmailProviderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/+$/u, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  /** Sends one plain-text email using the delivery id as Resend's idempotency key. */
  async sendEmail(input: SendNotificationEmailInput): Promise<NotificationEmailResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
        }),
      });
    } catch {
      throw new NotificationEmailProviderError(
        NOTIFICATIONS_PROVIDER_ERROR_CODE.REQUEST_FAILED,
        "Notification email provider request failed.",
      );
    }

    if (!response.ok) {
      throw new NotificationEmailProviderError(
        NOTIFICATIONS_PROVIDER_ERROR_CODE.DELIVERY_FAILED,
        `Notification email provider returned HTTP ${response.status}.`,
      );
    }

    let payload: ResendEmailResponse;
    try {
      const parsedResponse = await response.json();
      payload = parsedResponse as ResendEmailResponse;
    } catch {
      throw new NotificationEmailProviderError(
        NOTIFICATIONS_PROVIDER_ERROR_CODE.RESPONSE_INVALID,
        "Notification email provider returned an invalid response.",
      );
    }

    if (typeof payload.id !== "string" || payload.id.trim().length === 0) {
      throw new NotificationEmailProviderError(
        NOTIFICATIONS_PROVIDER_ERROR_CODE.RESPONSE_INVALID,
        "Notification email provider response did not include an email id.",
      );
    }

    return { providerRef: payload.id };
  }
}

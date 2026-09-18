import { describe, expect, it, vi } from "vitest";
import {
  createNotificationEmailProvider,
  DeterministicNotificationEmailProvider,
  NOTIFICATION_EMAIL_PROVIDER_MODE,
} from "../../src/integrations/email/notification-email-provider.factory.js";
import { ResendEmailProviderAdapter } from "../../src/integrations/email/resend-email-provider.adapter.js";
import { NotificationEmailProviderError } from "../../src/integrations/email/notification-email-provider.contract.js";
import { NOTIFICATIONS_PROVIDER_ERROR_CODE } from "../../src/modules/notifications/notifications.constants.js";

const input = {
  to: "customer@example.com",
  subject: "Order placed",
  text: "Your order was placed.",
  idempotencyKey: "delivery-0001",
};

describe("Module 18 email provider adapters", () => {
  it("keeps the deterministic provider replay-safe without network access", async () => {
    const provider = new DeterministicNotificationEmailProvider();
    await expect(provider.sendEmail(input)).resolves.toEqual({
      providerRef: "test-email:delivery-0001",
    });
    await expect(provider.sendEmail(input)).resolves.toEqual({
      providerRef: "test-email:delivery-0001",
    });
  });

  it("sends only the required Resend fields with the stable delivery idempotency key", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-provider-ref" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new ResendEmailProviderAdapter({
      apiKey: "resend-test-key",
      from: "Marketplace <notifications@example.com>",
      baseUrl: "https://resend.test/",
      fetchImplementation,
    });

    await expect(provider.sendEmail(input)).resolves.toEqual({
      providerRef: "email-provider-ref",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://resend.test/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resend-test-key",
          "Idempotency-Key": input.idempotencyKey,
        }),
      }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      from: "Marketplace <notifications@example.com>",
      to: [input.to],
      subject: input.subject,
      text: input.text,
    });
  });

  it("normalizes provider HTTP failures without leaking response bodies", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "secret provider detail" }), { status: 503 }),
    );
    const provider = new ResendEmailProviderAdapter({
      apiKey: "resend-test-key",
      from: "notifications@example.com",
      fetchImplementation,
    });

    try {
      await provider.sendEmail(input);
      throw new Error("Expected provider failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationEmailProviderError);
      expect((error as NotificationEmailProviderError).code).toBe(
        NOTIFICATIONS_PROVIDER_ERROR_CODE.DELIVERY_FAILED,
      );
      expect((error as Error).message).not.toContain("secret provider detail");
    }
  });

  it("keeps disabled mode fail-closed and validates Resend configuration", async () => {
    const disabled = createNotificationEmailProvider({
      mode: NOTIFICATION_EMAIL_PROVIDER_MODE.DISABLED,
    });
    await expect(disabled.sendEmail(input)).rejects.toMatchObject({
      code: NOTIFICATIONS_PROVIDER_ERROR_CODE.UNCONFIGURED,
    });
    expect(() =>
      createNotificationEmailProvider({ mode: NOTIFICATION_EMAIL_PROVIDER_MODE.RESEND }),
    ).toThrow("requires RESEND_API_KEY and NOTIFICATION_EMAIL_FROM");
  });
});

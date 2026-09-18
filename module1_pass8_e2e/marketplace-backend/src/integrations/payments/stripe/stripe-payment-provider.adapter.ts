import Stripe from "stripe";
import { env } from "../../../config/env.js";
import type {
  CancelProviderPaymentIntentInput,
  CreateProviderPaymentIntentInput,
  CreateProviderRefundInput,
  PaymentProviderAdapter,
  ProviderPaymentIntent,
  ProviderPaymentIntentStatus,
  ProviderRefund,
  VerifiedProviderWebhookEvent,
} from "../payment-provider.contract.js";

/** Dependencies are injectable so provider behavior can be tested without live Stripe calls. */
export interface StripePaymentProviderAdapterDependencies {
  client?: Stripe;
  secretKey?: string;
  webhookSecret?: string;
}

/** Converts one provider minor-unit string into the exact safe integer required by Stripe's SDK. */
function stripeIntegerAmount(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Provider minor-unit amount must contain decimal digits only.");
  }

  const amount = BigInt(value);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Provider minor-unit amount exceeds the exact JavaScript integer range.");
  }

  return Number(amount);
}

/** Converts one Stripe Unix timestamp in seconds into a JavaScript Date. */
function stripeTimestamp(seconds: number): Date {
  return new Date(seconds * 1_000);
}

/** Reads an expandable Stripe ID without leaking provider SDK objects into business code. */
function expandableId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Maps Stripe PaymentIntent status into the small provider-neutral Payment state model. */
function mapPaymentIntentStatus(status: Stripe.PaymentIntent.Status): ProviderPaymentIntentStatus {
  if (
    status === "requires_payment_method" ||
    status === "requires_confirmation" ||
    status === "requires_action"
  ) {
    return "pending";
  }

  if (status === "processing") return "processing";
  if (status === "succeeded") return "captured";
  if (status === "canceled") return "cancelled";

  if (status === "requires_capture") {
    throw new Error("Stripe returned requires_capture while automatic capture is required.");
  }

  throw new Error(`Unsupported Stripe PaymentIntent status: ${status}`);
}

/** Converts one verified Stripe PaymentIntent into the provider-neutral service contract. */
function normalizePaymentIntent(intent: Stripe.PaymentIntent): ProviderPaymentIntent {
  const paymentId = intent.metadata.paymentId?.trim();
  const orderId = intent.metadata.orderId?.trim();
  if (!paymentId || !orderId) {
    throw new Error("Stripe PaymentIntent metadata is missing paymentId or orderId.");
  }

  const mappedStatus = mapPaymentIntentStatus(intent.status);
  const authoritativeAmount = mappedStatus === "captured" ? intent.amount_received : intent.amount;

  return {
    providerPaymentId: intent.id,
    status: mappedStatus,
    amountMinor: String(authoritativeAmount),
    currency: intent.currency.toUpperCase(),
    createdAt: stripeTimestamp(intent.created),
    clientSecret: intent.client_secret,
    metadata: { paymentId, orderId },
    providerTransactionId: expandableId(intent.latest_charge),
  };
}

/** Maps Stripe Refund status into the provider-neutral refund state model. */
function mapRefundStatus(status: string | null): ProviderRefund["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "pending" || status === "requires_action") return "pending";
  if (status === "failed" || status === "canceled") return "failed";
  throw new Error(`Unsupported Stripe Refund status: ${String(status)}`);
}

/** Converts one Stripe Refund into the provider-neutral refund contract. */
function normalizeRefund(refund: Stripe.Refund): ProviderRefund {
  const providerPaymentId = expandableId(refund.payment_intent);
  if (!providerPaymentId) {
    throw new Error("Stripe Refund is missing its PaymentIntent identity.");
  }

  return {
    providerRefundId: refund.id,
    providerPaymentId,
    amountMinor: String(refund.amount),
    currency: refund.currency.toUpperCase(),
    status: mapRefundStatus(refund.status),
    createdAt: stripeTimestamp(refund.created),
  };
}

/** Returns true only for the signed PaymentIntent events that drive core Module 12 state changes. */
function isCorePaymentIntentEvent(eventType: string): boolean {
  return (
    eventType === "payment_intent.processing" ||
    eventType === "payment_intent.succeeded" ||
    eventType === "payment_intent.payment_failed" ||
    eventType === "payment_intent.canceled"
  );
}

/** Stripe sandbox/test implementation kept fully behind the provider-neutral Payments contract. */
export class StripePaymentProviderAdapter implements PaymentProviderAdapter {
  private readonly client: Stripe;
  private readonly webhookSecret: string;

  /** Builds the Stripe adapter from validated backend-only configuration or injected test dependencies. */
  constructor(dependencies: StripePaymentProviderAdapterDependencies = {}) {
    const secretKey = dependencies.secretKey ?? env.STRIPE_SECRET_KEY;
    const webhookSecret = dependencies.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;

    if (!dependencies.client && !secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required to use the Stripe Payment provider.");
    }
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is required to verify Stripe webhooks.");
    }

    if (dependencies.client) {
      this.client = dependencies.client;
    } else if (env.STRIPE_API_BASE_URL) {
      const apiUrl = new URL(env.STRIPE_API_BASE_URL);
      const protocol = apiUrl.protocol === "http:" ? "http" : "https";
      const port = Number(apiUrl.port || (protocol === "http" ? 80 : 443));
      this.client = new Stripe(secretKey as string, {
        host: apiUrl.hostname,
        port,
        protocol,
      });
    } else {
      this.client = new Stripe(secretKey as string);
    }
    this.webhookSecret = webhookSecret;
  }

  /** Creates one automatic-capture Stripe PaymentIntent with IDs-only metadata and deterministic idempotency. */
  async createPaymentIntent(
    input: CreateProviderPaymentIntentInput,
  ): Promise<ProviderPaymentIntent> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: stripeIntegerAmount(input.amountMinor),
        currency: input.currency.toLowerCase(),
        capture_method: "automatic",
        automatic_payment_methods: { enabled: true },
        metadata: {
          paymentId: input.metadata.paymentId,
          orderId: input.metadata.orderId,
        },
      },
      { idempotencyKey: input.providerIdempotencyKey },
    );

    return normalizePaymentIntent(intent);
  }

  /** Retrieves provider-authoritative PaymentIntent state for reconciliation or active-intent reuse. */
  async retrievePaymentIntent(providerPaymentId: string): Promise<ProviderPaymentIntent> {
    const intent = await this.client.paymentIntents.retrieve(providerPaymentId);
    return normalizePaymentIntent(intent);
  }

  /** Cancels one still-active Stripe PaymentIntent during immutable Payment-window expiry. */
  async cancelPaymentIntent(
    input: CancelProviderPaymentIntentInput,
  ): Promise<ProviderPaymentIntent> {
    const intent = await this.client.paymentIntents.cancel(input.providerPaymentId);
    return normalizePaymentIntent(intent);
  }

  /** Verifies Stripe's signature over the exact raw bytes and returns one normalized signed event. */
  async verifyAndParseWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<VerifiedProviderWebhookEvent> {
    const event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const paymentIntent = isCorePaymentIntentEvent(event.type)
      ? normalizePaymentIntent(event.data.object as Stripe.PaymentIntent)
      : null;

    return {
      providerEventId: event.id,
      eventType: event.type,
      occurredAt: stripeTimestamp(event.created),
      paymentIntent,
    };
  }

  /** Creates one replay-safe Stripe Refund after marketplace money-safety checks have already passed. */
  async createRefund(input: CreateProviderRefundInput): Promise<ProviderRefund> {
    const refund = await this.client.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: stripeIntegerAmount(input.amountMinor),
        ...(input.providerReason ? { reason: input.providerReason } : {}),
      },
      { idempotencyKey: input.providerIdempotencyKey },
    );

    return normalizeRefund(refund);
  }

  /** Retrieves one Stripe Refund so background reconciliation can apply only provider-authoritative results. */
  async retrieveRefund(providerRefundId: string): Promise<ProviderRefund> {
    const refund = await this.client.refunds.retrieve(providerRefundId);
    return normalizeRefund(refund);
  }
}

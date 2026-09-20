/** Provider-neutral PaymentIntent states understood by Module 12 business code. */
export type ProviderPaymentIntentStatus =
  | "pending"
  | "processing"
  | "captured"
  | "cancelled";

/** Integer provider money is transported as a decimal digit string to avoid number precision loss. */
export type ProviderMinorAmount = string;

/** Minimal IDs-only metadata sent to a Payment provider. */
export interface ProviderPaymentMetadata {
  paymentId: string;
  orderId: string;
}

/** Input for creating one provider PaymentIntent from authoritative marketplace state. */
export interface CreateProviderPaymentIntentInput {
  amountMinor: ProviderMinorAmount;
  currency: string;
  providerIdempotencyKey: string;
  metadata: ProviderPaymentMetadata;
}

/** Safe provider PaymentIntent state normalized away from provider SDK types. */
export interface ProviderPaymentIntent {
  providerPaymentId: string;
  status: ProviderPaymentIntentStatus;
  amountMinor: ProviderMinorAmount;
  currency: string;
  createdAt: Date;
  clientSecret: string | null;
  metadata: ProviderPaymentMetadata;
  providerTransactionId: string | null;
}

/** Verified provider webhook envelope; unsupported signed events may omit a PaymentIntent payload. */
export interface VerifiedProviderWebhookEvent {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  paymentIntent: ProviderPaymentIntent | null;
}

/** Input for cancelling one still-active provider PaymentIntent during payment-window expiry. */
export interface CancelProviderPaymentIntentInput {
  providerPaymentId: string;
}

/** Input for one replay-safe provider refund. */
export interface CreateProviderRefundInput {
  providerPaymentId: string;
  amountMinor: ProviderMinorAmount;
  providerIdempotencyKey: string;
  providerReason?: "requested_by_customer" | "duplicate" | "fraudulent";
}

/** Provider refund state normalized away from provider SDK response types. */
export interface ProviderRefund {
  providerRefundId: string;
  providerPaymentId: string;
  amountMinor: ProviderMinorAmount;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  createdAt: Date;
}

/** Small provider-neutral adapter implemented by Stripe sandbox/test code in Module 12 Pass 4. */
export interface PaymentProviderAdapter {
  /** Creates one provider PaymentIntent using a deterministic provider idempotency key. */
  createPaymentIntent(input: CreateProviderPaymentIntentInput): Promise<ProviderPaymentIntent>;

  /** Retrieves current provider-authoritative PaymentIntent state for reconciliation. */
  retrievePaymentIntent(providerPaymentId: string): Promise<ProviderPaymentIntent>;

  /** Cancels one provider PaymentIntent when the marketplace payment window has expired. */
  cancelPaymentIntent(input: CancelProviderPaymentIntentInput): Promise<ProviderPaymentIntent>;

  /** Verifies the provider signature over the exact raw body and returns one normalized event. */
  verifyAndParseWebhook(rawBody: Buffer, signature: string): Promise<VerifiedProviderWebhookEvent>;

  /** Creates one replay-safe provider refund after Module 12 money-safety checks pass. */
  createRefund(input: CreateProviderRefundInput): Promise<ProviderRefund>;

  /** Retrieves provider refund state for reconciliation without changing marketplace state by itself. */
  retrieveRefund(providerRefundId: string): Promise<ProviderRefund>;
}

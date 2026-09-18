/** Safe provider-owned payout-account facts returned after reference validation. */
export interface ValidatedPayoutAccountReference {
  providerType: string;
  providerAccountRef: string;
  maskedDetails: string;
}

/** Provider-neutral payout send request built only from authoritative marketplace state. */
export interface SendProviderPayoutInput {
  payoutId: string;
  sellerId: string;
  amount: string;
  currency: string;
  providerAccountRef: string;
  providerIdempotencyKey: string;
}

/** A provider payout can be terminally paid/failed or remain uncertain for later reconciliation. */
export type ProviderPayoutResult =
  | { status: "paid"; providerRef: string; processedAt: Date }
  | { status: "failed"; failureCode: string | null; processedAt: Date }
  | { status: "unknown" };

/** Small provider-neutral contract so Module 17 business code never imports a concrete bank/provider SDK. */
export interface PayoutProviderAdapter {
  /** Validates one already-tokenized provider reference and returns safe display metadata. */
  validateAccountReference(
    providerType: string,
    providerAccountRef: string,
  ): Promise<ValidatedPayoutAccountReference>;

  /** Sends or reconciles one payout idempotently by stable marketplace payout identity. */
  sendPayout(input: SendProviderPayoutInput): Promise<ProviderPayoutResult>;
}

/** Default adapter fails closed until deployment provides a configured payout provider implementation. */
export class UnconfiguredPayoutProviderAdapter implements PayoutProviderAdapter {
  /** Refuses account validation because no production payout provider has been configured. */
  async validateAccountReference(): Promise<ValidatedPayoutAccountReference> {
    throw new Error("Payout provider is not configured.");
  }

  /** Refuses payout execution because no production payout provider has been configured. */
  async sendPayout(): Promise<ProviderPayoutResult> {
    throw new Error("Payout provider is not configured.");
  }
}

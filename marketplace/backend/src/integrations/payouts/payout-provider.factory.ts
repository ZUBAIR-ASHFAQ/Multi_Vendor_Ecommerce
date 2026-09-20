import type {
  PayoutProviderAdapter,
  ProviderPayoutResult,
  SendProviderPayoutInput,
  ValidatedPayoutAccountReference,
} from "./payout-provider.contract.js";
import { UnconfiguredPayoutProviderAdapter } from "./payout-provider.contract.js";

export const PAYOUT_PROVIDER_MODE = {
  UNCONFIGURED: "unconfigured",
  MODULE: "module",
  DETERMINISTIC_TEST: "deterministic_test",
} as const;

export type PayoutProviderMode =
  (typeof PAYOUT_PROVIDER_MODE)[keyof typeof PAYOUT_PROVIDER_MODE];

/** Small runtime configuration used to compose one provider-neutral Payout adapter. */
export interface PayoutProviderConfiguration {
  mode: PayoutProviderMode;
  providerType?: string;
  moduleSpecifier?: string;
  now?: () => Date;
}

type ProviderModule = {
  default?: PayoutProviderAdapter;
  createPayoutProviderAdapter?: () => PayoutProviderAdapter | Promise<PayoutProviderAdapter>;
};

/** Returns true when one dynamically loaded object implements the required adapter methods. */
function isPayoutProviderAdapter(value: unknown): value is PayoutProviderAdapter {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PayoutProviderAdapter>;
  return (
    typeof candidate.validateAccountReference === "function" &&
    typeof candidate.sendPayout === "function"
  );
}

/** Lazily loads a deployment-owned adapter module so core business code stays provider-neutral. */
class ModulePayoutProviderAdapter implements PayoutProviderAdapter {
  private loadedAdapter: Promise<PayoutProviderAdapter> | null = null;

  /** Stores only provider-neutral deployment configuration; the external module is still loaded lazily. */
  constructor(
    private readonly providerType: string,
    private readonly moduleSpecifier: string,
  ) {}

  /** Delegates tokenized account validation only for the deployment-configured provider type. */
  async validateAccountReference(
    providerType: string,
    providerAccountRef: string,
  ): Promise<ValidatedPayoutAccountReference> {
    if (providerType !== this.providerType) {
      throw new Error(`Unsupported payout provider type: ${providerType}`);
    }
    const adapter = await this.loadAdapter();
    return adapter.validateAccountReference(providerType, providerAccountRef);
  }

  /** Delegates one idempotent Payout send/reconciliation call to the configured provider module. */
  async sendPayout(input: SendProviderPayoutInput): Promise<ProviderPayoutResult> {
    const adapter = await this.loadAdapter();
    return adapter.sendPayout(input);
  }

  /** Loads and validates the deployment module once, then reuses the same adapter instance. */
  private async loadAdapter(): Promise<PayoutProviderAdapter> {
    if (!this.loadedAdapter) {
      this.loadedAdapter = this.importAdapter();
    }
    return this.loadedAdapter;
  }

  /** Accepts either a default adapter export or a small createPayoutProviderAdapter factory export. */
  private async importAdapter(): Promise<PayoutProviderAdapter> {
    const providerModule = (await import(this.moduleSpecifier)) as ProviderModule;
    const candidate = providerModule.createPayoutProviderAdapter
      ? await providerModule.createPayoutProviderAdapter()
      : providerModule.default;

    if (!isPayoutProviderAdapter(candidate)) {
      throw new Error(
        "Configured payout provider module must export an adapter or createPayoutProviderAdapter().",
      );
    }
    return candidate;
  }
}

/** Deterministic non-production adapter used only by the browser release gate. */
export class DeterministicTestPayoutProviderAdapter implements PayoutProviderAdapter {
  private readonly attemptsByPayoutKey = new Map<string, number>();

  /** Creates one deterministic non-production adapter with an injectable clock for release tests. */
  constructor(
    private readonly providerType: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Validates one test token without ever accepting raw bank/card credentials. */
  async validateAccountReference(
    providerType: string,
    providerAccountRef: string,
  ): Promise<ValidatedPayoutAccountReference> {
    if (providerType !== this.providerType) {
      throw new Error(`Unsupported payout provider type: ${providerType}`);
    }
    if (!/^(paid|failed|unknown_then_paid):[A-Za-z0-9_-]{4,200}$/u.test(providerAccountRef)) {
      throw new Error("Deterministic payout account reference is invalid.");
    }

    return {
      providerType,
      providerAccountRef,
      maskedDetails: `Test destination •••• ${providerAccountRef.slice(-4)}`,
    };
  }

  /** Returns paid, failed, or one unknown-then-paid sequence from the tokenized test reference prefix. */
  async sendPayout(input: SendProviderPayoutInput): Promise<ProviderPayoutResult> {
    const attempt = (this.attemptsByPayoutKey.get(input.providerIdempotencyKey) ?? 0) + 1;
    this.attemptsByPayoutKey.set(input.providerIdempotencyKey, attempt);

    if (input.providerAccountRef.startsWith("failed:")) {
      return { status: "failed", failureCode: "deterministic_failure", processedAt: this.now() };
    }
    if (input.providerAccountRef.startsWith("unknown_then_paid:") && attempt === 1) {
      return { status: "unknown" };
    }

    return {
      status: "paid",
      providerRef: `e2e-payout-${input.payoutId}`,
      processedAt: this.now(),
    };
  }
}

/** Creates the configured payout adapter without importing any concrete provider SDK into Module 17. */
export function createPayoutProviderAdapter(
  configuration: PayoutProviderConfiguration,
): PayoutProviderAdapter {
  if (configuration.mode === PAYOUT_PROVIDER_MODE.MODULE) {
    if (!configuration.providerType || !configuration.moduleSpecifier) {
      throw new Error("Configured payout provider module requires providerType and moduleSpecifier.");
    }
    return new ModulePayoutProviderAdapter(
      configuration.providerType,
      configuration.moduleSpecifier,
    );
  }

  if (configuration.mode === PAYOUT_PROVIDER_MODE.DETERMINISTIC_TEST) {
    if (!configuration.providerType) {
      throw new Error("Deterministic payout provider requires providerType.");
    }
    return new DeterministicTestPayoutProviderAdapter(
      configuration.providerType,
      configuration.now,
    );
  }

  return new UnconfiguredPayoutProviderAdapter();
}

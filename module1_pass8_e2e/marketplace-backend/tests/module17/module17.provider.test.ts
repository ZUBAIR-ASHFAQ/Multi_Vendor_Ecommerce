import { describe, expect, it } from "vitest";
import {
  createPayoutProviderAdapter,
  DeterministicTestPayoutProviderAdapter,
  PAYOUT_PROVIDER_MODE,
} from "../../src/integrations/payouts/payout-provider.factory.js";

/** Builds one authoritative test payout request with a stable provider idempotency key. */
function payoutInput(providerAccountRef: string) {
  return {
    payoutId: "00000000-0000-4000-8000-000000000017",
    sellerId: "00000000-0000-4000-8000-000000000004",
    amount: "25.0000",
    currency: "USD",
    providerAccountRef,
    providerIdempotencyKey: "payout:00000000-0000-4000-8000-000000000017:send",
  };
}

describe("Module 17 payout-provider composition", () => {
  it("keeps deterministic account validation tokenized and provider-scoped", async () => {
    const provider = new DeterministicTestPayoutProviderAdapter("e2e");
    await expect(provider.validateAccountReference("other", "paid:acct-1234")).rejects.toThrow(
      "Unsupported payout provider type",
    );

    await expect(provider.validateAccountReference("e2e", "paid:acct-1234")).resolves.toEqual({
      providerType: "e2e",
      providerAccountRef: "paid:acct-1234",
      maskedDetails: "Test destination •••• 1234",
    });
  });

  it("returns paid and authoritative failed results without changing the business-service contract", async () => {
    const now = new Date("2026-09-17T12:00:00.000Z");
    const provider = new DeterministicTestPayoutProviderAdapter("e2e", () => now);

    await expect(provider.sendPayout(payoutInput("paid:acct-1234"))).resolves.toEqual({
      status: "paid",
      providerRef: "e2e-payout-00000000-0000-4000-8000-000000000017",
      processedAt: now,
    });
    await expect(provider.sendPayout(payoutInput("failed:acct-5678"))).resolves.toEqual({
      status: "failed",
      failureCode: "deterministic_failure",
      processedAt: now,
    });
  });

  it("keeps an unknown result held until the same provider payout identity is reconciled", async () => {
    const provider = new DeterministicTestPayoutProviderAdapter("e2e");
    const input = payoutInput("unknown_then_paid:acct-9999");

    await expect(provider.sendPayout(input)).resolves.toEqual({ status: "unknown" });
    await expect(provider.sendPayout(input)).resolves.toMatchObject({
      status: "paid",
      providerRef: "e2e-payout-00000000-0000-4000-8000-000000000017",
    });
  });

  it("keeps the default factory fail-closed until deployment selects an adapter", async () => {
    const provider = createPayoutProviderAdapter({ mode: PAYOUT_PROVIDER_MODE.UNCONFIGURED });
    await expect(provider.sendPayout(payoutInput("paid:acct-1234"))).rejects.toThrow(
      "Payout provider is not configured.",
    );
  });
});

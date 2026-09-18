import { describe, expect, it } from "vitest";
import {
  PAYOUT_ACCOUNT_STATUS,
  PAYOUT_PROVIDER_RESULT,
  PAYOUT_STATUS,
  PAYOUT_STATUS_TRANSITIONS,
  WALLET_BALANCE_BUCKET,
  WALLET_ENTRY_TYPE,
  WALLET_PAYOUT_ERROR_CODE,
  WALLET_PAYOUT_HTTP_OPERATION,
  WALLET_PAYOUT_JOB,
  WALLET_PAYOUT_LIMITS,
  WALLET_PAYOUT_PATH,
  WALLET_PAYOUT_PERMISSION,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { WALLET_PAYOUT_SOURCE_EVENT_VALUES } from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.jobs.js";
import {
  adjustWalletBodySchema,
  adminPayoutListQuerySchema,
  approvePayoutBodySchema,
  createPayoutAccountBodySchema,
  payoutAccountResponseSchema,
  payoutAmountSchema,
  payoutProviderResultSchema,
  payoutStatusSchema,
  requestPayoutBodySchema,
  sellerPayoutListQuerySchema,
  sellerWalletBalanceResponseSchema,
  sellerWalletEntryResponseSchema,
  sellerWalletQuerySchema,
  sellerWalletResponseSchema,
  sendPayoutBodySchema,
  settleWalletBodySchema,
  walletCurrencySchema,
  walletNegativeBalanceSchema,
  walletPayoutIdempotencyHeadersSchema,
  walletSignedMoneySchema,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.schema.js";

const SELLER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const COMMISSION_ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const WALLET_ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const OCCURRED_AT = "2026-09-15T09:00:00.000Z";

/** Builds one valid seller Wallet snapshot used by response contract tests. */
function validWalletResponse() {
  return {
    sellerId: SELLER_ID,
    currency: "USD",
    pendingBalance: "10.0000",
    availableBalance: "4.5000",
    heldBalance: "2.0000",
    negativeBalance: "0.0000",
    updatedAt: OCCURRED_AT,
  };
}

describe("Module 17 frozen constants", () => {
  it("freezes Wallet buckets, entry types, Payout states, and provider outcomes", () => {
    expect(Object.values(WALLET_BALANCE_BUCKET)).toEqual([
      "pending",
      "available",
      "held",
      "negative",
    ]);
    expect(Object.values(WALLET_ENTRY_TYPE)).toEqual([
      "commission_credit",
      "commission_adjustment",
      "availability_transfer",
      "negative_recovery",
      "payout_reserve",
      "payout_release",
      "payout_paid",
    ]);
    expect(Object.values(PAYOUT_ACCOUNT_STATUS)).toEqual(["active", "disabled"]);
    expect(Object.values(PAYOUT_STATUS)).toEqual([
      "requested",
      "approved",
      "processing",
      "paid",
      "failed",
    ]);
    expect(Object.values(PAYOUT_PROVIDER_RESULT)).toEqual(["paid", "failed", "unknown"]);
    expect(PAYOUT_STATUS_TRANSITIONS.requested).toEqual(["approved"]);
    expect(PAYOUT_STATUS_TRANSITIONS.approved).toEqual(["processing"]);
    expect(PAYOUT_STATUS_TRANSITIONS.processing).toEqual(["paid", "failed"]);
    expect(PAYOUT_STATUS_TRANSITIONS.paid).toEqual([]);
    expect(PAYOUT_STATUS_TRANSITIONS.failed).toEqual([]);
  });

  it("keeps the exact guide permissions and stable errors", () => {
    expect(Object.values(WALLET_PAYOUT_PERMISSION)).toEqual([
      "seller.wallet.read",
      "seller.payout.request",
      "seller.payout_account.manage",
      "admin.payouts.read",
      "admin.payouts.manage",
    ]);
    expect(Object.values(WALLET_PAYOUT_ERROR_CODE)).toEqual([
      "INSUFFICIENT_AVAILABLE_BALANCE",
      "PAYOUT_ACCOUNT_INVALID",
      "PAYOUT_STATUS_INVALID",
      "WALLET_SOURCE_DUPLICATE",
      "PAYOUT_PROVIDER_ERROR",
    ]);
  });

  it("keeps the exact nine-operation Module 17 HTTP surface", () => {
    expect(Object.values(WALLET_PAYOUT_PATH)).toHaveLength(9);
    expect(WALLET_PAYOUT_HTTP_OPERATION).toEqual([
      { method: "GET", path: "/api/v1/seller/wallet" },
      { method: "GET", path: "/api/v1/seller/payouts" },
      { method: "POST", path: "/api/v1/seller/payouts" },
      { method: "POST", path: "/api/v1/seller/payout-accounts" },
      { method: "GET", path: "/api/v1/admin/payouts" },
      { method: "POST", path: "/api/v1/admin/payouts/:id/approve" },
      { method: "POST", path: "/api/v1/admin/payouts/:id/send" },
      { method: "POST", path: "/api/v1/internal/wallet/settle" },
      { method: "POST", path: "/api/v1/internal/wallet/adjust" },
    ]);
  });

  it("freezes independent source-event and settlement job identities", () => {
    expect(WALLET_PAYOUT_JOB).toEqual({
      SOURCE_EVENT_QUEUE: "wallet-source-events",
      SETTLEMENT_QUEUE: "wallet-settlement",
      SETTLE_ELIGIBLE: "settle-eligible",
    });
    expect(WALLET_PAYOUT_SOURCE_EVENT_VALUES).toEqual([
      "commission.posted",
      "commission.adjusted",
    ]);
  });
});

describe("Module 17 exact-money contracts", () => {
  it("requires canonical exact scale-4 money and preserves signed Wallet deltas", () => {
    expect(walletSignedMoneySchema.parse("12.3400")).toBe("12.3400");
    expect(walletSignedMoneySchema.parse("-12.3400")).toBe("-12.3400");
    expect(() => walletSignedMoneySchema.parse("12.34")).toThrow();
    expect(() => walletSignedMoneySchema.parse("-0.0000")).toThrow();
  });

  it("requires a positive seller Payout amount and a zero-or-negative debt balance", () => {
    expect(payoutAmountSchema.parse("0.0001")).toBe("0.0001");
    expect(() => payoutAmountSchema.parse("0.0000")).toThrow();
    expect(() => payoutAmountSchema.parse("-1.0000")).toThrow();
    expect(walletNegativeBalanceSchema.parse("0.0000")).toBe("0.0000");
    expect(walletNegativeBalanceSchema.parse("-3.2500")).toBe("-3.2500");
    expect(() => walletNegativeBalanceSchema.parse("3.2500")).toThrow();
  });

  it("normalizes currency and rejects money outside NUMERIC(18,4)", () => {
    expect(walletCurrencySchema.parse("usd")).toBe("USD");
    expect(() => walletCurrencySchema.parse("US")).toThrow();
    expect(() => payoutAmountSchema.parse("123456789012345.0000")).toThrow();
  });
});

describe("Module 17 seller and finance request boundaries", () => {
  it("keeps seller identity out of Wallet and Payout-history list filters", () => {
    expect(() => sellerWalletQuerySchema.parse({ sellerId: SELLER_ID })).toThrow();
    expect(() => sellerPayoutListQuerySchema.parse({ sellerId: SELLER_ID })).toThrow();
    expect(adminPayoutListQuerySchema.parse({ sellerId: SELLER_ID }).sellerId).toBe(SELLER_ID);
  });

  it("rejects reversed date ranges", () => {
    expect(() =>
      sellerPayoutListQuerySchema.parse({
        from: "2026-09-16T00:00:00.000Z",
        to: "2026-09-15T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts only account, positive amount, and currency for a seller Payout request", () => {
    expect(
      requestPayoutBodySchema.parse({
        accountId: ACCOUNT_ID,
        amount: "25.0000",
        currency: "usd",
      }),
    ).toEqual({
      accountId: ACCOUNT_ID,
      amount: "25.0000",
      currency: "USD",
    });

    expect(() =>
      requestPayoutBodySchema.parse({
        accountId: ACCOUNT_ID,
        amount: "25.0000",
        currency: "USD",
        sellerId: SELLER_ID,
      }),
    ).toThrow();
  });

  it("keeps payout-account status, masked display data, and verification server-derived", () => {
    expect(
      createPayoutAccountBodySchema.parse({
        providerType: "test-bank",
        providerAccountRef: "tok_provider_123",
      }),
    ).toEqual({
      providerType: "test-bank",
      providerAccountRef: "tok_provider_123",
    });

    expect(() =>
      createPayoutAccountBodySchema.parse({
        providerType: "test-bank",
        providerAccountRef: "tok_provider_123",
        status: "active",
      }),
    ).toThrow();
  });

  it("keeps finance approve/send commands free from client-owned amount and status", () => {
    expect(approvePayoutBodySchema.parse({})).toEqual({});
    expect(sendPayoutBodySchema.parse({})).toEqual({});
    expect(() => approvePayoutBodySchema.parse({ amount: "1.0000" })).toThrow();
    expect(() => sendPayoutBodySchema.parse({ status: "paid" })).toThrow();
  });
});

describe("Module 17 trusted internal command boundaries", () => {
  it("bounds settlement work and never accepts seller/currency/cutoff authority", () => {
    expect(settleWalletBodySchema.parse({})).toEqual({
      limit: WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_DEFAULT,
    });
    expect(settleWalletBodySchema.parse({ limit: 500 }).limit).toBe(500);
    expect(() => settleWalletBodySchema.parse({ limit: 501 })).toThrow();
    expect(() => settleWalletBodySchema.parse({ sellerId: SELLER_ID })).toThrow();
  });

  it("accepts only a persisted Commission entry identity for adjustment replay", () => {
    expect(adjustWalletBodySchema.parse({ commissionEntryId: COMMISSION_ENTRY_ID })).toEqual({
      commissionEntryId: COMMISSION_ENTRY_ID,
    });
    expect(() =>
      adjustWalletBodySchema.parse({
        commissionEntryId: COMMISSION_ENTRY_ID,
        amount: "5.0000",
      }),
    ).toThrow();
  });

  it("requires a bounded Idempotency-Key for retryable money commands", () => {
    expect(
      walletPayoutIdempotencyHeadersSchema.parse({ "idempotency-key": "payout-request-1" })[
        "idempotency-key"
      ],
    ).toBe("payout-request-1");
    expect(() => walletPayoutIdempotencyHeadersSchema.parse({})).toThrow();
  });
});

describe("Module 17 safe response contracts", () => {
  it("keeps pending, available, held, and recoverable negative balances separate", () => {
    expect(sellerWalletBalanceResponseSchema.parse(validWalletResponse())).toEqual(
      validWalletResponse(),
    );
  });

  it("does not expose the deterministic internal source key in seller ledger rows", () => {
    const entry = {
      id: WALLET_ENTRY_ID,
      sellerId: SELLER_ID,
      currency: "USD",
      type: "commission_credit",
      amount: "10.0000",
      balanceBucket: "pending",
      sourceType: "commission_entry",
      sourceId: COMMISSION_ENTRY_ID,
      occurredAt: OCCURRED_AT,
    };
    expect(sellerWalletEntryResponseSchema.parse(entry)).toEqual(entry);
    expect(() => sellerWalletEntryResponseSchema.parse({ ...entry, sourceKey: "secret-key" })).toThrow();
  });

  it("never exposes the provider-owned account reference in payout-account responses", () => {
    const account = {
      id: ACCOUNT_ID,
      sellerId: SELLER_ID,
      providerType: "test-bank",
      maskedDetails: "****1234",
      status: "active",
      verifiedAt: OCCURRED_AT,
    };
    expect(payoutAccountResponseSchema.parse(account)).toEqual(account);
    expect(() =>
      payoutAccountResponseSchema.parse({ ...account, providerAccountRef: "tok_provider_123" }),
    ).toThrow();

    expect(
      sellerWalletResponseSchema.parse({
        wallets: [validWalletResponse()],
        entries: [],
        payoutAccounts: [account],
      }).payoutAccounts[0]?.id,
    ).toBe(ACCOUNT_ID);
  });

  it("rejects unknown Payout lifecycle/provider-result values", () => {
    expect(payoutStatusSchema.parse("processing")).toBe(PAYOUT_STATUS.PROCESSING);
    expect(payoutProviderResultSchema.parse("unknown")).toBe(PAYOUT_PROVIDER_RESULT.UNKNOWN);
    expect(() => payoutStatusSchema.parse("cancelled")).toThrow();
    expect(() => payoutProviderResultSchema.parse("retrying")).toThrow();
  });
});


import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adminCommissionEntryListQuerySchema,
  commissionMoneySchema,
  commissionRatePercentSchema,
  commissionRuleResponseSchema,
  createCommissionRuleBodySchema,
  internalCommissionOrderSettleBodySchema,
  internalCommissionRefundAdjustBodySchema,
  sellerCommissionStatementQuerySchema,
  updateCommissionRuleBodySchema,
} from "../../src/modules/commissions/commissions.schema.js";

/** Builds one valid future-effective seller-scoped rule for strict contract tests. */
function sellerRuleInput() {
  return {
    priority: 10,
    scopeType: "seller" as const,
    scopeId: randomUUID(),
    ratePercent: "10.000000",
    fixedFee: "2.5000",
    fundingRulesJson: null,
    startAt: "2026-09-15T00:00:00.000Z",
    endAt: null,
    status: "active",
  };
}

describe("Module 16 Pass 2 Commission contracts", () => {
  it("requires exact Commission money/rate strings without floating-point coercion", () => {
    expect(commissionMoneySchema.parse("-12.3400")).toBe("-12.3400");
    expect(commissionRatePercentSchema.parse("10.000000")).toBe("10.000000");
    expect(() => commissionMoneySchema.parse("12.34")).toThrow();
    expect(() => commissionRatePercentSchema.parse("100.000001")).toThrow();
  });


  it("accepts only the approved active/inactive Commission rule statuses", () => {
    expect(createCommissionRuleBodySchema.parse(sellerRuleInput()).status).toBe("active");
    expect(
      createCommissionRuleBodySchema.parse({ ...sellerRuleInput(), status: "inactive" }).status,
    ).toBe("inactive");
    expect(() =>
      createCommissionRuleBodySchema.parse({ ...sellerRuleInput(), status: "enabled" }),
    ).toThrow();
    expect(() =>
      createCommissionRuleBodySchema.parse({ ...sellerRuleInput(), status: "ACTIVE" }),
    ).toThrow();
  });

  it("keeps fundingRulesJson non-configurable while preserving historical read compatibility", () => {
    expect(
      createCommissionRuleBodySchema.parse({ ...sellerRuleInput(), fundingRulesJson: null }),
    ).toMatchObject({ fundingRulesJson: null });
    expect(() =>
      createCommissionRuleBodySchema.parse({
        ...sellerRuleInput(),
        fundingRulesJson: { owner: "seller" },
      }),
    ).toThrow();
    expect(() =>
      updateCommissionRuleBodySchema.parse({ fundingRulesJson: { owner: "seller" } }),
    ).toThrow();
    expect(updateCommissionRuleBodySchema.parse({ fundingRulesJson: null })).toEqual({
      fundingRulesJson: null,
    });

    const historicalRule = commissionRuleResponseSchema.parse({
      id: randomUUID(),
      priority: 5,
      scopeType: "default",
      scopeId: null,
      ratePercent: "8.000000",
      fixedFee: null,
      fundingRulesJson: { legacy: true },
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: null,
      status: "inactive",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(historicalRule.fundingRulesJson).toEqual({ legacy: true });
  });

  it("enforces default-vs-target rule scope identity and effective-date shape", () => {
    expect(
      createCommissionRuleBodySchema.parse({
        ...sellerRuleInput(),
        scopeType: "default",
        scopeId: null,
      }),
    ).toMatchObject({ scopeType: "default", scopeId: null });

    expect(() =>
      createCommissionRuleBodySchema.parse({
        ...sellerRuleInput(),
        scopeType: "seller",
        scopeId: null,
      }),
    ).toThrow("seller Commission rules require scopeId.");

    expect(() =>
      createCommissionRuleBodySchema.parse({
        ...sellerRuleInput(),
        endAt: "2026-09-14T00:00:00.000Z",
      }),
    ).toThrow("endAt must be after startAt.");
  });

  it("requires at least one future-effective rule patch field", () => {
    expect(() => updateCommissionRuleBodySchema.parse({})).toThrow(
      "At least one Commission rule field is required.",
    );
    expect(updateCommissionRuleBodySchema.parse({ ratePercent: "12.500000" })).toEqual({
      ratePercent: "12.500000",
    });
  });

  it("keeps seller identity out of the seller-statement query and allows it only for finance reads", () => {
    expect(() => sellerCommissionStatementQuerySchema.parse({ sellerId: randomUUID() })).toThrow();
    expect(
      adminCommissionEntryListQuerySchema.parse({ sellerId: randomUUID(), currency: "pkr" }),
    ).toMatchObject({ currency: "PKR" });
  });

  it("keeps internal Order settlement idempotent by identity while deriving financial values server-side", () => {
    const orderId = randomUUID();
    expect(
      internalCommissionOrderSettleBodySchema.parse({
        sourceKey: "  payment:capture:txn-1  ",
        orderId,
      }),
    ).toEqual({ sourceKey: "payment:capture:txn-1", orderId });

    expect(() =>
      internalCommissionOrderSettleBodySchema.parse({
        sourceKey: "payment:capture:txn-1",
        orderId,
        commissionAmount: "25.0000",
      }),
    ).toThrow();
  });

  it("references the provider-authoritative refund transaction without accepting client money", () => {
    const orderId = randomUUID();
    const refundPaymentTransactionId = randomUUID();
    expect(
      internalCommissionRefundAdjustBodySchema.parse({
        sourceKey: "refund:return-123",
        orderId,
        refundPaymentTransactionId,
      }),
    ).toEqual({ sourceKey: "refund:return-123", orderId, refundPaymentTransactionId });

    expect(() =>
      internalCommissionRefundAdjustBodySchema.parse({
        sourceKey: "refund:return-123",
        orderId,
        refundPaymentTransactionId,
        refundAmount: "10.0000",
      }),
    ).toThrow();
  });
});

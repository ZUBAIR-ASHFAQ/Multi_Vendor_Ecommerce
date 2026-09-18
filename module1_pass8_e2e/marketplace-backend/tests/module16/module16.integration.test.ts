import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  COMMISSIONS_AUDIT_ACTION,
  COMMISSIONS_ERROR_CODE,
  COMMISSIONS_OUTBOX_EVENT,
} from "../../src/modules/commissions/commissions.constants.js";
import { CommissionsService } from "../../src/modules/commissions/commissions.service.js";
import {
  adminCommissionContext,
  countCommissionAuditEvents,
  countCommissionOutboxEvents,
  createFullCommissionRefund,
  prepareCapturedCommissionFixture,
  readCommissionEntriesForOrder,
  readCommissionSnapshotsForOrder,
  resetModule16Tables,
  sellerCommissionContext,
  systemCommissionContext,
} from "./module16.test-helpers.js";

beforeEach(async () => {
  await resetModule16Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Creates one default Commission rule through the real service boundary for active/inactive proof. */
async function createDefaultRule(
  service: CommissionsService,
  overrides: {
    priority?: number;
    ratePercent?: string;
    fixedFee?: string | null;
    startAt?: string;
    status?: "active" | "inactive";
  } = {},
) {
  return service.createRule(adminCommissionContext(), {
    priority: overrides.priority ?? 10,
    scopeType: "default",
    scopeId: null,
    ratePercent: overrides.ratePercent ?? "10.000000",
    fixedFee: overrides.fixedFee ?? "2.0000",
    fundingRulesJson: null,
    startAt: overrides.startAt ?? "2026-09-01T00:00:00.000Z",
    endAt: null,
    status: overrides.status ?? "active",
  });
}

/** Returns one AppError from an integration operation so stable business codes remain explicit. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Module 16 integration operation to reject.");
}

describe("Module 16 Commission PostgreSQL/service regression", () => {
  it("posts captured Order economics once, replays the source key, and keeps immutable snapshots after later rule changes", async () => {
    const fixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();
    const firstRule = await createDefaultRule(service);
    const system = systemCommissionContext();
    const sourceKey = `commission:settle:${randomUUID()}`;

    const first = await service.settleOrder(system, {
      sourceKey,
      orderId: fixture.order.orderId,
    });
    const replay = await service.settleOrder(systemCommissionContext(), {
      sourceKey,
      orderId: fixture.order.orderId,
    });

    expect(replay).toEqual(first);
    const entries = await readCommissionEntriesForOrder(fixture.order.orderId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "sale",
      gross_amount: "200.0000",
      commission_amount: "22.0000",
      seller_net_amount: "178.0000",
      currency: "PKR",
    });

    const snapshotsBefore = await readCommissionSnapshotsForOrder(fixture.order.orderId);
    expect(snapshotsBefore).toHaveLength(1);
    expect(snapshotsBefore[0]).toMatchObject({
      rule_id: firstRule.id,
      rate_percent: "10.000000",
      fixed_fee: "2.0000",
    });

    await createDefaultRule(service, {
      priority: 20,
      ratePercent: "50.000000",
      fixedFee: "9.0000",
      startAt: "2026-09-15T00:00:00.000Z",
    });
    const alternateSourceReplay = await service.settleOrder(systemCommissionContext(), {
      sourceKey: `commission:settle:alternate:${randomUUID()}`,
      orderId: fixture.order.orderId,
    });
    expect(alternateSourceReplay.entryIds).toEqual(first.entryIds);

    expect(await readCommissionEntriesForOrder(fixture.order.orderId)).toHaveLength(1);
    expect(await readCommissionSnapshotsForOrder(fixture.order.orderId)).toEqual(snapshotsBefore);
    expect(await countCommissionOutboxEvents(COMMISSIONS_OUTBOX_EVENT.POSTED)).toBe(1);
    expect(await countCommissionAuditEvents(COMMISSIONS_AUDIT_ACTION.ORDER_SETTLED)).toBe(2);
  });

  it("uses only active rules and selects the highest numeric priority across matching scopes", async () => {
    const fixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();
    await createDefaultRule(service, {
      priority: 10,
      ratePercent: "5.000000",
      fixedFee: null,
    });
    await createDefaultRule(service, {
      priority: 100,
      ratePercent: "99.000000",
      fixedFee: null,
      status: "inactive",
    });
    const sellerRule = await service.createRule(adminCommissionContext(), {
      priority: 20,
      scopeType: "seller",
      scopeId: fixture.order.sellers[0]!.product.seller.sellerId,
      ratePercent: "12.000000",
      fixedFee: "1.0000",
      fundingRulesJson: null,
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: null,
      status: "active",
    });

    await service.settleOrder(systemCommissionContext(), {
      sourceKey: `commission:settle:active-priority:${randomUUID()}`,
      orderId: fixture.order.orderId,
    });

    const snapshots = await readCommissionSnapshotsForOrder(fixture.order.orderId);
    const entries = await readCommissionEntriesForOrder(fixture.order.orderId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      rule_id: sellerRule.id,
      rate_percent: "12.000000",
      fixed_fee: "1.0000",
    });
    expect(entries[0]).toMatchObject({
      commission_amount: "25.0000",
      seller_net_amount: "175.0000",
    });
  });

  it("creates a zero-fee immutable snapshot when no active rule exists at capture time", async () => {
    const fixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();

    await service.settleOrder(systemCommissionContext(), {
      sourceKey: `commission:settle:no-rule:${randomUUID()}`,
      orderId: fixture.order.orderId,
    });

    const snapshots = await readCommissionSnapshotsForOrder(fixture.order.orderId);
    const entries = await readCommissionEntriesForOrder(fixture.order.orderId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      rule_id: null,
      rate_percent: "0.000000",
      fixed_fee: null,
    });
    expect(entries[0]).toMatchObject({
      gross_amount: "200.0000",
      commission_amount: "0.0000",
      seller_net_amount: "200.0000",
    });
    expect(await countCommissionOutboxEvents(COMMISSIONS_OUTBOX_EVENT.POSTED)).toBe(1);
    expect(await countCommissionAuditEvents(COMMISSIONS_AUDIT_ACTION.ORDER_SETTLED)).toBe(1);
  });

  it("uses Foundation idempotency to reject one settlement source key reused for another Order", async () => {
    const firstFixture = await prepareCapturedCommissionFixture();
    const secondFixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();
    await createDefaultRule(service);
    const sourceKey = `commission:settle:shared:${randomUUID()}`;

    await service.settleOrder(systemCommissionContext(), {
      sourceKey,
      orderId: firstFixture.order.orderId,
    });
    const error = await rejectedAppError(
      service.settleOrder(systemCommissionContext(), {
        sourceKey,
        orderId: secondFixture.order.orderId,
      }),
    );

    expect(error.code).toBe(ERROR_CODE.IDEMPOTENCY_CONFLICT);
    expect(await readCommissionEntriesForOrder(firstFixture.order.orderId)).toHaveLength(1);
    expect(await readCommissionEntriesForOrder(secondFixture.order.orderId)).toHaveLength(0);
  });

  it("rejects equal winning priority across seller and Product scopes without creating a snapshot or ledger row", async () => {
    const fixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();
    const seller = fixture.order.sellers[0]!.product.seller;
    const productId = fixture.order.sellers[0]!.product.product.id;
    const common = {
      priority: 50,
      ratePercent: "10.000000",
      fixedFee: null,
      fundingRulesJson: null,
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: null,
      status: "active",
    } as const;

    await service.createRule(adminCommissionContext(), {
      ...common,
      scopeType: "seller",
      scopeId: seller.sellerId,
    });
    await service.createRule(adminCommissionContext(), {
      ...common,
      scopeType: "product",
      scopeId: productId,
    });

    const error = await rejectedAppError(
      service.settleOrder(systemCommissionContext(), {
        sourceKey: `commission:settle:ambiguous:${randomUUID()}`,
        orderId: fixture.order.orderId,
      }),
    );

    expect(error.code).toBe(COMMISSIONS_ERROR_CODE.RULE_AMBIGUOUS);
    expect(await readCommissionEntriesForOrder(fixture.order.orderId)).toEqual([]);
    expect(await readCommissionSnapshotsForOrder(fixture.order.orderId)).toEqual([]);
  });

  it("creates append-only full-refund reversals exactly once while preserving the original sale history", async () => {
    const fixture = await prepareCapturedCommissionFixture();
    const service = new CommissionsService();
    await createDefaultRule(service);
    await service.settleOrder(systemCommissionContext(), {
      sourceKey: `commission:settle:refund-fixture:${randomUUID()}`,
      orderId: fixture.order.orderId,
    });
    const saleRows = await readCommissionEntriesForOrder(fixture.order.orderId);
    expect(saleRows).toHaveLength(1);

    const refund = await createFullCommissionRefund(fixture);
    const sourceKey = `commission:refund:${randomUUID()}`;
    const first = await service.adjustRefund(systemCommissionContext(), {
      sourceKey,
      orderId: fixture.order.orderId,
      refundPaymentTransactionId: refund.refundTransactionId,
    });
    const replay = await service.adjustRefund(systemCommissionContext(), {
      sourceKey,
      orderId: fixture.order.orderId,
      refundPaymentTransactionId: refund.refundTransactionId,
    });
    expect(replay).toEqual(first);

    const alternateCommandReplay = await service.adjustRefund(systemCommissionContext(), {
      sourceKey: `commission:refund:alternate:${randomUUID()}`,
      orderId: fixture.order.orderId,
      refundPaymentTransactionId: refund.refundTransactionId,
    });
    expect(alternateCommandReplay.entryIds).toEqual(first.entryIds);

    const history = await readCommissionEntriesForOrder(fixture.order.orderId);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject(saleRows[0]!);
    expect(history[1]).toMatchObject({
      type: "refund",
      gross_amount: `-${saleRows[0]!.gross_amount}`,
      commission_amount: `-${saleRows[0]!.commission_amount}`,
      seller_net_amount: `-${saleRows[0]!.seller_net_amount}`,
    });
    expect(await countCommissionOutboxEvents(COMMISSIONS_OUTBOX_EVENT.ADJUSTED)).toBe(1);
    expect(await countCommissionAuditEvents(COMMISSIONS_AUDIT_ACTION.REFUND_ADJUSTED)).toBe(2);
  });

  it("keeps real multi-seller statements scoped to each seller after one captured parent Order settles", async () => {
    const fixture = await prepareCapturedCommissionFixture({ sellerCount: 2 });
    const service = new CommissionsService();
    await createDefaultRule(service, { fixedFee: "0.0000" });
    await service.settleOrder(systemCommissionContext(), {
      sourceKey: `commission:settle:multi-seller:${randomUUID()}`,
      orderId: fixture.order.orderId,
    });

    expect(await readCommissionEntriesForOrder(fixture.order.orderId)).toHaveLength(2);
    const sellerA = fixture.order.sellers[0]!.product.seller;
    const sellerB = fixture.order.sellers[1]!.product.seller;
    const query = { page: 1, pageSize: 20, sort: "occurredAt" as const, order: "desc" as const };

    const statementA = await service.getSellerStatement(
      sellerCommissionContext(sellerA.sellerId),
      query,
    );
    const statementB = await service.getSellerStatement(
      sellerCommissionContext(sellerB.sellerId),
      query,
    );

    expect(statementA.statement.sellerId).toBe(sellerA.sellerId);
    expect(statementA.statement.entries).toHaveLength(1);
    expect(statementA.statement.entries[0]?.sellerId).toBe(sellerA.sellerId);
    expect(statementB.statement.sellerId).toBe(sellerB.sellerId);
    expect(statementB.statement.entries).toHaveLength(1);
    expect(statementB.statement.entries[0]?.sellerId).toBe(sellerB.sellerId);
    expect(statementA.statement.entries[0]?.sellerId).not.toBe(statementB.statement.entries[0]?.sellerId);
  });
});

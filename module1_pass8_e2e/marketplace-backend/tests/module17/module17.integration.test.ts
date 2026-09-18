import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import { COMMISSIONS_OUTBOX_EVENT } from "../../src/modules/commissions/commissions.constants.js";
import { CommissionsService } from "../../src/modules/commissions/commissions.service.js";
import {
  PAYOUT_STATUS,
  WALLET_ENTRY_TYPE,
  WALLET_PAYOUT_AUDIT_ACTION,
  WALLET_PAYOUT_OUTBOX_EVENT,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { ShippingService } from "../../src/modules/shipping/shipping.service.js";
import {
  approveReturnViaHttp,
  createIntegrationReturnsService,
  createReturnViaHttp,
  issueReturnRefund,
} from "../module14/module14.test-helpers.js";
import {
  adminWalletContext,
  countIdempotencyRecords,
  countWalletAuditEvents,
  countWalletOutboxEvents,
  createIntegrationWalletService,
  createWalletPayoutAccount,
  prepareWalletEarningsFixture,
  readLatestNegativeCommissionSource,
  readPayout,
  readPayoutAllocations,
  readWallet,
  readWalletEntries,
  resetModule17Tables,
  sellerWalletContext,
  systemWalletContext,
  WalletPayoutProvider,
} from "./module17.test-helpers.js";

beforeEach(async () => {
  await resetModule17Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Adds exact scale-4 money strings using integer arithmetic for database reconciliation assertions. */
function sumScale4(values: string[]): string {
  const total = values.reduce((sum, value) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole = "0", fraction = ""] = unsigned.split(".");
    const units = BigInt(whole) * 10_000n + BigInt((fraction + "0000").slice(0, 4));
    return sum + (negative ? -units : units);
  }, 0n);
  const negative = total < 0n;
  const unsigned = negative ? -total : total;
  return `${negative ? "-" : ""}${unsigned / 10_000n}.${(unsigned % 10_000n)
    .toString()
    .padStart(4, "0")}`;
}

describe("Module 17 PostgreSQL cross-module reconciliation", () => {
  it("consumes a committed Commission event idempotently and settles it through the scheduled command", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    const eventId = randomUUID();
    const sourceEvent = {
      eventId,
      event: {
        eventType: COMMISSIONS_OUTBOX_EVENT.POSTED,
        aggregateType: "commission_entry",
        aggregateId: fixture.saleCommissionEntryId,
        payload: { commissionEntryId: fixture.saleCommissionEntryId },
      },
    };

    await service.handleSourceEvent(sourceEvent);
    await service.handleSourceEvent({ ...sourceEvent, eventId: randomUUID() });

    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.COMMISSION_CREDIT)).toHaveLength(1);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: fixture.saleSellerNetAmount,
      available_balance: "0.0000",
    });

    const settled = await service.settleScheduledWallets({
      input: { limit: 100 },
      idempotencyKey: `module17-scheduled-${randomUUID()}`,
    });

    expect(settled).toMatchObject({ scanned: 1, settled: 1, skipped: 0 });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: fixture.saleSellerNetAmount,
    });
  });

  it("reconciles Commission -> delivery/hold -> available -> reserved -> provider-paid Payout exactly once", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const provider = new WalletPayoutProvider();
    provider.queueResult({
      status: "paid",
      providerRef: "provider_module17_paid",
      processedAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1_000),
    });
    const { service } = createIntegrationWalletService(provider);
    const systemContext = systemWalletContext();

    const commissionSnapshot = await new CommissionsService().getWalletEntrySnapshot(
      systemContext,
      fixture.saleCommissionEntryId,
    );
    expect(commissionSnapshot).toMatchObject({
      sellerId: fixture.sellerId,
      orderId: fixture.orderId,
      sellerOrderId: fixture.sellerOrderId,
      orderItemId: fixture.orderItemId,
      sellerNetAmount: fixture.saleSellerNetAmount,
      currency: fixture.currency,
      entryType: "sale",
    });
    const deliverySnapshot = await new ShippingService().getWalletDeliverySnapshot(systemContext, {
      orderId: fixture.orderId,
      sellerId: fixture.sellerId,
      sellerOrderId: fixture.sellerOrderId,
      orderItemId: fixture.orderItemId,
    });
    expect(deliverySnapshot).toMatchObject({ fullyDelivered: true, deliveredQuantity: 2 });

    const credit = await service.applyCommissionSource(systemContext, fixture.saleCommissionEntryId);
    expect(credit).toMatchObject({ applied: true });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: fixture.saleSellerNetAmount,
      available_balance: "0.0000",
    });

    const settleKey = `module17-integration-settle-${randomUUID()}`;
    const settled = await service.settleWallet(systemWalletContext(), { limit: 100 }, settleKey);
    expect(settled).toMatchObject({ scanned: 1, settled: 1, skipped: 0 });
    expect(await countIdempotencyRecords(settleKey)).toBe(1);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: fixture.saleSellerNetAmount,
      held_balance: "0.0000",
    });

    const account = await createWalletPayoutAccount(service, fixture);
    const sellerContext = sellerWalletContext({
      actorId: fixture.sellerUserId,
      sellerId: fixture.sellerId,
    });
    const adminContext = adminWalletContext(fixture.customerUserId);
    const requestKey = `module17-integration-request-${randomUUID()}`;
    const payout = await service.requestPayout(
      sellerContext,
      {
        accountId: account.id,
        amount: fixture.saleSellerNetAmount,
        currency: fixture.currency,
      },
      requestKey,
    );
    expect(payout.status).toBe(PAYOUT_STATUS.REQUESTED);

    const approveKey = `module17-integration-approve-${randomUUID()}`;
    const approved = await service.approvePayout(adminContext, payout.id, approveKey);
    expect(approved.status).toBe(PAYOUT_STATUS.APPROVED);
    expect(sumScale4(approved.allocations.map((allocation) => allocation.amount))).toBe(
      fixture.saleSellerNetAmount,
    );
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      available_balance: "0.0000",
      held_balance: fixture.saleSellerNetAmount,
    });

    const sendKey = `module17-integration-send-${randomUUID()}`;
    const paid = await service.sendPayout(adminContext, payout.id, sendKey);
    const replay = await service.sendPayout(
      { ...adminContext, requestId: randomUUID() },
      payout.id,
      sendKey,
    );
    expect(replay).toEqual(paid);
    expect(provider.sendCalls).toHaveLength(1);
    expect(paid).toMatchObject({
      status: PAYOUT_STATUS.PAID,
      providerRef: "provider_module17_paid",
    });
    expect(await readPayout(payout.id)).toMatchObject({
      status: PAYOUT_STATUS.PAID,
      provider_ref: "provider_module17_paid",
    });
    expect(sumScale4((await readPayoutAllocations(payout.id)).map((row) => row.amount))).toBe(
      fixture.saleSellerNetAmount,
    );
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: "0.0000",
      held_balance: "0.0000",
      negative_balance: "0.0000",
    });

    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.COMMISSION_CREDIT)).toHaveLength(1);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER)).toHaveLength(2);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.PAYOUT_RESERVE)).toHaveLength(2);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.PAYOUT_PAID)).toHaveLength(1);
    expect(sumScale4(entries.filter((entry) => entry.balance_bucket === "pending").map((entry) => entry.amount))).toBe("0.0000");
    expect(sumScale4(entries.filter((entry) => entry.balance_bucket === "available").map((entry) => entry.amount))).toBe("0.0000");
    expect(sumScale4(entries.filter((entry) => entry.balance_bucket === "held").map((entry) => entry.amount))).toBe("0.0000");

    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.WALLET_CREDITED, fixture.sellerId)).toBe(1);
    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE, fixture.sellerId)).toBe(1);
    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED, payout.id)).toBe(1);
    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID, payout.id)).toBe(1);
    expect(await countWalletAuditEvents(WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_PAID, payout.id)).toBe(1);
    expect(await countIdempotencyRecords(requestKey)).toBe(1);
    expect(await countIdempotencyRecords(approveKey)).toBe(1);
    expect(await countIdempotencyRecords(sendKey)).toBe(1);
  });

  it("keeps paid Payout history immutable when a later Return refund creates a negative Wallet adjustment", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const provider = new WalletPayoutProvider();
    provider.queueResult({
      status: "paid",
      providerRef: "provider_before_refund",
      processedAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1_000),
    });
    const { service } = createIntegrationWalletService(provider);
    await service.applyCommissionSource(systemWalletContext(), fixture.saleCommissionEntryId);
    await service.settleWallet(
      systemWalletContext(),
      { limit: 100 },
      `module17-pre-refund-settle-${randomUUID()}`,
    );
    const account = await createWalletPayoutAccount(service, fixture);
    const payout = await service.requestPayout(
      sellerWalletContext({ actorId: fixture.sellerUserId, sellerId: fixture.sellerId }),
      { accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency },
      `module17-pre-refund-request-${randomUUID()}`,
    );
    const adminContext = adminWalletContext(fixture.customerUserId);
    await service.approvePayout(
      adminContext,
      payout.id,
      `module17-pre-refund-approve-${randomUUID()}`,
    );
    await service.sendPayout(
      adminContext,
      payout.id,
      `module17-pre-refund-send-${randomUUID()}`,
    );

    const createdReturn = await createReturnViaHttp(fixture.customerToken, fixture.orderId, {
      sellerOrderId: fixture.sellerOrderId,
      items: [{ orderItemId: fixture.orderItemId, quantity: 1 }],
    });
    await approveReturnViaHttp(fixture.sellerToken, createdReturn.id);
    const returns = createIntegrationReturnsService();
    await issueReturnRefund(
      returns.service,
      fixture,
      createdReturn.id,
      `module17-post-payout-refund-${randomUUID()}`,
    );
    const negativeSource = await readLatestNegativeCommissionSource(fixture.orderItemId);
    if (!negativeSource) throw new Error("Expected Module 14 refund to append a negative Commission source.");

    const adjustKey = `module17-post-payout-adjust-${randomUUID()}`;
    const first = await service.adjustWallet(
      systemWalletContext(),
      { commissionEntryId: negativeSource.id },
      adjustKey,
    );
    const replay = await service.adjustWallet(
      systemWalletContext(),
      { commissionEntryId: negativeSource.id },
      adjustKey,
    );
    expect(replay).toEqual(first);
    expect(first.applied).toBe(true);
    expect(first.wallet.negativeBalance).toBe(negativeSource.seller_net_amount);

    expect(await readPayout(payout.id)).toMatchObject({
      status: PAYOUT_STATUS.PAID,
      provider_ref: "provider_before_refund",
    });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: "0.0000",
      held_balance: "0.0000",
      negative_balance: negativeSource.seller_net_amount,
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT)).toHaveLength(1);
    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.WALLET_ADJUSTED, fixture.sellerId)).toBe(1);
    expect(await countWalletAuditEvents(WALLET_PAYOUT_AUDIT_ACTION.WALLET_ADJUSTED, fixture.sellerId)).toBe(1);
    expect(await countIdempotencyRecords(adjustKey)).toBe(1);
  });
});

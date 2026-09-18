import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { closeDatabase } from "../../src/database/db.js";
import {
  COMMISSION_ENTRY_TYPE,
  COMMISSIONS_OUTBOX_EVENT,
} from "../../src/modules/commissions/commissions.constants.js";
import type { CommissionWalletEntrySnapshot } from "../../src/modules/commissions/commissions.service.js";
import {
  PAYOUT_STATUS,
  WALLET_ENTRY_TYPE,
  WALLET_PAYOUT_AUDIT_ACTION,
  WALLET_PAYOUT_ERROR_CODE,
  WALLET_PAYOUT_OUTBOX_EVENT,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { SellerWalletPayoutsService } from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.service.js";
import {
  adminWalletContext,
  createIntegrationWalletService,
  countWalletAuditEvents,
  countWalletOutboxEvents,
  createWalletPayoutAccount,
  creditAndSettleWallet,
  prepareWalletEarningsFixture,
  readPayout,
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

/** Returns one stable AppError from a rejected Module 17 command for code/status assertions. */
async function rejectedAppError(operation: Promise<unknown>): Promise<AppError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected Module 17 command to reject.");
}

describe("Module 17 Wallet/Payout service invariants", () => {
  it("credits one Commission sale to pending and replays the same immutable source without duplicate Wallet entries", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const { service } = createIntegrationWalletService();

    const first = await service.applyCommissionSource(
      systemWalletContext(),
      fixture.saleCommissionEntryId,
    );
    const replay = await service.applyCommissionSource(
      systemWalletContext(),
      fixture.saleCommissionEntryId,
    );

    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(first.wallet.pendingBalance).toBe(fixture.saleSellerNetAmount);
    const wallet = await readWallet(fixture.sellerId, fixture.currency);
    expect(wallet).toMatchObject({
      pending_balance: fixture.saleSellerNetAmount,
      available_balance: "0.0000",
      held_balance: "0.0000",
      negative_balance: "0.0000",
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.COMMISSION_CREDIT)).toHaveLength(1);
  });

  it("replays the same committed Commission event without duplicating the Wallet credit", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    const eventId = randomUUID();
    const job = {
      eventId,
      event: {
        eventType: COMMISSIONS_OUTBOX_EVENT.POSTED,
        aggregateType: "commission_entry",
        aggregateId: fixture.saleCommissionEntryId,
        payload: { commissionEntryId: fixture.saleCommissionEntryId },
      },
    };

    await service.handleSourceEvent(job);
    await service.handleSourceEvent(job);

    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: fixture.saleSellerNetAmount,
      available_balance: "0.0000",
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(
      entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.COMMISSION_CREDIT),
    ).toHaveLength(1);
  });

  it("replays one scheduled settlement occurrence without moving the same pending source twice", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    await service.applyCommissionSource(
      systemWalletContext(),
      fixture.saleCommissionEntryId,
    );
    const job = {
      input: { limit: 100 },
      idempotencyKey: `module17-scheduled-settlement-${randomUUID()}`,
    };

    const first = await service.settleScheduledWallets(job);
    const replay = await service.settleScheduledWallets(job);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ settled: 1, skipped: 0 });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: fixture.saleSellerNetAmount,
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(
      entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER),
    ).toHaveLength(2);
  });

  it("keeps funds pending before the hold gate and concurrent eligible settlement cannot move the same source twice", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const currentService = new SellerWalletPayoutsService({
      administration: {
        /** Uses the approved 30-day Return window while the clock is still at delivery time. */
        async getReturnWindowDays() {
          return 30;
        },
      },
      now: () => new Date(),
    });
    await currentService.applyCommissionSource(
      systemWalletContext(),
      fixture.saleCommissionEntryId,
    );
    const early = await currentService.settleWallet(
      systemWalletContext(),
      { limit: 100 },
      `module17-early-settlement-${randomUUID()}`,
    );
    expect(early).toMatchObject({ settled: 0, skipped: 1 });
    expect((await readWallet(fixture.sellerId, fixture.currency))?.available_balance).toBe("0.0000");

    const first = createIntegrationWalletService().service;
    const second = createIntegrationWalletService().service;
    const results = await Promise.all([
      first.settleWallet(
        systemWalletContext(),
        { limit: 100 },
        `module17-concurrent-settlement-a-${randomUUID()}`,
      ),
      second.settleWallet(
        systemWalletContext(),
        { limit: 100 },
        `module17-concurrent-settlement-b-${randomUUID()}`,
      ),
    ]);

    expect(results.reduce((total, result) => total + result.settled, 0)).toBe(1);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      available_balance: fixture.saleSellerNetAmount,
      held_balance: "0.0000",
      negative_balance: "0.0000",
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER)).toHaveLength(2);
  });


  it("recovers a pre-existing negative balance before any later Commission sale remainder becomes pending", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const negativeId = randomUUID();
    const firstSaleId = randomUUID();
    const secondSaleId = randomUUID();
    const sources = new Map<string, CommissionWalletEntrySnapshot>([
      [
        negativeId,
        {
          commissionEntryId: negativeId,
          orderId: fixture.orderId,
          sellerId: fixture.sellerId,
          sellerOrderId: fixture.sellerOrderId,
          orderItemId: fixture.orderItemId,
          entryType: COMMISSION_ENTRY_TYPE.REFUND,
          sellerNetAmount: "-50.0000",
          currency: fixture.currency,
          sourceKey: `test-negative-${negativeId}`,
          occurredAt: new Date().toISOString(),
        },
      ],
      [
        firstSaleId,
        {
          commissionEntryId: firstSaleId,
          orderId: fixture.orderId,
          sellerId: fixture.sellerId,
          sellerOrderId: fixture.sellerOrderId,
          orderItemId: fixture.orderItemId,
          entryType: COMMISSION_ENTRY_TYPE.SALE,
          sellerNetAmount: "30.0000",
          currency: fixture.currency,
          sourceKey: `test-sale-${firstSaleId}`,
          occurredAt: new Date().toISOString(),
        },
      ],
      [
        secondSaleId,
        {
          commissionEntryId: secondSaleId,
          orderId: fixture.orderId,
          sellerId: fixture.sellerId,
          sellerOrderId: fixture.sellerOrderId,
          orderItemId: fixture.orderItemId,
          entryType: COMMISSION_ENTRY_TYPE.SALE,
          sellerNetAmount: "40.0000",
          currency: fixture.currency,
          sourceKey: `test-sale-${secondSaleId}`,
          occurredAt: new Date().toISOString(),
        },
      ],
    ]);
    const service = new SellerWalletPayoutsService({
      commissions: {
        /** Returns deterministic immutable Commission facts so this test isolates Wallet waterfall arithmetic. */
        async getWalletEntrySnapshot(_context, commissionEntryId) {
          const source = sources.get(commissionEntryId);
          if (!source) throw new Error("Unknown Module 17 synthetic Commission source.");
          return source;
        },
      },
    });

    await service.applyCommissionSource(systemWalletContext(), negativeId);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      negative_balance: "-50.0000",
    });

    await service.applyCommissionSource(systemWalletContext(), firstSaleId);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "0.0000",
      negative_balance: "-20.0000",
    });

    await service.applyCommissionSource(systemWalletContext(), secondSaleId);
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      pending_balance: "20.0000",
      negative_balance: "0.0000",
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.NEGATIVE_RECOVERY)).toHaveLength(2);
  });

  it("rejects invalid payout accounts and a Payout amount above authoritative available balance", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const { service } = createIntegrationWalletService();
    await creditAndSettleWallet(service, fixture);
    const sellerContext = sellerWalletContext({
      actorId: fixture.sellerUserId,
      sellerId: fixture.sellerId,
    });

    const invalidAccount = await rejectedAppError(
      service.requestPayout(
        sellerContext,
        {
          accountId: randomUUID(),
          amount: "1.0000",
          currency: fixture.currency,
        },
        `module17-invalid-account-${randomUUID()}`,
      ),
    );
    expect(invalidAccount.code).toBe(WALLET_PAYOUT_ERROR_CODE.PAYOUT_ACCOUNT_INVALID);

    const account = await createWalletPayoutAccount(service, fixture);
    const tooLarge = await rejectedAppError(
      service.requestPayout(
        sellerContext,
        {
          accountId: account.id,
          amount: "999999.0000",
          currency: fixture.currency,
        },
        `module17-insufficient-${randomUUID()}`,
      ),
    );
    expect(tooLarge.code).toBe(WALLET_PAYOUT_ERROR_CODE.INSUFFICIENT_AVAILABLE_BALANCE);
  });

  it("serializes concurrent approvals so two requested Payouts cannot reserve the same available balance", async () => {
    const fixture = await prepareWalletEarningsFixture(2);
    const { service } = createIntegrationWalletService();
    await creditAndSettleWallet(service, fixture);
    const account = await createWalletPayoutAccount(service, fixture);
    const sellerContext = sellerWalletContext({
      actorId: fixture.sellerUserId,
      sellerId: fixture.sellerId,
    });
    const adminContext = adminWalletContext(fixture.customerUserId);

    const firstRequest = await service.requestPayout(
      sellerContext,
      { accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency },
      `module17-request-a-${randomUUID()}`,
    );
    const secondRequest = await service.requestPayout(
      sellerContext,
      { accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency },
      `module17-request-b-${randomUUID()}`,
    );

    const approvals = await Promise.allSettled([
      service.approvePayout(
        { ...adminContext, requestId: randomUUID() },
        firstRequest.id,
        `module17-approve-a-${randomUUID()}`,
      ),
      service.approvePayout(
        { ...adminContext, requestId: randomUUID() },
        secondRequest.id,
        `module17-approve-b-${randomUUID()}`,
      ),
    ]);

    const approved = approvals.filter((result) => result.status === "fulfilled");
    const rejected = approvals.filter((result) => result.status === "rejected");
    expect(approved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: WALLET_PAYOUT_ERROR_CODE.INSUFFICIENT_AVAILABLE_BALANCE,
    });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      available_balance: "0.0000",
      held_balance: fixture.saleSellerNetAmount,
    });
  });

  it("keeps a provider-unknown Payout processing and held, then safely re-drives the same provider identity", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const provider = new WalletPayoutProvider();
    provider.queueResult({ status: "unknown" });
    provider.queueResult({
      status: "paid",
      providerRef: "provider_retry_paid",
      processedAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1_000),
    });
    const { service } = createIntegrationWalletService(provider);
    await creditAndSettleWallet(service, fixture);
    const account = await createWalletPayoutAccount(service, fixture);
    const sellerContext = sellerWalletContext({
      actorId: fixture.sellerUserId,
      sellerId: fixture.sellerId,
    });
    const adminContext = adminWalletContext(fixture.customerUserId);
    const payout = await service.requestPayout(
      sellerContext,
      { accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency },
      `module17-provider-request-${randomUUID()}`,
    );
    await service.approvePayout(
      adminContext,
      payout.id,
      `module17-provider-approve-${randomUUID()}`,
    );
    const sendKey = `module17-provider-send-${randomUUID()}`;

    const unknown = await rejectedAppError(service.sendPayout(adminContext, payout.id, sendKey));
    expect(unknown.code).toBe(WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR);
    expect(await readPayout(payout.id)).toMatchObject({ status: PAYOUT_STATUS.PROCESSING });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      available_balance: "0.0000",
      held_balance: fixture.saleSellerNetAmount,
    });

    const paid = await service.sendPayout(
      { ...adminContext, requestId: randomUUID() },
      payout.id,
      sendKey,
    );
    expect(paid.status).toBe(PAYOUT_STATUS.PAID);
    expect(provider.sendCalls).toHaveLength(2);
    expect(new Set(provider.sendCalls.map((call) => call.providerIdempotencyKey))).toEqual(
      new Set([`payout:${payout.id}:send`]),
    );
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      available_balance: "0.0000",
      held_balance: "0.0000",
    });
  });

  it("records authoritative provider failure as failed and releases held money exactly once on replay", async () => {
    const fixture = await prepareWalletEarningsFixture(1);
    const provider = new WalletPayoutProvider();
    provider.queueResult({
      status: "failed",
      failureCode: "bank_rejected",
      processedAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1_000),
    });
    const { service } = createIntegrationWalletService(provider);
    await creditAndSettleWallet(service, fixture);
    const account = await createWalletPayoutAccount(service, fixture);
    const sellerContext = sellerWalletContext({
      actorId: fixture.sellerUserId,
      sellerId: fixture.sellerId,
    });
    const adminContext = adminWalletContext(fixture.customerUserId);
    const payout = await service.requestPayout(
      sellerContext,
      { accountId: account.id, amount: fixture.saleSellerNetAmount, currency: fixture.currency },
      `module17-failed-request-${randomUUID()}`,
    );
    await service.approvePayout(
      adminContext,
      payout.id,
      `module17-failed-approve-${randomUUID()}`,
    );
    const sendKey = `module17-failed-send-${randomUUID()}`;

    const firstFailure = await rejectedAppError(service.sendPayout(adminContext, payout.id, sendKey));
    const replayFailure = await rejectedAppError(
      service.sendPayout({ ...adminContext, requestId: randomUUID() }, payout.id, sendKey),
    );
    expect(firstFailure.code).toBe(WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR);
    expect(replayFailure.code).toBe(WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR);
    expect(provider.sendCalls).toHaveLength(1);
    expect(await readPayout(payout.id)).toMatchObject({ status: PAYOUT_STATUS.FAILED });
    expect(await readWallet(fixture.sellerId, fixture.currency)).toMatchObject({
      available_balance: fixture.saleSellerNetAmount,
      held_balance: "0.0000",
    });
    const entries = await readWalletEntries(fixture.sellerId, fixture.currency);
    expect(entries.filter((entry) => entry.type === WALLET_ENTRY_TYPE.PAYOUT_RELEASE)).toHaveLength(2);
    expect(await countWalletAuditEvents(WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_FAILED, payout.id)).toBe(1);
    expect(await countWalletOutboxEvents(WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED, payout.id)).toBe(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../../src/database/db.js";
import {
  PAYOUT_ACCOUNT_STATUS,
  PAYOUT_STATUS,
  WALLET_BALANCE_BUCKET,
  WALLET_ENTRY_TYPE,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { SellerWalletPayoutsRepository } from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.repository.js";
import {
  adminPayoutListQuerySchema,
  sellerPayoutListQuerySchema,
  sellerWalletQuerySchema,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.schema.js";
import {
  createApprovedSeller,
  createPlatformAdmin,
  loginUser,
  resetModule4Tables,
} from "../module4/module4.test-helpers.js";

/** Creates two released seller fixtures without bypassing seller ownership setup. */
async function createSellerPair() {
  const admin = await createPlatformAdmin(`module17-repo-admin-${randomUUID()}@example.com`);
  const adminToken = await loginUser(admin);
  const suffix = randomUUID().slice(0, 8);
  const sellerA = await createApprovedSeller(adminToken, `WalletRepoA${suffix}`);
  const sellerB = await createApprovedSeller(adminToken, `WalletRepoB${suffix}`);
  return { sellerA, sellerB };
}

/** Creates one active tokenized payout-account row for repository-only Payout fixtures. */
async function createAccount(
  repository: SellerWalletPayoutsRepository,
  sellerId: string,
  suffix: string,
) {
  return repository.createPayoutAccount({
    sellerId,
    providerType: "testbank",
    maskedDetails: `****${suffix.slice(-4)}`,
    providerAccountRef: `acct_${suffix}`,
    status: PAYOUT_ACCOUNT_STATUS.ACTIVE,
    verifiedAt: new Date(),
  });
}

beforeEach(async () => {
  await resetModule4Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 17 Seller Wallet/Payout repository boundaries", () => {
  it("keeps Wallet reads seller-scoped and makes source-key insertion replay-safe", async () => {
    const { sellerA, sellerB } = await createSellerPair();
    const repository = new SellerWalletPayoutsRepository();

    await repository.ensureWallet(sellerA.sellerId, "PKR");
    await repository.ensureWallet(sellerB.sellerId, "PKR");
    const sellerAEntry = await repository.createWalletEntryIfMissing({
      sellerId: sellerA.sellerId,
      currency: "PKR",
      type: WALLET_ENTRY_TYPE.COMMISSION_CREDIT,
      amount: "25.0000",
      balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
      sourceType: "commission",
      sourceId: randomUUID(),
      sourceKey: "module17-repository-source-a",
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await repository.createWalletEntryIfMissing({
      sellerId: sellerB.sellerId,
      currency: "PKR",
      type: WALLET_ENTRY_TYPE.COMMISSION_CREDIT,
      amount: "40.0000",
      balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
      sourceType: "commission",
      sourceId: randomUUID(),
      sourceKey: "module17-repository-source-b",
      occurredAt: new Date("2026-09-02T00:00:00.000Z"),
    });

    const query = sellerWalletQuerySchema.parse({ page: 1, pageSize: 20 });
    const sellerAEntries = await repository.listSellerWalletEntries(sellerA.sellerId, query);
    expect(sellerAEntries.totalItems).toBe(1);
    expect(sellerAEntries.items[0]?.sellerId).toBe(sellerA.sellerId);

    await expect(
      repository.createWalletEntryIfMissing({
        sellerId: sellerA.sellerId,
        currency: "PKR",
        type: WALLET_ENTRY_TYPE.COMMISSION_CREDIT,
        amount: "25.0000",
        balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
        sourceType: "commission",
        sourceId: randomUUID(),
        sourceKey: "module17-repository-source-a",
        occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();

    if (!sellerAEntry) throw new Error("Expected the first Wallet source entry.");
    await repository.createWalletEntryIfMissing({
      sellerId: sellerA.sellerId,
      currency: "PKR",
      type: WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
      amount: "-25.0000",
      balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
      sourceType: "settlement",
      sourceId: sellerAEntry.id,
      sourceKey: `settle:${sellerAEntry.id}:pending-debit`,
      occurredAt: new Date("2026-09-03T00:00:00.000Z"),
    });

    const settlementCandidates = await repository.listPendingSettlementCandidates(20);
    expect(settlementCandidates.map((row) => row.sellerId)).toEqual([sellerB.sellerId]);
  });

  it("locks and updates one Wallet snapshot without affecting another seller", async () => {
    const { sellerA, sellerB } = await createSellerPair();
    const repository = new SellerWalletPayoutsRepository();
    await repository.ensureWallet(sellerA.sellerId, "PKR");
    await repository.ensureWallet(sellerB.sellerId, "PKR");

    await db.transaction(async (transaction) => {
      const scoped = repository.using(transaction);
      const locked = await scoped.lockWallet(sellerA.sellerId, "PKR");
      expect(locked?.sellerId).toBe(sellerA.sellerId);
      await scoped.updateWalletSnapshot(sellerA.sellerId, "PKR", {
        pendingBalance: "10.0000",
        availableBalance: "20.0000",
        heldBalance: "5.0000",
        negativeBalance: "0.0000",
      });
    });

    expect((await repository.listSellerWallets(sellerA.sellerId, "PKR"))[0]?.availableBalance).toBe(
      "20.0000",
    );
    expect((await repository.listSellerWallets(sellerB.sellerId, "PKR"))[0]?.availableBalance).toBe(
      "0.0000",
    );
  });

  it("scopes seller Payout reads and preserves FIFO allocation evidence for finance", async () => {
    const { sellerA, sellerB } = await createSellerPair();
    const repository = new SellerWalletPayoutsRepository();
    await repository.ensureWallet(sellerA.sellerId, "PKR");
    await repository.ensureWallet(sellerB.sellerId, "PKR");
    const accountA = await createAccount(repository, sellerA.sellerId, randomUUID());
    const accountB = await createAccount(repository, sellerB.sellerId, randomUUID());

    const olderEntry = await repository.createWalletEntryIfMissing({
      sellerId: sellerA.sellerId,
      currency: "PKR",
      type: WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
      amount: "30.0000",
      balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
      sourceType: "settlement",
      sourceId: randomUUID(),
      sourceKey: `settle:${randomUUID()}:available-credit`,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const newerEntry = await repository.createWalletEntryIfMissing({
      sellerId: sellerA.sellerId,
      currency: "PKR",
      type: WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
      amount: "20.0000",
      balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
      sourceType: "settlement",
      sourceId: randomUUID(),
      sourceKey: `settle:${randomUUID()}:available-credit`,
      occurredAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    if (!olderEntry || !newerEntry) throw new Error("Expected Wallet allocation source fixtures.");

    const payoutA = await repository.createPayout({
      payoutNo: `PAY-${randomUUID().replaceAll("-", "").toUpperCase()}`,
      sellerId: sellerA.sellerId,
      amount: "35.0000",
      currency: "PKR",
      accountId: accountA.id,
      status: PAYOUT_STATUS.APPROVED,
    });
    const payoutB = await repository.createPayout({
      payoutNo: `PAY-${randomUUID().replaceAll("-", "").toUpperCase()}`,
      sellerId: sellerB.sellerId,
      amount: "10.0000",
      currency: "PKR",
      accountId: accountB.id,
      status: PAYOUT_STATUS.REQUESTED,
    });
    await repository.createPayoutAllocations(payoutA.id, [
      { walletEntryId: olderEntry.id, amount: "30.0000" },
      { walletEntryId: newerEntry.id, amount: "5.0000" },
    ]);

    const sellerQuery = sellerPayoutListQuerySchema.parse({ page: 1, pageSize: 20 });
    const sellerAHistory = await repository.listSellerPayouts(sellerA.sellerId, sellerQuery);
    expect(sellerAHistory.totalItems).toBe(1);
    expect(sellerAHistory.items[0]?.id).toBe(payoutA.id);

    const adminQuery = adminPayoutListQuerySchema.parse({
      sellerId: sellerB.sellerId,
      page: 1,
      pageSize: 20,
    });
    const sellerBQueue = await repository.listAdminPayouts(adminQuery);
    expect(sellerBQueue.items.map((row) => row.id)).toEqual([payoutB.id]);

    const sources = await repository.listAvailableAllocationSourceEntries(sellerA.sellerId, "PKR");
    expect(sources.map((row) => row.id)).toEqual([olderEntry.id, newerEntry.id]);
    const usage = await repository.listAllocationUsageForWalletEntries(
      sources.map((row) => row.id),
    );
    expect(usage.map((row) => [row.walletEntryId, row.payoutStatus, row.amount])).toEqual([
      [olderEntry.id, PAYOUT_STATUS.APPROVED, "30.0000"],
      [newerEntry.id, PAYOUT_STATUS.APPROVED, "5.0000"],
    ]);
  });
});

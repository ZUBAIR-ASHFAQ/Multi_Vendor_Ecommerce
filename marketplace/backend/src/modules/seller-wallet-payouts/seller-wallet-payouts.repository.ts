import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import {
  payoutAccounts,
  payoutAllocations,
  payouts,
  sellerWalletEntries,
  sellerWallets,
  type NewPayoutAccountRow,
  type NewPayoutAllocationRow,
  type NewPayoutRow,
  type NewSellerWalletEntryRow,
  type PayoutAccountRow,
  type PayoutAllocationRow,
  type PayoutRow,
  type SellerWalletEntryRow,
  type SellerWalletRow,
} from "../../database/schema/seller-wallet-payouts.js";
import type { DatabaseExecutor } from "../../database/types.js";
import {
  WALLET_BALANCE_BUCKET,
  WALLET_ENTRY_TYPE,
} from "./seller-wallet-payouts.constants.js";
import type {
  AdminPayoutListQuery,
  PayoutAccountStatus,
  PayoutStatus,
  SellerPayoutListQuery,
  SellerWalletQuery,
  WalletBalanceBucket,
  WalletEntryType,
} from "./seller-wallet-payouts.schema.js";

/** One bounded page of immutable Wallet ledger rows for a seller-facing read. */
export interface PaginatedWalletEntryRows {
  items: SellerWalletEntryRow[];
  totalItems: number;
}

/** One bounded page of Payout headers before the service attaches allocation rows. */
export interface PaginatedPayoutRows {
  items: PayoutRow[];
  totalItems: number;
}

/** Complete Wallet balance snapshot already calculated by the Module 17 service. */
export interface UpdateWalletSnapshotRecordInput {
  pendingBalance: string;
  availableBalance: string;
  heldBalance: string;
  negativeBalance: string;
  updatedAt?: Date;
}

/** Immutable Wallet ledger facts already derived and authorized by the Module 17 service. */
export interface CreateWalletEntryRecordInput {
  id?: string;
  sellerId: string;
  currency: string;
  type: WalletEntryType;
  amount: string;
  balanceBucket: WalletBalanceBucket;
  sourceType: string;
  sourceId: string;
  sourceKey: string;
  occurredAt: Date;
}

/** Provider-validated payout destination fields safe for marketplace persistence. */
export interface CreatePayoutAccountRecordInput {
  id?: string;
  sellerId: string;
  providerType: string;
  maskedDetails: string;
  providerAccountRef: string;
  status: PayoutAccountStatus;
  verifiedAt: Date | null;
}

/** Payout fields already validated by the Module 17 service before insertion. */
export interface CreatePayoutRecordInput {
  id?: string;
  payoutNo: string;
  sellerId: string;
  amount: string;
  currency: string;
  accountId: string;
  status: PayoutStatus;
  requestedAt?: Date;
  processedAt?: Date | null;
  providerRef?: string | null;
}

/** Service-approved Payout lifecycle fields; transition decisions do not belong in the repository. */
export interface UpdatePayoutRecordInput {
  status: PayoutStatus;
  processedAt?: Date | null;
  providerRef?: string | null;
}

/** One service-calculated allocation from an available earning entry into an approved Payout. */
export interface CreatePayoutAllocationRecordInput {
  walletEntryId: string;
  amount: string;
}

/** Existing allocation usage returned with Payout status so the service can decide which reservations still count. */
export interface WalletEntryAllocationUsageRow {
  walletEntryId: string;
  payoutId: string;
  payoutStatus: string;
  amount: string;
}

/** Combines only present SQL predicates so optional validated filters remain readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length === 0 ? undefined : and(...active);
}

/** Builds deterministic Wallet ledger ordering from the single allow-listed sort field. */
function walletEntrySort(query: Pick<SellerWalletQuery, "order">): SQL[] {
  const direction = query.order === "asc" ? asc : desc;
  return [direction(sellerWalletEntries.occurredAt), asc(sellerWalletEntries.id)];
}

/** Builds deterministic Payout ordering from validated allow-listed query fields. */
function payoutSort(query: Pick<SellerPayoutListQuery, "sort" | "order">): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "payoutNo":
      return [direction(payouts.payoutNo), asc(payouts.id)];
    case "requestedAt":
    default:
      return [direction(payouts.requestedAt), asc(payouts.id)];
  }
}

/** Returns unique IDs in stable order before using them in allocation lookups. */
function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/**
 * Drizzle-only persistence boundary for Module 17 Seller Wallet & Payouts.
 * Commission math, delivery/hold eligibility, payout transitions, provider calls, audit, outbox, and idempotency stay in services.
 */
export class SellerWalletPayoutsRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): SellerWalletPayoutsRepository {
    return new SellerWalletPayoutsRepository(executor);
  }

  /** Creates the seller/currency Wallet snapshot when it does not exist without changing an existing balance. */
  async ensureWallet(sellerId: string, currency: string): Promise<SellerWalletRow | null> {
    const [row] = await this.executor
      .insert(sellerWallets)
      .values({ sellerId, currency })
      .onConflictDoNothing({ target: [sellerWallets.sellerId, sellerWallets.currency] })
      .returning();

    return row ?? null;
  }

  /** Locks one seller/currency Wallet so all balance-bucket transitions serialize in the caller transaction. */
  async lockWallet(sellerId: string, currency: string): Promise<SellerWalletRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellerWallets)
      .where(and(eq(sellerWallets.sellerId, sellerId), eq(sellerWallets.currency, currency)))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Lists only Wallet snapshots owned by the authenticated seller, optionally narrowed to one currency. */
  async listSellerWallets(sellerId: string, currency?: string): Promise<SellerWalletRow[]> {
    return this.executor
      .select()
      .from(sellerWallets)
      .where(
        combineConditions([
          eq(sellerWallets.sellerId, sellerId),
          currency ? eq(sellerWallets.currency, currency) : undefined,
        ]),
      )
      .orderBy(asc(sellerWallets.currency));
  }

  /** Persists the complete service-approved Wallet snapshot after immutable ledger rows are written. */
  async updateWalletSnapshot(
    sellerId: string,
    currency: string,
    input: UpdateWalletSnapshotRecordInput,
  ): Promise<SellerWalletRow | null> {
    const [row] = await this.executor
      .update(sellerWallets)
      .set({
        pendingBalance: input.pendingBalance,
        availableBalance: input.availableBalance,
        heldBalance: input.heldBalance,
        negativeBalance: input.negativeBalance,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(and(eq(sellerWallets.sellerId, sellerId), eq(sellerWallets.currency, currency)))
      .returning();

    return row ?? null;
  }

  /** Reads one immutable Wallet ledger row by its globally unique deterministic source key. */
  async findWalletEntryBySourceKey(sourceKey: string): Promise<SellerWalletEntryRow | null> {
    const [row] = await this.executor
      .select()
      .from(sellerWalletEntries)
      .where(eq(sellerWalletEntries.sourceKey, sourceKey))
      .limit(1);

    return row ?? null;
  }

  /** Appends one immutable Wallet ledger row and returns null when the exact source key is already persisted. */
  async createWalletEntryIfMissing(
    input: CreateWalletEntryRecordInput,
  ): Promise<SellerWalletEntryRow | null> {
    const values: NewSellerWalletEntryRow = input;
    const [row] = await this.executor
      .insert(sellerWalletEntries)
      .values(values)
      .onConflictDoNothing({ target: sellerWalletEntries.sourceKey })
      .returning();

    return row ?? null;
  }

  /** Lists one bounded page of immutable Wallet entries inside a single seller scope. */
  async listSellerWalletEntries(
    sellerId: string,
    query: SellerWalletQuery,
  ): Promise<PaginatedWalletEntryRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(sellerWalletEntries.sellerId, sellerId),
      query.currency ? eq(sellerWalletEntries.currency, query.currency) : undefined,
      query.entryType ? eq(sellerWalletEntries.type, query.entryType) : undefined,
      query.balanceBucket
        ? eq(sellerWalletEntries.balanceBucket, query.balanceBucket)
        : undefined,
      query.from ? gte(sellerWalletEntries.occurredAt, new Date(query.from)) : undefined,
      query.to ? lte(sellerWalletEntries.occurredAt, new Date(query.to)) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(sellerWalletEntries)
      .where(where)
      .orderBy(...walletEntrySort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(sellerWalletEntries)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Returns a bounded deterministic batch of positive pending Commission-credit entries for settlement revalidation. */
  async listPendingSettlementCandidates(limit: number): Promise<SellerWalletEntryRow[]> {
    return this.executor
      .select()
      .from(sellerWalletEntries)
      .where(
        and(
          eq(sellerWalletEntries.type, WALLET_ENTRY_TYPE.COMMISSION_CREDIT),
          eq(sellerWalletEntries.balanceBucket, WALLET_BALANCE_BUCKET.PENDING),
          sql`${sellerWalletEntries.amount} > 0`,
          sql`not exists (
            select 1
              from seller_wallet_entries settled_entry
             where settled_entry.source_key =
                   'settle:' || ${sellerWalletEntries.id}::text || ':pending-debit'
          )`,
        ),
      )
      .orderBy(asc(sellerWalletEntries.occurredAt), asc(sellerWalletEntries.id))
      .limit(limit);
  }

  /** Lists safe payout-account rows for one seller; provider references stay internal to the repository/service layer. */
  async listPayoutAccountsForSeller(sellerId: string): Promise<PayoutAccountRow[]> {
    return this.executor
      .select()
      .from(payoutAccounts)
      .where(eq(payoutAccounts.sellerId, sellerId))
      .orderBy(asc(payoutAccounts.providerType), asc(payoutAccounts.id));
  }

  /** Reads one payout account only when it belongs to the supplied seller scope. */
  async findPayoutAccountInSellerScope(
    accountId: string,
    sellerId: string,
  ): Promise<PayoutAccountRow | null> {
    const [row] = await this.executor
      .select()
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.id, accountId), eq(payoutAccounts.sellerId, sellerId)))
      .limit(1);

    return row ?? null;
  }

  /** Serializes same seller/provider/reference account creation so retries cannot race duplicate token rows. */
  async lockPayoutAccountReference(
    sellerId: string,
    providerType: string,
    providerAccountRef: string,
  ): Promise<void> {
    const lockKey = `payout-account:${sellerId}:${providerType}:${providerAccountRef}`;
    await this.executor.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
  }

  /** Finds an existing tokenized payout destination so service retries can avoid duplicate account rows. */
  async findPayoutAccountByProviderReference(
    sellerId: string,
    providerType: string,
    providerAccountRef: string,
  ): Promise<PayoutAccountRow | null> {
    const [row] = await this.executor
      .select()
      .from(payoutAccounts)
      .where(
        and(
          eq(payoutAccounts.sellerId, sellerId),
          eq(payoutAccounts.providerType, providerType),
          eq(payoutAccounts.providerAccountRef, providerAccountRef),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Inserts one provider-validated tokenized payout destination after the service accepts the adapter result. */
  async createPayoutAccount(
    input: CreatePayoutAccountRecordInput,
  ): Promise<PayoutAccountRow> {
    const values: NewPayoutAccountRow = input;
    const [row] = await this.executor.insert(payoutAccounts).values(values).returning();

    if (!row) {
      throw new Error("Payout account insert completed without returning a row.");
    }

    return row;
  }

  /** Lists one seller's Payout history with bounded validated filters. */
  async listSellerPayouts(
    sellerId: string,
    query: SellerPayoutListQuery,
  ): Promise<PaginatedPayoutRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(payouts.sellerId, sellerId),
      query.status ? eq(payouts.status, query.status) : undefined,
      query.currency ? eq(payouts.currency, query.currency) : undefined,
      query.from ? gte(payouts.requestedAt, new Date(query.from)) : undefined,
      query.to ? lte(payouts.requestedAt, new Date(query.to)) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(payouts)
      .where(where)
      .orderBy(...payoutSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(payouts)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Lists the privileged finance Payout queue with only validated admin filters. */
  async listAdminPayouts(query: AdminPayoutListQuery): Promise<PaginatedPayoutRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.sellerId ? eq(payouts.sellerId, query.sellerId) : undefined,
      query.status ? eq(payouts.status, query.status) : undefined,
      query.currency ? eq(payouts.currency, query.currency) : undefined,
      query.from ? gte(payouts.requestedAt, new Date(query.from)) : undefined,
      query.to ? lte(payouts.requestedAt, new Date(query.to)) : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(payouts)
      .where(where)
      .orderBy(...payoutSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(payouts)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Locks one Payout row so approval/send lifecycle decisions serialize in the caller transaction. */
  async lockPayoutById(payoutId: string): Promise<PayoutRow | null> {
    const [row] = await this.executor
      .select()
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Inserts one service-approved Payout request without reserving Wallet money in the repository. */
  async createPayout(input: CreatePayoutRecordInput): Promise<PayoutRow> {
    const values: NewPayoutRow = input;
    const [row] = await this.executor.insert(payouts).values(values).returning();

    if (!row) {
      throw new Error("Payout insert completed without returning a row.");
    }

    return row;
  }

  /** Persists only lifecycle fields already approved by the service state machine. */
  async updatePayout(
    payoutId: string,
    input: UpdatePayoutRecordInput,
  ): Promise<PayoutRow | null> {
    const [row] = await this.executor
      .update(payouts)
      .set(input)
      .where(eq(payouts.id, payoutId))
      .returning();

    return row ?? null;
  }

  /** Inserts service-calculated Payout allocations and returns the immutable allocation rows. */
  async createPayoutAllocations(
    payoutId: string,
    allocations: CreatePayoutAllocationRecordInput[],
  ): Promise<PayoutAllocationRow[]> {
    if (allocations.length === 0) return [];

    const values: NewPayoutAllocationRow[] = allocations.map((allocation) => ({
      payoutId,
      walletEntryId: allocation.walletEntryId,
      amount: allocation.amount,
    }));

    return this.executor.insert(payoutAllocations).values(values).returning();
  }

  /** Lists allocations for one Payout in stable Wallet-entry order. */
  async listPayoutAllocations(payoutId: string): Promise<PayoutAllocationRow[]> {
    return this.executor
      .select()
      .from(payoutAllocations)
      .where(eq(payoutAllocations.payoutId, payoutId))
      .orderBy(asc(payoutAllocations.walletEntryId));
  }

  /** Lists allocations for a page of Payouts so response composition does not require one query per row. */
  async listPayoutAllocationsByPayoutIds(
    payoutIds: string[],
  ): Promise<PayoutAllocationRow[]> {
    const ids = uniqueSortedIds(payoutIds);
    if (ids.length === 0) return [];

    return this.executor
      .select()
      .from(payoutAllocations)
      .where(inArray(payoutAllocations.payoutId, ids))
      .orderBy(asc(payoutAllocations.payoutId), asc(payoutAllocations.walletEntryId));
  }

  /** Returns positive available settlement-credit entries in deterministic FIFO order for service-side allocation. */
  async listAvailableAllocationSourceEntries(
    sellerId: string,
    currency: string,
  ): Promise<SellerWalletEntryRow[]> {
    return this.executor
      .select()
      .from(sellerWalletEntries)
      .where(
        and(
          eq(sellerWalletEntries.sellerId, sellerId),
          eq(sellerWalletEntries.currency, currency),
          eq(sellerWalletEntries.type, WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER),
          eq(sellerWalletEntries.balanceBucket, WALLET_BALANCE_BUCKET.AVAILABLE),
          sql`${sellerWalletEntries.amount} > 0`,
        ),
      )
      .orderBy(asc(sellerWalletEntries.occurredAt), asc(sellerWalletEntries.id));
  }

  /** Returns historical allocation usage plus Payout status so the service can decide which reservations consume a source. */
  async listAllocationUsageForWalletEntries(
    walletEntryIds: string[],
  ): Promise<WalletEntryAllocationUsageRow[]> {
    const ids = uniqueSortedIds(walletEntryIds);
    if (ids.length === 0) return [];

    return this.executor
      .select({
        walletEntryId: payoutAllocations.walletEntryId,
        payoutId: payoutAllocations.payoutId,
        payoutStatus: payouts.status,
        amount: payoutAllocations.amount,
      })
      .from(payoutAllocations)
      .innerJoin(payouts, eq(payouts.id, payoutAllocations.payoutId))
      .where(inArray(payoutAllocations.walletEntryId, ids))
      .orderBy(
        asc(payoutAllocations.walletEntryId),
        asc(payouts.requestedAt),
        asc(payoutAllocations.payoutId),
      );
  }
}

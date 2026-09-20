import { randomUUID } from "node:crypto";
import type { PermissionCode } from "../../src/common/security/security.contract.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import { databasePool } from "../../src/database/db.js";
import type {
  PayoutProviderAdapter,
  ProviderPayoutResult,
  SendProviderPayoutInput,
  ValidatedPayoutAccountReference,
} from "../../src/integrations/payouts/payout-provider.contract.js";
import {
  WALLET_PAYOUT_PERMISSION,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import { SellerWalletPayoutsService } from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.service.js";
import {
  prepareDeliveredReturnFixture,
  resetModule14Tables,
  type DeliveredReturnFixture,
} from "../module14/module14.test-helpers.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Clears Module 17 persistence before rebuilding the released prerequisite test graph and RBAC seed. */
export async function resetModule17Tables(): Promise<void> {
  await databasePool.query(`
    TRUNCATE TABLE
      payout_allocations,
      payouts,
      payout_accounts,
      seller_wallet_entries,
      seller_wallets
    RESTART IDENTITY CASCADE
  `);
  await resetModule14Tables();
}

/** Creates the single-seller request context expected by seller Wallet/Payout service methods. */
export function sellerWalletContext(input: {
  actorId: string;
  sellerId: string;
  permissions?: PermissionCode[];
}): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: input.actorId,
    actorType: ACTOR_TYPE.SELLER,
    permissions: new Set(),
    sellerIds: new Set([input.sellerId]),
    storeIds: new Set(),
    sellerPermissions: new Map([
      [
        input.sellerId,
        new Set(
          input.permissions ?? [
            WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ,
            WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST,
            WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE,
          ],
        ),
      ],
    ]),
    sessionId: randomUUID(),
  };
}

/** Creates a finance/admin request context with the exact Module 17 read/manage permissions. */
export function adminWalletContext(
  actorId: string,
  permissions: PermissionCode[] = [
    WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ,
    WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE,
  ],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.PLATFORM_ADMIN,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Creates the trusted system identity required by source-application, settlement, and adjustment commands. */
export function systemWalletContext(): RequestContext {
  return {
    requestId: randomUUID(),
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Deterministic provider double that validates tokenized accounts and can replay paid/failed/unknown send outcomes. */
export class WalletPayoutProvider implements PayoutProviderAdapter {
  readonly accountValidationCalls: Array<{ providerType: string; providerAccountRef: string }> = [];
  readonly sendCalls: SendProviderPayoutInput[] = [];
  private readonly queuedResults: ProviderPayoutResult[] = [];
  failAccountValidation = false;

  /** Queues one provider result consumed by the next payout send call. */
  queueResult(result: ProviderPayoutResult): void {
    this.queuedResults.push(result);
  }

  /** Validates one already-tokenized reference and derives safe masked display text. */
  async validateAccountReference(
    providerType: string,
    providerAccountRef: string,
  ): Promise<ValidatedPayoutAccountReference> {
    this.accountValidationCalls.push({ providerType, providerAccountRef });
    if (this.failAccountValidation) throw new Error("Module 17 test account validation failed.");
    return {
      providerType,
      providerAccountRef,
      maskedDetails: `****${providerAccountRef.slice(-4)}`,
    };
  }

  /** Returns the next deterministic provider result while preserving the stable provider idempotency key for assertions. */
  async sendPayout(input: SendProviderPayoutInput): Promise<ProviderPayoutResult> {
    this.sendCalls.push(input);
    return (
      this.queuedResults.shift() ?? {
        status: "paid",
        providerRef: `provider_${input.payoutId}`,
        processedAt: new Date(Date.now() + 32 * DAY_MS),
      }
    );
  }
}

/** Returns one Module 17 service using real database/prerequisite services plus deterministic provider and future clock. */
export function createIntegrationWalletService(
  provider = new WalletPayoutProvider(),
  options: { now?: Date; returnWindowDays?: number } = {},
): { service: SellerWalletPayoutsService; provider: WalletPayoutProvider } {
  const futureNow = options.now ?? new Date(Date.now() + 31 * DAY_MS);
  return {
    service: new SellerWalletPayoutsService({
      provider,
      now: () => new Date(futureNow),
      administration: {
        /** Keeps integration settlement deterministic while retaining the production delivery service boundary. */
        async getReturnWindowDays() {
          return options.returnWindowDays ?? 30;
        },
      },
    }),
    provider,
  };
}

/** Delivered prerequisite fixture plus the immutable original Commission sale source needed by Module 17. */
export interface WalletEarningsFixture extends DeliveredReturnFixture {
  saleCommissionEntryId: string;
  saleSellerNetAmount: string;
  currency: string;
}

/** Creates a real captured/delivered/commissioned Order and resolves its persisted Commission sale source. */
export async function prepareWalletEarningsFixture(quantity = 2): Promise<WalletEarningsFixture> {
  const fixture = await prepareDeliveredReturnFixture(quantity);
  const result = await databasePool.query<{
    id: string;
    seller_net_amount: string;
    currency: string;
  }>(
    `select id, seller_net_amount::text, currency
       from commission_entries
      where order_item_id = $1 and type = 'sale'
      order by occurred_at, id
      limit 1`,
    [fixture.orderItemId],
  );
  const sale = result.rows[0];
  if (!sale) throw new Error("Module 17 fixture could not resolve its Commission sale source.");
  return {
    ...fixture,
    saleCommissionEntryId: sale.id,
    saleSellerNetAmount: sale.seller_net_amount,
    currency: sale.currency,
  };
}

/** Creates one active tokenized payout account through the real Module 17 service/provider boundary. */
export async function createWalletPayoutAccount(
  service: SellerWalletPayoutsService,
  fixture: WalletEarningsFixture,
) {
  return service.createPayoutAccount(
    sellerWalletContext({ actorId: fixture.sellerUserId, sellerId: fixture.sellerId }),
    {
      providerType: "testbank",
      providerAccountRef: `acct_${randomUUID().replaceAll("-", "")}`,
    },
  );
}

/** Applies the persisted Commission sale and settles it after the deterministic hold window. */
export async function creditAndSettleWallet(
  service: SellerWalletPayoutsService,
  fixture: WalletEarningsFixture,
): Promise<void> {
  await service.applyCommissionSource(systemWalletContext(), fixture.saleCommissionEntryId);
  await service.settleWallet(
    systemWalletContext(),
    { limit: 100 },
    `module17-settle-${randomUUID()}`,
  );
}

/** Reads one seller/currency Wallet snapshot with exact database money strings. */
export async function readWallet(sellerId: string, currency: string) {
  const result = await databasePool.query<{
    seller_id: string;
    currency: string;
    pending_balance: string;
    available_balance: string;
    held_balance: string;
    negative_balance: string;
  }>(
    `select seller_id, currency,
            pending_balance::text, available_balance::text,
            held_balance::text, negative_balance::text
       from seller_wallets
      where seller_id = $1 and currency = $2`,
    [sellerId, currency],
  );
  return result.rows[0] ?? null;
}

/** Reads immutable Wallet entries for reconciliation in deterministic occurrence/source-key order. */
export async function readWalletEntries(sellerId: string, currency: string) {
  const result = await databasePool.query<{
    id: string;
    type: string;
    amount: string;
    balance_bucket: string;
    source_type: string;
    source_id: string;
    source_key: string;
  }>(
    `select id, type, amount::text, balance_bucket, source_type, source_id, source_key
       from seller_wallet_entries
      where seller_id = $1 and currency = $2
      order by occurred_at, id`,
    [sellerId, currency],
  );
  return result.rows;
}

/** Reads one persisted Payout for lifecycle/balance reconciliation. */
export async function readPayout(payoutId: string) {
  const result = await databasePool.query<{
    id: string;
    seller_id: string;
    amount: string;
    currency: string;
    status: string;
    provider_ref: string | null;
  }>(
    `select id, seller_id, amount::text, currency, status, provider_ref
       from payouts
      where id = $1`,
    [payoutId],
  );
  return result.rows[0] ?? null;
}

/** Reads immutable source allocations for one approved Payout. */
export async function readPayoutAllocations(payoutId: string) {
  const result = await databasePool.query<{ wallet_entry_id: string; amount: string }>(
    `select wallet_entry_id, amount::text
       from payout_allocations
      where payout_id = $1
      order by wallet_entry_id`,
    [payoutId],
  );
  return result.rows;
}

/** Returns the newest persisted Commission refund/adjustment entry for one Order Item. */
export async function readLatestNegativeCommissionSource(orderItemId: string) {
  const result = await databasePool.query<{
    id: string;
    type: string;
    seller_net_amount: string;
  }>(
    `select id, type, seller_net_amount::text
       from commission_entries
      where order_item_id = $1
        and type in ('refund', 'adjustment')
        and seller_net_amount < 0
      order by occurred_at desc, id desc
      limit 1`,
    [orderItemId],
  );
  return result.rows[0] ?? null;
}

/** Counts Module 17 audit evidence for one sensitive financial action/resource. */
export async function countWalletAuditEvents(action: string, resourceId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from audit_logs
      where action = $1 and resource_id = $2`,
    [action, resourceId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts durable Module 17 outbox events by event and aggregate identity. */
export async function countWalletOutboxEvents(eventType: string, aggregateId: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from outbox_events
      where event_type = $1 and aggregate_id = $2`,
    [eventType, aggregateId],
  );
  return result.rows[0]?.count ?? 0;
}

/** Counts persisted Foundation idempotency records for one exact key across Module 17 money commands. */
export async function countIdempotencyRecords(key: string): Promise<number> {
  const result = await databasePool.query<{ count: number }>(
    `select count(*)::int as count
       from idempotency_keys
      where key = $1`,
    [key],
  );
  return result.rows[0]?.count ?? 0;
}

import { createHash, randomUUID } from "node:crypto";
import type { AppendAuditEventInput } from "../../common/audit/audit.repository.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  IdempotencyService,
  type BeginIdempotentOperationResult,
} from "../../common/idempotency/idempotency.service.js";
import type { EnqueueOutboxEventInput } from "../../common/outbox/outbox.repository.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type {
  PayoutAccountRow,
  PayoutAllocationRow,
  PayoutRow,
  SellerWalletEntryRow,
  SellerWalletRow,
} from "../../database/schema/seller-wallet-payouts.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import type {
  PayoutProviderAdapter,
  ProviderPayoutResult,
  ValidatedPayoutAccountReference,
} from "../../integrations/payouts/payout-provider.contract.js";
import { UnconfiguredPayoutProviderAdapter } from "../../integrations/payouts/payout-provider.contract.js";
import { AdministrationService } from "../administration/administration.service.js";
import {
  COMMISSION_ENTRY_TYPE,
} from "../commissions/commissions.constants.js";
import {
  CommissionsService,
  type CommissionWalletEntrySnapshot,
} from "../commissions/commissions.service.js";
import { SellersService } from "../sellers/sellers.service.js";
import {
  ShippingService,
  type WalletDeliverySnapshot,
} from "../shipping/shipping.service.js";
import {
  PAYOUT_ACCOUNT_STATUS,
  PAYOUT_PROVIDER_RESULT,
  PAYOUT_STATUS,
  WALLET_BALANCE_BUCKET,
  WALLET_ENTRY_TYPE,
  WALLET_PAYOUT_AUDIT_ACTION,
  WALLET_PAYOUT_ERROR_CODE,
  WALLET_PAYOUT_IDEMPOTENCY_SCOPE,
  WALLET_PAYOUT_LIMITS,
  WALLET_PAYOUT_OUTBOX_EVENT,
  WALLET_PAYOUT_PERMISSION,
  WALLET_PAYOUT_RESOURCE_TYPE,
} from "./seller-wallet-payouts.constants.js";
import {
  WALLET_PAYOUT_SOURCE_EVENT_VALUES,
  type WalletPayoutSourceEventJobData,
  type WalletSettlementJobData,
} from "./seller-wallet-payouts.jobs.js";
import {
  SellerWalletPayoutsRepository,
  type CreatePayoutAllocationRecordInput,
  type CreateWalletEntryRecordInput,
} from "./seller-wallet-payouts.repository.js";
import {
  adjustWalletResultSchema,
  payoutResponseSchema,
  sellerWalletResponseSchema,
  settleWalletResultSchema,
  type AdjustWalletInput,
  type AdjustWalletResult,
  type AdminPayoutListQuery,
  type CreatePayoutAccountInput,
  type PayoutAccountResponse,
  type PayoutResponse,
  type RequestPayoutInput,
  type SellerPayoutListQuery,
  type SellerWalletBalanceResponse,
  type SellerWalletQuery,
  type SellerWalletResponse,
  type SettleWalletInput,
  type SettleWalletResult,
} from "./seller-wallet-payouts.schema.js";

/** Runs one Wallet/Payout transaction and allows focused service tests to replace the real database boundary. */
export type WalletPayoutTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Narrow Commission boundary used to verify immutable Wallet financial sources. */
export interface WalletPayoutCommissionsIntegration {
  /** Returns one persisted Commission ledger row and its parent Order identity. */
  getWalletEntrySnapshot(
    context: RequestContext,
    commissionEntryId: string,
  ): Promise<CommissionWalletEntrySnapshot>;
}

/** Narrow Shipping boundary used only for pending-to-available settlement eligibility. */
export interface WalletPayoutShippingIntegration {
  /** Returns authoritative commercial/delivery facts for one Commission sale Order Item. */
  getWalletDeliverySnapshot(
    context: RequestContext,
    input: {
      orderId: string;
      sellerId: string;
      sellerOrderId: string;
      orderItemId: string;
    },
  ): Promise<WalletDeliverySnapshot | null>;
}

/** Narrow Administration boundary that owns the Return window reused as the core Wallet hold period. */
export interface WalletPayoutAdministrationIntegration {
  /** Returns the configured Return/hold window in whole days. */
  getReturnWindowDays(): Promise<number>;
}

/** Narrow Seller boundary used before seller payout-account and Payout commands. */
export interface WalletPayoutSellersIntegration {
  /** Confirms the seller currently exists and is eligible for commerce-sensitive payout actions. */
  assertSellerCommerceEligible(sellerId: string): Promise<void>;
}

/** Foundation idempotency boundary used by retryable money-moving Module 17 commands. */
export interface WalletPayoutIdempotencyIntegration {
  /** Acquires a fresh key, replays a completed result, or rejects unsafe reuse. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores one successful or provider-terminal response for exact replay. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Releases one failed/inconclusive command so a later retry can safely re-drive it. */
  fail(recordId: string): Promise<void>;
}

/** Transaction-aware audit boundary for payout-account, payout, settlement, and adjustment evidence. */
export interface WalletPayoutAuditIntegration {
  /** Appends one immutable redacted audit event. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Transaction-aware outbox boundary for the Module 17 domain events required by the guide. */
export interface WalletPayoutOutboxIntegration {
  /** Appends one durable event inside the current database transaction. */
  enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit dependencies keep Wallet/Payout business logic readable and independently testable. */
export interface SellerWalletPayoutsServiceDependencies {
  repository?: SellerWalletPayoutsRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => SellerWalletPayoutsRepository;
  transactionRunner?: WalletPayoutTransactionRunner;
  commissions?: WalletPayoutCommissionsIntegration;
  shipping?: WalletPayoutShippingIntegration;
  administration?: WalletPayoutAdministrationIntegration;
  sellers?: WalletPayoutSellersIntegration;
  provider?: PayoutProviderAdapter;
  idempotency?: WalletPayoutIdempotencyIntegration;
  idempotencyUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => WalletPayoutIdempotencyIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => WalletPayoutAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => WalletPayoutOutboxIntegration;
  now?: () => Date;
  createId?: () => string;
}

/** Seller Wallet payload plus the standard pagination metadata for its immutable ledger page. */
export interface SellerWalletResult {
  wallet: SellerWalletResponse;
  meta: PaginationMeta;
}

/** Bounded seller/admin Payout page with standard API pagination metadata. */
export interface PaginatedPayoutsResult {
  items: PayoutResponse[];
  meta: PaginationMeta;
}

/** Internal Commission source-application result used by the future source-event worker. */
export interface WalletCommissionApplyResult {
  commissionEntryId: string;
  applied: boolean;
  wallet: SellerWalletBalanceResponse;
}

/** Small exact-money snapshot kept as integers while business arithmetic runs. */
interface WalletAmounts {
  pending: bigint;
  available: bigint;
  held: bigint;
  negative: bigint;
}

/** Source-type labels keep the immutable ledger readable without exposing deterministic source keys to clients. */
const WALLET_SOURCE_TYPE = {
  COMMISSION: "commission",
  SETTLEMENT: "settlement",
  PAYOUT: "payout",
} as const;

/** Exact scale used by every Module 17 money calculation. */
const MONEY_FACTOR = 10_000n;

/** Milliseconds in one whole day for the approved Return-window settlement gate. */
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Converts one canonical scale-4 money string into an exact signed integer. */
function moneyToScale4(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const amount = BigInt(whole) * MONEY_FACTOR + BigInt(`${fraction}0000`.slice(0, 4));
  return negative ? -amount : amount;
}

/** Converts one exact signed integer into canonical scale-4 money without floating-point arithmetic. */
function scale4ToMoney(value: bigint): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const whole = unsigned / MONEY_FACTOR;
  const fraction = (unsigned % MONEY_FACTOR).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Creates a stable request hash for Foundation idempotency without persisting raw request bodies. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Creates the trusted internal identity used only for cross-module system service reads. */
function systemContext(requestId: string): RequestContext {
  return {
    requestId,
    actorId: null,
    actorType: ACTOR_TYPE.SYSTEM,
    permissions: new Set(),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: null,
  };
}

/** Creates one safe Module 17 business error with a stable public code. */
function walletPayoutError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Module 17 service for immutable seller Wallet accounting, settlement gates, and Payout lifecycle orchestration. */
export class SellerWalletPayoutsService {
  private readonly repository: SellerWalletPayoutsRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => SellerWalletPayoutsRepository;
  private readonly transactionRunner: WalletPayoutTransactionRunner;
  private readonly commissions: WalletPayoutCommissionsIntegration;
  private readonly shipping: WalletPayoutShippingIntegration;
  private readonly administration: WalletPayoutAdministrationIntegration;
  private readonly sellers: WalletPayoutSellersIntegration;
  private readonly provider: PayoutProviderAdapter;
  private readonly idempotency: WalletPayoutIdempotencyIntegration;
  private readonly idempotencyUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => WalletPayoutIdempotencyIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => WalletPayoutAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => WalletPayoutOutboxIntegration;
  private readonly now: () => Date;
  private readonly createId: () => string;

  /** Stores explicit dependencies while keeping production defaults simple and provider-neutral. */
  constructor(dependencies: SellerWalletPayoutsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new SellerWalletPayoutsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ??
      ((transaction) => new SellerWalletPayoutsRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.commissions = dependencies.commissions ?? new CommissionsService();
    this.shipping = dependencies.shipping ?? new ShippingService();
    this.administration = dependencies.administration ?? new AdministrationService();
    this.sellers = dependencies.sellers ?? new SellersService();
    this.provider = dependencies.provider ?? new UnconfiguredPayoutProviderAdapter();
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.idempotencyUsingTransaction =
      dependencies.idempotencyUsingTransaction ??
      ((transaction) => IdempotencyService.using(transaction));
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  /** Returns Wallet balances, one immutable ledger page, and safe payout-account summaries for one seller scope. */
  async getSellerWallet(
    context: RequestContext,
    query: SellerWalletQuery,
  ): Promise<SellerWalletResult> {
    const sellerId = this.resolveSingleSeller(context, WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ);
    const [wallets, entries, payoutAccounts] = await Promise.all([
      this.repository.listSellerWallets(sellerId, query.currency),
      this.repository.listSellerWalletEntries(sellerId, query),
      this.repository.listPayoutAccountsForSeller(sellerId),
    ]);

    return {
      wallet: sellerWalletResponseSchema.parse({
        wallets: wallets.map((row) => this.toWalletResponse(row)),
        entries: entries.items.map((row) => this.toWalletEntryResponse(row)),
        payoutAccounts: payoutAccounts.map((row) => this.toPayoutAccountResponse(row)),
      }),
      meta: paginationMeta(query, entries.totalItems),
    };
  }

  /** Lists only Payouts owned by the single authenticated seller scope. */
  async listSellerPayouts(
    context: RequestContext,
    query: SellerPayoutListQuery,
  ): Promise<PaginatedPayoutsResult> {
    const sellerId = this.resolveSingleSeller(context, WALLET_PAYOUT_PERMISSION.SELLER_WALLET_READ);
    const result = await this.repository.listSellerPayouts(sellerId, query);
    return {
      items: await this.attachPayoutAllocations(result.items),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Adds one seller-owned tokenized payout destination only after provider validation succeeds. */
  async createPayoutAccount(
    context: RequestContext,
    input: CreatePayoutAccountInput,
  ): Promise<PayoutAccountResponse> {
    const sellerId = this.resolveSingleSeller(
      context,
      WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_ACCOUNT_MANAGE,
    );
    await this.sellers.assertSellerCommerceEligible(sellerId);
    const validated = await this.validateProviderAccount(input);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      await repository.lockPayoutAccountReference(
        sellerId,
        validated.providerType,
        validated.providerAccountRef,
      );
      const existing = await repository.findPayoutAccountByProviderReference(
        sellerId,
        validated.providerType,
        validated.providerAccountRef,
      );
      if (existing) return this.toPayoutAccountResponse(existing);

      const created = await repository.createPayoutAccount({
        sellerId,
        providerType: validated.providerType,
        providerAccountRef: validated.providerAccountRef,
        maskedDetails: validated.maskedDetails,
        status: PAYOUT_ACCOUNT_STATUS.ACTIVE,
        verifiedAt: this.now(),
      });
      const safe = this.toPayoutAccountResponse(created);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_ACCOUNT_CREATED,
        entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT_ACCOUNT,
        entityId: created.id,
        sellerId,
        requestId: context.requestId,
        after: safe,
      });
      return safe;
    });
  }

  /** Creates one retry-safe seller Payout request without reserving Wallet money before finance approval. */
  async requestPayout(
    context: RequestContext,
    input: RequestPayoutInput,
    idempotencyKey: string,
  ): Promise<PayoutResponse> {
    const actorId = this.requireActor(context);
    const sellerId = this.resolveSingleSeller(context, WALLET_PAYOUT_PERMISSION.SELLER_PAYOUT_REQUEST);
    await this.sellers.assertSellerCommerceEligible(sellerId);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: `${WALLET_PAYOUT_IDEMPOTENCY_SCOPE.PAYOUT_REQUEST}:${actorId}`,
        key: normalizedKey,
        requestHash: sha256(
          `module17-payout-request-v1|${sellerId}|${input.accountId}|${input.amount}|${input.currency}`,
        ),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return payoutResponseSchema.parse(idempotency.replay.responseBody);
    }

    try {
      return await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const account = await repository.findPayoutAccountInSellerScope(input.accountId, sellerId);
        this.assertPayoutAccountUsable(account);
        const wallet = await repository.lockWallet(sellerId, input.currency);
        if (!wallet || moneyToScale4(wallet.availableBalance) < moneyToScale4(input.amount)) {
          throw this.insufficientBalance();
        }

        const payoutId = this.createId();
        const payout = await repository.createPayout({
          id: payoutId,
          payoutNo: this.payoutNumber(payoutId),
          sellerId,
          amount: input.amount,
          currency: input.currency,
          accountId: input.accountId,
          status: PAYOUT_STATUS.REQUESTED,
          requestedAt: this.now(),
          processedAt: null,
          providerRef: null,
        });
        const response = this.toPayoutResponse(payout, []);
        await this.auditUsingTransaction(transaction).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_REQUESTED,
          entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
          entityId: payout.id,
          sellerId,
          requestId: context.requestId,
          after: response,
        });
        await this.outboxUsingTransaction(transaction).enqueue({
          eventType: WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_REQUESTED,
          aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
          aggregateId: payout.id,
          payload: response,
        });
        await this.idempotencyUsingTransaction(transaction).complete(
          idempotency.recordId,
          201,
          response,
        );
        return response;
      });
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Lists the finance Payout queue for an authorized platform actor. */
  async listAdminPayouts(
    context: RequestContext,
    query: AdminPayoutListQuery,
  ): Promise<PaginatedPayoutsResult> {
    this.requireActor(context);
    assertPermission(context, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_READ);
    const result = await this.repository.listAdminPayouts(query);
    return {
      items: await this.attachPayoutAllocations(result.items),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Atomically reserves available Wallet money and FIFO source allocations for one finance-approved Payout. */
  async approvePayout(
    context: RequestContext,
    payoutId: string,
    idempotencyKey: string,
  ): Promise<PayoutResponse> {
    const actorId = this.requireActor(context);
    assertPermission(context, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: `${WALLET_PAYOUT_IDEMPOTENCY_SCOPE.PAYOUT_APPROVE}:${actorId}`,
        key: normalizedKey,
        requestHash: sha256(`module17-payout-approve-v1|${payoutId}`),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return payoutResponseSchema.parse(idempotency.replay.responseBody);
    }

    try {
      return await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const payout = await repository.lockPayoutById(payoutId);
        if (!payout) throw this.payoutStatusInvalid("Payout is unavailable for approval.", 404);
        if (payout.status !== PAYOUT_STATUS.REQUESTED) throw this.payoutStatusInvalid();
        await this.sellers.assertSellerCommerceEligible(payout.sellerId);
        const account = await repository.findPayoutAccountInSellerScope(
          payout.accountId,
          payout.sellerId,
        );
        this.assertPayoutAccountUsable(account);
        const wallet = await repository.lockWallet(payout.sellerId, payout.currency);
        if (!wallet || moneyToScale4(wallet.availableBalance) < moneyToScale4(payout.amount)) {
          throw this.insufficientBalance();
        }

        const allocations = await this.buildPayoutAllocations(repository, payout);
        const amount = moneyToScale4(payout.amount);
        const walletAmounts = this.walletAmounts(wallet);
        const reservedAt = this.now();
        walletAmounts.available -= amount;
        walletAmounts.held += amount;
        this.assertWalletAmounts(walletAmounts);
        await this.appendWalletEntry(repository, {
          sellerId: payout.sellerId,
          currency: payout.currency,
          type: WALLET_ENTRY_TYPE.PAYOUT_RESERVE,
          amount: scale4ToMoney(-amount),
          balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
          sourceType: WALLET_SOURCE_TYPE.PAYOUT,
          sourceId: payout.id,
          sourceKey: `payout:${payout.id}:reserve:available-debit`,
          occurredAt: reservedAt,
        });
        await this.appendWalletEntry(repository, {
          sellerId: payout.sellerId,
          currency: payout.currency,
          type: WALLET_ENTRY_TYPE.PAYOUT_RESERVE,
          amount: payout.amount,
          balanceBucket: WALLET_BALANCE_BUCKET.HELD,
          sourceType: WALLET_SOURCE_TYPE.PAYOUT,
          sourceId: payout.id,
          sourceKey: `payout:${payout.id}:reserve:held-credit`,
          occurredAt: reservedAt,
        });
        const updatedWallet = await this.persistWalletAmounts(repository, wallet, walletAmounts);
        await repository.createPayoutAllocations(payout.id, allocations);
        const approved = await repository.updatePayout(payout.id, {
          status: PAYOUT_STATUS.APPROVED,
          processedAt: null,
          providerRef: null,
        });
        if (!approved) throw this.payoutStatusInvalid("Payout approval could not be persisted.", 500);
        const allocationRows = await repository.listPayoutAllocations(payout.id);
        const response = this.toPayoutResponse(approved, allocationRows);
        await this.auditUsingTransaction(transaction).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_APPROVED,
          entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
          entityId: payout.id,
          sellerId: payout.sellerId,
          requestId: context.requestId,
          before: { status: payout.status },
          after: { status: approved.status, wallet: this.toWalletResponse(updatedWallet) },
        });
        await this.idempotencyUsingTransaction(transaction).complete(
          idempotency.recordId,
          200,
          response,
        );
        return response;
      });
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Executes or reconciles one approved/processing Payout through the provider without unsafe automatic release on uncertainty. */
  async sendPayout(
    context: RequestContext,
    payoutId: string,
    idempotencyKey: string,
  ): Promise<PayoutResponse> {
    const actorId = this.requireActor(context);
    assertPermission(context, WALLET_PAYOUT_PERMISSION.ADMIN_PAYOUTS_MANAGE);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: `${WALLET_PAYOUT_IDEMPOTENCY_SCOPE.PAYOUT_SEND}:${actorId}`,
        key: normalizedKey,
        requestHash: sha256(`module17-payout-send-v1|${payoutId}`),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return this.resolveSendReplay(idempotency.replay.statusCode, idempotency.replay.responseBody);
    }

    let completed = false;
    try {
      const prepared = await this.preparePayoutSend(context, payoutId);
      let providerResult: ProviderPayoutResult;
      try {
        providerResult = await this.provider.sendPayout({
          payoutId: prepared.payout.id,
          sellerId: prepared.payout.sellerId,
          amount: prepared.payout.amount,
          currency: prepared.payout.currency,
          providerAccountRef: prepared.account.providerAccountRef,
          providerIdempotencyKey: `payout:${prepared.payout.id}:send`,
        });
      } catch {
        providerResult = { status: PAYOUT_PROVIDER_RESULT.UNKNOWN };
      }

      if (providerResult.status === PAYOUT_PROVIDER_RESULT.UNKNOWN) {
        throw walletPayoutError(
          WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
          "Payout provider result is not yet authoritative; the reservation remains held.",
          502,
        );
      }

      if (
        providerResult.status === PAYOUT_PROVIDER_RESULT.PAID &&
        !this.isUsablePaidProviderResult(providerResult)
      ) {
        throw walletPayoutError(
          WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
          "Payout provider returned an invalid paid result; the reservation remains held.",
          502,
        );
      }
      if (
        providerResult.status === PAYOUT_PROVIDER_RESULT.FAILED &&
        !this.isUsableProviderTimestamp(providerResult.processedAt)
      ) {
        throw walletPayoutError(
          WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
          "Payout provider returned an invalid failure result; the reservation remains held.",
          502,
        );
      }

      if (providerResult.status === PAYOUT_PROVIDER_RESULT.PAID) {
        const response = await this.finalizePaidPayout(
          context,
          prepared.payout.id,
          providerResult,
          idempotency.recordId,
        );
        completed = true;
        return response;
      }

      await this.finalizeFailedPayout(
        context,
        prepared.payout.id,
        providerResult,
        idempotency.recordId,
      );
      completed = true;
      throw this.providerFailed();
    } catch (error) {
      if (!completed) await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Consumes only approved Commission events and re-reads the persisted Commission entry before changing Wallet state. */
  async handleSourceEvent(job: WalletPayoutSourceEventJobData): Promise<void> {
    if (!WALLET_PAYOUT_SOURCE_EVENT_VALUES.includes(
      job.event.eventType as (typeof WALLET_PAYOUT_SOURCE_EVENT_VALUES)[number],
    )) {
      return;
    }

    const commissionEntryId = job.event.aggregateId;
    if (!commissionEntryId) {
      throw walletPayoutError(
        ERROR_CODE.INTERNAL_ERROR,
        "Commission source event is missing its immutable entry identifier.",
        500,
      );
    }

    await this.applyCommissionSource(
      systemContext(`wallet-source:${job.eventId}`),
      commissionEntryId,
    );
  }

  /** Executes one recurring settlement occurrence through the same idempotent service command used internally. */
  async settleScheduledWallets(job: WalletSettlementJobData): Promise<SettleWalletResult> {
    return this.settleWallet(
      systemContext(`wallet-settlement:${job.idempotencyKey}`),
      job.input,
      job.idempotencyKey,
    );
  }

  /** Applies one immutable Commission sale/refund source exactly once for the source-event consumer. */
  async applyCommissionSource(
    context: RequestContext,
    commissionEntryId: string,
  ): Promise<WalletCommissionApplyResult> {
    this.requireSystem(context);
    const source = await this.commissions.getWalletEntrySnapshot(
      systemContext(context.requestId),
      commissionEntryId,
    );
    return this.transactionRunner(async (transaction) =>
      this.applyCommissionSourceInTransaction(context, transaction, source),
    );
  }

  /** Re-drives one negative Commission adjustment through the same source application logic with Foundation idempotency. */
  async adjustWallet(
    context: RequestContext,
    input: AdjustWalletInput,
    idempotencyKey: string,
  ): Promise<AdjustWalletResult> {
    this.requireSystem(context);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: WALLET_PAYOUT_IDEMPOTENCY_SCOPE.WALLET_ADJUST,
        key: normalizedKey,
        requestHash: sha256(`module17-wallet-adjust-v1|${input.commissionEntryId}`),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return adjustWalletResultSchema.parse(idempotency.replay.responseBody);
    }

    try {
      const source = await this.commissions.getWalletEntrySnapshot(
        systemContext(context.requestId),
        input.commissionEntryId,
      );
      if (!this.isNegativeCommissionAdjustment(source)) {
        throw this.walletSourceInvalid(
          "The requested Commission source is not an eligible negative Wallet adjustment.",
        );
      }

      return await this.transactionRunner(async (transaction) => {
        const result = await this.applyCommissionSourceInTransaction(context, transaction, source);
        const response = adjustWalletResultSchema.parse(result);
        await this.idempotencyUsingTransaction(transaction).complete(
          idempotency.recordId,
          200,
          response,
        );
        return response;
      });
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Moves each eligible pending Commission earning to available exactly once after delivery plus Return-window hold. */
  async settleWallet(
    context: RequestContext,
    input: SettleWalletInput,
    idempotencyKey: string,
  ): Promise<SettleWalletResult> {
    this.requireSystem(context);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const idempotency = await this.idempotency.begin(
      {
        scope: WALLET_PAYOUT_IDEMPOTENCY_SCOPE.WALLET_SETTLE,
        key: normalizedKey,
        requestHash: sha256(`module17-wallet-settle-v1|${input.limit}`),
      },
      this.now(),
    );
    if (idempotency.mode === "replay") {
      return settleWalletResultSchema.parse(idempotency.replay.responseBody);
    }

    try {
      const holdDays = await this.administration.getReturnWindowDays();
      return await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const candidates = await repository.listPendingSettlementCandidates(input.limit);
        let settled = 0;
        let skipped = 0;

        for (const candidate of candidates) {
          const didSettle = await this.settleCandidate(
            context,
            transaction,
            repository,
            candidate,
            holdDays,
          );
          if (didSettle) settled += 1;
          else skipped += 1;
        }

        const response = settleWalletResultSchema.parse({
          scanned: candidates.length,
          settled,
          skipped,
        });
        await this.idempotencyUsingTransaction(transaction).complete(
          idempotency.recordId,
          200,
          response,
        );
        return response;
      });
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Applies one Commission source under a Wallet row lock and writes only immutable bucket deltas. */
  private async applyCommissionSourceInTransaction(
    context: RequestContext,
    transaction: DatabaseTransaction,
    source: CommissionWalletEntrySnapshot,
  ): Promise<WalletCommissionApplyResult> {
    const repository = this.repositoryUsingTransaction(transaction);
    await repository.ensureWallet(source.sellerId, source.currency);
    const wallet = await repository.lockWallet(source.sellerId, source.currency);
    if (!wallet) {
      throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Seller Wallet could not be locked.", 500);
    }

    if (source.entryType === COMMISSION_ENTRY_TYPE.SALE) {
      return this.applyPositiveCommissionSource(transaction, repository, wallet, source);
    }
    if (this.isNegativeCommissionAdjustment(source)) {
      return this.applyNegativeCommissionSource(context, transaction, repository, wallet, source);
    }

    throw this.walletSourceInvalid("Commission source is not supported by the Wallet contract.");
  }

  /** Credits a positive Commission sale, recovering seller debt before any remainder enters pending. */
  private async applyPositiveCommissionSource(
    transaction: DatabaseTransaction,
    repository: SellerWalletPayoutsRepository,
    wallet: SellerWalletRow,
    source: CommissionWalletEntrySnapshot,
  ): Promise<WalletCommissionApplyResult> {
    const sourceAmount = moneyToScale4(source.sellerNetAmount);
    if (sourceAmount <= 0n) {
      throw this.walletSourceInvalid("Commission sale Wallet source must have positive seller net.");
    }
    const replay = await this.findExistingCommissionApplication(repository, source, true);
    if (replay) {
      return { commissionEntryId: source.commissionEntryId, applied: false, wallet: this.toWalletResponse(wallet) };
    }

    const amounts = this.walletAmounts(wallet);
    let remaining = sourceAmount;
    if (amounts.negative < 0n) {
      const recovery = remaining < -amounts.negative ? remaining : -amounts.negative;
      if (recovery > 0n) {
        await this.appendWalletEntry(repository, {
          sellerId: source.sellerId,
          currency: source.currency,
          type: WALLET_ENTRY_TYPE.NEGATIVE_RECOVERY,
          amount: scale4ToMoney(recovery),
          balanceBucket: WALLET_BALANCE_BUCKET.NEGATIVE,
          sourceType: WALLET_SOURCE_TYPE.COMMISSION,
          sourceId: source.commissionEntryId,
          sourceKey: `recover:${source.commissionEntryId}:negative-credit`,
          occurredAt: new Date(source.occurredAt),
        });
        amounts.negative += recovery;
        remaining -= recovery;
      }
    }
    if (remaining > 0n) {
      await this.appendWalletEntry(repository, {
        sellerId: source.sellerId,
        currency: source.currency,
        type: WALLET_ENTRY_TYPE.COMMISSION_CREDIT,
        amount: scale4ToMoney(remaining),
        balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
        sourceType: WALLET_SOURCE_TYPE.COMMISSION,
        sourceId: source.commissionEntryId,
        sourceKey:
          remaining === sourceAmount
            ? `commission:${source.commissionEntryId}:pending`
            : `commission:${source.commissionEntryId}:pending-remainder`,
        occurredAt: new Date(source.occurredAt),
      });
      amounts.pending += remaining;
    }
    this.assertWalletAmounts(amounts);
    const updated = await this.persistWalletAmounts(repository, wallet, amounts);
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: WALLET_PAYOUT_OUTBOX_EVENT.WALLET_CREDITED,
      aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.WALLET,
      aggregateId: source.sellerId,
      payload: {
        commissionEntryId: source.commissionEntryId,
        sellerId: source.sellerId,
        currency: source.currency,
        sellerNetAmount: source.sellerNetAmount,
      },
    });
    return { commissionEntryId: source.commissionEntryId, applied: true, wallet: this.toWalletResponse(updated) };
  }

  /** Applies a negative Commission refund/adjustment through pending, available, then recoverable negative balance. */
  private async applyNegativeCommissionSource(
    context: RequestContext,
    transaction: DatabaseTransaction,
    repository: SellerWalletPayoutsRepository,
    wallet: SellerWalletRow,
    source: CommissionWalletEntrySnapshot,
  ): Promise<WalletCommissionApplyResult> {
    const replay = await this.findExistingCommissionApplication(repository, source, false);
    if (replay) {
      return { commissionEntryId: source.commissionEntryId, applied: false, wallet: this.toWalletResponse(wallet) };
    }

    let remaining = -moneyToScale4(source.sellerNetAmount);
    if (remaining <= 0n) {
      throw this.walletSourceInvalid("Wallet adjustment source must reduce seller net.");
    }
    const amounts = this.walletAmounts(wallet);
    const pendingReduction = remaining < amounts.pending ? remaining : amounts.pending;
    if (pendingReduction > 0n) {
      await this.appendWalletEntry(repository, {
        sellerId: source.sellerId,
        currency: source.currency,
        type: WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT,
        amount: scale4ToMoney(-pendingReduction),
        balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
        sourceType: WALLET_SOURCE_TYPE.COMMISSION,
        sourceId: source.commissionEntryId,
        sourceKey: `commission:${source.commissionEntryId}:pending-adjustment`,
        occurredAt: new Date(source.occurredAt),
      });
      amounts.pending -= pendingReduction;
      remaining -= pendingReduction;
    }

    const availableReduction = remaining < amounts.available ? remaining : amounts.available;
    if (availableReduction > 0n) {
      await this.appendWalletEntry(repository, {
        sellerId: source.sellerId,
        currency: source.currency,
        type: WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT,
        amount: scale4ToMoney(-availableReduction),
        balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
        sourceType: WALLET_SOURCE_TYPE.COMMISSION,
        sourceId: source.commissionEntryId,
        sourceKey: `commission:${source.commissionEntryId}:available-adjustment`,
        occurredAt: new Date(source.occurredAt),
      });
      amounts.available -= availableReduction;
      remaining -= availableReduction;
    }

    if (remaining > 0n) {
      await this.appendWalletEntry(repository, {
        sellerId: source.sellerId,
        currency: source.currency,
        type: WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT,
        amount: scale4ToMoney(-remaining),
        balanceBucket: WALLET_BALANCE_BUCKET.NEGATIVE,
        sourceType: WALLET_SOURCE_TYPE.COMMISSION,
        sourceId: source.commissionEntryId,
        sourceKey: `commission:${source.commissionEntryId}:negative-adjustment`,
        occurredAt: new Date(source.occurredAt),
      });
      amounts.negative -= remaining;
    }

    this.assertWalletAmounts(amounts);
    const updated = await this.persistWalletAmounts(repository, wallet, amounts);
    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: WALLET_PAYOUT_AUDIT_ACTION.WALLET_ADJUSTED,
      entityType: WALLET_PAYOUT_RESOURCE_TYPE.WALLET,
      entityId: source.sellerId,
      sellerId: source.sellerId,
      requestId: context.requestId,
      metadata: {
        commissionEntryId: source.commissionEntryId,
        orderId: source.orderId,
        orderItemId: source.orderItemId,
      },
      after: this.toWalletResponse(updated),
    });
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: WALLET_PAYOUT_OUTBOX_EVENT.WALLET_ADJUSTED,
      aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.WALLET,
      aggregateId: source.sellerId,
      payload: {
        commissionEntryId: source.commissionEntryId,
        sellerId: source.sellerId,
        currency: source.currency,
        sellerNetAmount: source.sellerNetAmount,
      },
    });
    return { commissionEntryId: source.commissionEntryId, applied: true, wallet: this.toWalletResponse(updated) };
  }

  /** Revalidates one pending Commission credit and moves the full remaining source amount to available when eligible. */
  private async settleCandidate(
    context: RequestContext,
    transaction: DatabaseTransaction,
    repository: SellerWalletPayoutsRepository,
    candidate: SellerWalletEntryRow,
    holdDays: number,
  ): Promise<boolean> {
    if (candidate.sourceType !== WALLET_SOURCE_TYPE.COMMISSION) return false;
    const source = await this.commissions.getWalletEntrySnapshot(
      systemContext(context.requestId),
      candidate.sourceId,
    );
    if (
      source.entryType !== COMMISSION_ENTRY_TYPE.SALE ||
      source.sellerId !== candidate.sellerId ||
      source.currency !== candidate.currency ||
      moneyToScale4(source.sellerNetAmount) < moneyToScale4(candidate.amount)
    ) {
      throw this.walletSourceDuplicate("Pending Wallet source does not match authoritative Commission state.");
    }

    const delivery = await this.shipping.getWalletDeliverySnapshot(
      systemContext(context.requestId),
      {
        orderId: source.orderId,
        sellerId: source.sellerId,
        sellerOrderId: source.sellerOrderId,
        orderItemId: source.orderItemId,
      },
    );
    if (!this.isSettlementEligible(delivery, holdDays)) return false;

    const wallet = await repository.lockWallet(candidate.sellerId, candidate.currency);
    if (!wallet) return false;
    const candidateAmount = moneyToScale4(candidate.amount);
    const amounts = this.walletAmounts(wallet);
    if (candidateAmount <= 0n || amounts.pending < candidateAmount) return false;

    const debitKey = `settle:${candidate.id}:pending-debit`;
    if (await repository.findWalletEntryBySourceKey(debitKey)) return false;
    const occurredAt = this.now();
    await this.appendWalletEntry(repository, {
      sellerId: candidate.sellerId,
      currency: candidate.currency,
      type: WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
      amount: scale4ToMoney(-candidateAmount),
      balanceBucket: WALLET_BALANCE_BUCKET.PENDING,
      sourceType: WALLET_SOURCE_TYPE.SETTLEMENT,
      sourceId: candidate.id,
      sourceKey: debitKey,
      occurredAt,
    });
    await this.appendWalletEntry(repository, {
      sellerId: candidate.sellerId,
      currency: candidate.currency,
      type: WALLET_ENTRY_TYPE.AVAILABILITY_TRANSFER,
      amount: candidate.amount,
      balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
      sourceType: WALLET_SOURCE_TYPE.SETTLEMENT,
      sourceId: candidate.id,
      sourceKey: `settle:${candidate.id}:available-credit`,
      occurredAt,
    });
    amounts.pending -= candidateAmount;
    amounts.available += candidateAmount;
    this.assertWalletAmounts(amounts);
    const updated = await this.persistWalletAmounts(repository, wallet, amounts);
    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: WALLET_PAYOUT_AUDIT_ACTION.WALLET_SETTLED,
      entityType: WALLET_PAYOUT_RESOURCE_TYPE.WALLET_ENTRY,
      entityId: candidate.id,
      sellerId: candidate.sellerId,
      requestId: context.requestId,
      metadata: { commissionEntryId: source.commissionEntryId },
      after: this.toWalletResponse(updated),
    });
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: WALLET_PAYOUT_OUTBOX_EVENT.WALLET_AVAILABLE,
      aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.WALLET,
      aggregateId: candidate.sellerId,
      payload: {
        commissionEntryId: source.commissionEntryId,
        walletEntryId: candidate.id,
        sellerId: candidate.sellerId,
        currency: candidate.currency,
        amount: candidate.amount,
      },
    });
    return true;
  }

  /** Moves an approved Payout to processing once and returns its provider account for external execution/reconciliation. */
  private async preparePayoutSend(
    context: RequestContext,
    payoutId: string,
  ): Promise<{ payout: PayoutRow; account: PayoutAccountRow }> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const payout = await repository.lockPayoutById(payoutId);
      if (!payout) throw this.payoutStatusInvalid("Payout is unavailable for sending.", 404);
      if (
        payout.status !== PAYOUT_STATUS.APPROVED &&
        payout.status !== PAYOUT_STATUS.PROCESSING
      ) {
        throw this.payoutStatusInvalid();
      }
      const account = await repository.findPayoutAccountInSellerScope(
        payout.accountId,
        payout.sellerId,
      );
      this.assertPayoutAccountUsable(account);

      if (payout.status === PAYOUT_STATUS.PROCESSING) return { payout, account: account as PayoutAccountRow };
      const processing = await repository.updatePayout(payout.id, {
        status: PAYOUT_STATUS.PROCESSING,
        processedAt: null,
        providerRef: null,
      });
      if (!processing) throw this.payoutStatusInvalid("Payout processing state could not be persisted.", 500);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_SEND_REQUESTED,
        entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
        entityId: payout.id,
        sellerId: payout.sellerId,
        requestId: context.requestId,
        before: { status: payout.status },
        after: { status: processing.status },
      });
      return { payout: processing, account: account as PayoutAccountRow };
    });
  }

  /** Finalizes a provider-authoritative paid result by consuming held balance and immutable reservation history. */
  private async finalizePaidPayout(
    context: RequestContext,
    payoutId: string,
    providerResult: Extract<ProviderPayoutResult, { status: "paid" }>,
    idempotencyRecordId: string,
  ): Promise<PayoutResponse> {
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const payout = await repository.lockPayoutById(payoutId);
      if (!payout || payout.status !== PAYOUT_STATUS.PROCESSING) throw this.payoutStatusInvalid();
      const wallet = await repository.lockWallet(payout.sellerId, payout.currency);
      if (!wallet) throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Payout Wallet is unavailable.", 500);
      const amount = moneyToScale4(payout.amount);
      const amounts = this.walletAmounts(wallet);
      if (amounts.held < amount) {
        throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Held Payout balance is inconsistent.", 500);
      }
      await this.appendWalletEntry(repository, {
        sellerId: payout.sellerId,
        currency: payout.currency,
        type: WALLET_ENTRY_TYPE.PAYOUT_PAID,
        amount: scale4ToMoney(-amount),
        balanceBucket: WALLET_BALANCE_BUCKET.HELD,
        sourceType: WALLET_SOURCE_TYPE.PAYOUT,
        sourceId: payout.id,
        sourceKey: `payout:${payout.id}:paid:held-debit`,
        occurredAt: providerResult.processedAt,
      });
      amounts.held -= amount;
      this.assertWalletAmounts(amounts);
      await this.persistWalletAmounts(repository, wallet, amounts);
      const paid = await repository.updatePayout(payout.id, {
        status: PAYOUT_STATUS.PAID,
        processedAt: providerResult.processedAt,
        providerRef: providerResult.providerRef,
      });
      if (!paid) throw this.payoutStatusInvalid("Paid Payout state could not be persisted.", 500);
      const response = this.toPayoutResponse(
        paid,
        await repository.listPayoutAllocations(payout.id),
      );
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_PAID,
        entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
        entityId: payout.id,
        sellerId: payout.sellerId,
        requestId: context.requestId,
        before: { status: payout.status },
        after: response,
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_PAID,
        aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
        aggregateId: payout.id,
        payload: response,
      });
      await this.idempotencyUsingTransaction(transaction).complete(
        idempotencyRecordId,
        200,
        response,
      );
      return response;
    });
  }

  /** Finalizes a provider-authoritative failure by releasing held money back to available and preserving the failed Payout. */
  private async finalizeFailedPayout(
    context: RequestContext,
    payoutId: string,
    providerResult: Extract<ProviderPayoutResult, { status: "failed" }>,
    idempotencyRecordId: string,
  ): Promise<void> {
    await this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const payout = await repository.lockPayoutById(payoutId);
      if (!payout || payout.status !== PAYOUT_STATUS.PROCESSING) throw this.payoutStatusInvalid();
      const wallet = await repository.lockWallet(payout.sellerId, payout.currency);
      if (!wallet) throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Payout Wallet is unavailable.", 500);
      const amount = moneyToScale4(payout.amount);
      const amounts = this.walletAmounts(wallet);
      if (amounts.held < amount) {
        throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Held Payout balance is inconsistent.", 500);
      }
      await this.appendWalletEntry(repository, {
        sellerId: payout.sellerId,
        currency: payout.currency,
        type: WALLET_ENTRY_TYPE.PAYOUT_RELEASE,
        amount: scale4ToMoney(-amount),
        balanceBucket: WALLET_BALANCE_BUCKET.HELD,
        sourceType: WALLET_SOURCE_TYPE.PAYOUT,
        sourceId: payout.id,
        sourceKey: `payout:${payout.id}:release:held-debit`,
        occurredAt: providerResult.processedAt,
      });
      await this.appendWalletEntry(repository, {
        sellerId: payout.sellerId,
        currency: payout.currency,
        type: WALLET_ENTRY_TYPE.PAYOUT_RELEASE,
        amount: payout.amount,
        balanceBucket: WALLET_BALANCE_BUCKET.AVAILABLE,
        sourceType: WALLET_SOURCE_TYPE.PAYOUT,
        sourceId: payout.id,
        sourceKey: `payout:${payout.id}:release:available-credit`,
        occurredAt: providerResult.processedAt,
      });
      amounts.held -= amount;
      amounts.available += amount;
      this.assertWalletAmounts(amounts);
      await this.persistWalletAmounts(repository, wallet, amounts);
      const failed = await repository.updatePayout(payout.id, {
        status: PAYOUT_STATUS.FAILED,
        processedAt: providerResult.processedAt,
        providerRef: null,
      });
      if (!failed) throw this.payoutStatusInvalid("Failed Payout state could not be persisted.", 500);
      const response = this.toPayoutResponse(
        failed,
        await repository.listPayoutAllocations(payout.id),
      );
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: WALLET_PAYOUT_AUDIT_ACTION.PAYOUT_FAILED,
        entityType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
        entityId: payout.id,
        sellerId: payout.sellerId,
        requestId: context.requestId,
        before: { status: payout.status },
        after: response,
        metadata: { failureCode: providerResult.failureCode },
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: WALLET_PAYOUT_OUTBOX_EVENT.PAYOUT_FAILED,
        aggregateType: WALLET_PAYOUT_RESOURCE_TYPE.PAYOUT,
        aggregateId: payout.id,
        payload: { ...response, failureCode: providerResult.failureCode },
      });
      await this.idempotencyUsingTransaction(transaction).complete(
        idempotencyRecordId,
        502,
        {
          code: WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
          message: "External payout failed; reserved funds were released.",
        },
      );
    });
  }

  /** Builds deterministic FIFO Payout allocations while ignoring reservations already released by failed Payouts. */
  private async buildPayoutAllocations(
    repository: SellerWalletPayoutsRepository,
    payout: PayoutRow,
  ): Promise<CreatePayoutAllocationRecordInput[]> {
    const sources = await repository.listAvailableAllocationSourceEntries(
      payout.sellerId,
      payout.currency,
    );
    const usage = await repository.listAllocationUsageForWalletEntries(
      sources.map((source) => source.id),
    );
    let remaining = moneyToScale4(payout.amount);
    const allocations: CreatePayoutAllocationRecordInput[] = [];

    for (const source of sources) {
      if (remaining === 0n) break;
      const consumed = usage
        .filter(
          (row) =>
            row.walletEntryId === source.id &&
            row.payoutStatus !== PAYOUT_STATUS.FAILED,
        )
        .reduce((total, row) => total + moneyToScale4(row.amount), 0n);
      const available = moneyToScale4(source.amount) - consumed;
      if (available <= 0n) continue;
      const allocation = remaining < available ? remaining : available;
      allocations.push({ walletEntryId: source.id, amount: scale4ToMoney(allocation) });
      remaining -= allocation;
    }

    if (remaining !== 0n) {
      throw walletPayoutError(
        ERROR_CODE.INTERNAL_ERROR,
        "Available Wallet balance cannot be reconciled to immutable earning sources.",
        500,
      );
    }
    return allocations;
  }

  /** Appends one deterministic immutable Wallet entry or verifies that an exact retry persisted identical facts. */
  private async appendWalletEntry(
    repository: SellerWalletPayoutsRepository,
    input: CreateWalletEntryRecordInput,
  ): Promise<SellerWalletEntryRow> {
    const created = await repository.createWalletEntryIfMissing(input);
    if (created) return created;
    const existing = await repository.findWalletEntryBySourceKey(input.sourceKey);
    if (!existing || !this.walletEntryMatches(existing, input)) {
      throw this.walletSourceDuplicate();
    }
    return existing;
  }

  /** Checks whether a deterministic source key already represents the expected immutable Wallet fact. */
  private walletEntryMatches(
    existing: SellerWalletEntryRow,
    input: CreateWalletEntryRecordInput,
  ): boolean {
    return (
      existing.sellerId === input.sellerId &&
      existing.currency === input.currency &&
      existing.type === input.type &&
      existing.amount === input.amount &&
      existing.balanceBucket === input.balanceBucket &&
      existing.sourceType === input.sourceType &&
      existing.sourceId === input.sourceId &&
      existing.sourceKey === input.sourceKey
    );
  }

  /** Detects whether one Commission source has already been atomically applied to this Wallet. */
  private async findExistingCommissionApplication(
    repository: SellerWalletPayoutsRepository,
    source: CommissionWalletEntrySnapshot,
    positive: boolean,
  ): Promise<boolean> {
    const keys = positive
      ? [
          `commission:${source.commissionEntryId}:pending`,
          `recover:${source.commissionEntryId}:negative-credit`,
          `commission:${source.commissionEntryId}:pending-remainder`,
        ]
      : [
          `commission:${source.commissionEntryId}:pending-adjustment`,
          `commission:${source.commissionEntryId}:available-adjustment`,
          `commission:${source.commissionEntryId}:negative-adjustment`,
        ];
    const rows = await Promise.all(keys.map((key) => repository.findWalletEntryBySourceKey(key)));
    const existing = rows.filter((row): row is SellerWalletEntryRow => row !== null);
    for (const row of existing) {
      const typeMatches = positive
        ? row.type === WALLET_ENTRY_TYPE.COMMISSION_CREDIT ||
          row.type === WALLET_ENTRY_TYPE.NEGATIVE_RECOVERY
        : row.type === WALLET_ENTRY_TYPE.COMMISSION_ADJUSTMENT;
      if (
        row.sellerId !== source.sellerId ||
        row.currency !== source.currency ||
        row.sourceType !== WALLET_SOURCE_TYPE.COMMISSION ||
        row.sourceId !== source.commissionEntryId ||
        !typeMatches
      ) {
        throw this.walletSourceDuplicate();
      }
    }
    return existing.length > 0;
  }

  /** Persists one complete service-calculated Wallet snapshot after its immutable ledger rows are written. */
  private async persistWalletAmounts(
    repository: SellerWalletPayoutsRepository,
    wallet: SellerWalletRow,
    amounts: WalletAmounts,
  ): Promise<SellerWalletRow> {
    const updated = await repository.updateWalletSnapshot(wallet.sellerId, wallet.currency, {
      pendingBalance: scale4ToMoney(amounts.pending),
      availableBalance: scale4ToMoney(amounts.available),
      heldBalance: scale4ToMoney(amounts.held),
      negativeBalance: scale4ToMoney(amounts.negative),
      updatedAt: this.now(),
    });
    if (!updated) {
      throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Seller Wallet snapshot could not be persisted.", 500);
    }
    return updated;
  }

  /** Converts one persisted Wallet snapshot into exact integer buckets used by business arithmetic. */
  private walletAmounts(wallet: SellerWalletRow): WalletAmounts {
    return {
      pending: moneyToScale4(wallet.pendingBalance),
      available: moneyToScale4(wallet.availableBalance),
      held: moneyToScale4(wallet.heldBalance),
      negative: moneyToScale4(wallet.negativeBalance),
    };
  }

  /** Enforces the frozen Wallet bucket sign invariants before any snapshot update is persisted. */
  private assertWalletAmounts(amounts: WalletAmounts): void {
    if (
      amounts.pending < 0n ||
      amounts.available < 0n ||
      amounts.held < 0n ||
      amounts.negative > 0n
    ) {
      throw walletPayoutError(ERROR_CODE.INTERNAL_ERROR, "Seller Wallet balance invariant failed.", 500);
    }
  }

  /** Returns true only after full commercial delivery and the configured Return-window timestamp have both passed. */
  private isSettlementEligible(
    delivery: WalletDeliverySnapshot | null,
    holdDays: number,
  ): boolean {
    if (!delivery?.fullyDelivered || !delivery.latestDeliveredAt) return false;
    const eligibleAt = new Date(delivery.latestDeliveredAt).getTime() + holdDays * DAY_MS;
    return this.now().getTime() >= eligibleAt;
  }

  /** Returns true only for the approved negative refund/adjustment Commission source shapes. */
  private isNegativeCommissionAdjustment(source: CommissionWalletEntrySnapshot): boolean {
    return (
      (source.entryType === COMMISSION_ENTRY_TYPE.REFUND ||
        source.entryType === COMMISSION_ENTRY_TYPE.ADJUSTMENT) &&
      moneyToScale4(source.sellerNetAmount) < 0n
    );
  }

  /** Returns true only when a provider timestamp is a finite JavaScript Date. */
  private isUsableProviderTimestamp(value: Date): boolean {
    return Number.isFinite(value.getTime());
  }

  /** Validates the provider-paid terminal facts before they may mutate marketplace Payout state. */
  private isUsablePaidProviderResult(
    result: Extract<ProviderPayoutResult, { status: "paid" }>,
  ): boolean {
    return (
      this.isUsableProviderTimestamp(result.processedAt) &&
      result.providerRef.trim().length > 0 &&
      result.providerRef.length <= WALLET_PAYOUT_LIMITS.PROVIDER_REF_MAX_LENGTH
    );
  }

  /** Calls the provider account validator and rejects unsafe or substituted provider references. */
  private async validateProviderAccount(
    input: CreatePayoutAccountInput,
  ): Promise<ValidatedPayoutAccountReference> {
    let validated: ValidatedPayoutAccountReference;
    try {
      validated = await this.provider.validateAccountReference(
        input.providerType,
        input.providerAccountRef,
      );
    } catch {
      throw walletPayoutError(
        WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
        "Payout account provider validation failed.",
        502,
      );
    }
    if (
      validated.providerType !== input.providerType ||
      validated.providerAccountRef !== input.providerAccountRef ||
      !validated.maskedDetails.trim() ||
      validated.maskedDetails.length > WALLET_PAYOUT_LIMITS.MASKED_DETAILS_MAX_LENGTH
    ) {
      throw walletPayoutError(
        WALLET_PAYOUT_ERROR_CODE.PAYOUT_ACCOUNT_INVALID,
        "Payout account reference is invalid.",
        422,
      );
    }
    return validated;
  }

  /** Rejects missing, disabled, or unverified seller payout destinations. */
  private assertPayoutAccountUsable(
    account: PayoutAccountRow | null,
  ): asserts account is PayoutAccountRow {
    if (
      !account ||
      account.status !== PAYOUT_ACCOUNT_STATUS.ACTIVE ||
      account.verifiedAt === null
    ) {
      throw walletPayoutError(
        WALLET_PAYOUT_ERROR_CODE.PAYOUT_ACCOUNT_INVALID,
        "Payout account is unavailable.",
        409,
      );
    }
  }

  /** Resolves exactly one seller where the requested seller-scoped Wallet/Payout permission is effective. */
  private resolveSingleSeller(context: RequestContext, permission: PermissionCode): string {
    this.requireActor(context);
    if (context.actorType !== ACTOR_TYPE.SELLER) {
      throw walletPayoutError(ERROR_CODE.FORBIDDEN, "Seller Wallet scope is required.", 403);
    }
    const sellerIds = [...context.sellerIds].filter((sellerId) =>
      context.sellerPermissions.get(sellerId)?.has(permission),
    );
    if (sellerIds.length !== 1) {
      throw walletPayoutError(
        ERROR_CODE.FORBIDDEN,
        "Exactly one authorized seller Wallet scope is required.",
        403,
      );
    }
    return sellerIds[0] as string;
  }

  /** Requires one authenticated non-system actor before seller/admin Wallet operations proceed. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw walletPayoutError(ERROR_CODE.UNAUTHENTICATED, "Authenticated Wallet access is required.", 401);
    }
    return context.actorId;
  }

  /** Restricts internal source/settlement commands to the trusted system actor. */
  private requireSystem(context: RequestContext): void {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw walletPayoutError(ERROR_CODE.FORBIDDEN, "Internal Wallet command access is required.", 403);
    }
  }

  /** Normalizes and bounds one Foundation Idempotency-Key before a money-moving command begins. */
  private normalizeIdempotencyKey(value: string): string {
    const key = value.trim();
    if (!key || key.length > WALLET_PAYOUT_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw walletPayoutError(ERROR_CODE.VALIDATION_FAILED, "A valid Idempotency-Key is required.", 422);
    }
    return key;
  }

  /** Best-effort failure release must not hide the original business/provider error. */
  private async failIdempotencySafely(recordId: string): Promise<void> {
    try {
      await this.idempotency.fail(recordId);
    } catch {
      // The original error remains authoritative; reconciliation can inspect persisted idempotency state.
    }
  }

  /** Replays either a successful send result or the same provider-terminal failure recorded for that key. */
  private resolveSendReplay(statusCode: number, responseBody: unknown): PayoutResponse {
    if (statusCode >= 400) throw this.providerFailed();
    return payoutResponseSchema.parse(responseBody);
  }

  /** Attaches immutable allocation rows to one bounded Payout page without one query per Payout. */
  private async attachPayoutAllocations(rows: PayoutRow[]): Promise<PayoutResponse[]> {
    const allocations = await this.repository.listPayoutAllocationsByPayoutIds(rows.map((row) => row.id));
    return rows.map((row) =>
      this.toPayoutResponse(
        row,
        allocations.filter((allocation) => allocation.payoutId === row.id),
      ),
    );
  }

  /** Maps one Wallet row to the safe exact-money response contract. */
  private toWalletResponse(row: SellerWalletRow): SellerWalletBalanceResponse {
    return {
      sellerId: row.sellerId,
      currency: row.currency,
      pendingBalance: row.pendingBalance,
      availableBalance: row.availableBalance,
      heldBalance: row.heldBalance,
      negativeBalance: row.negativeBalance,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Maps one immutable Wallet entry without exposing its deterministic internal source key. */
  private toWalletEntryResponse(row: SellerWalletEntryRow): SellerWalletResponse["entries"][number] {
    return {
      id: row.id,
      sellerId: row.sellerId,
      currency: row.currency,
      type: row.type as SellerWalletResponse["entries"][number]["type"],
      amount: row.amount,
      balanceBucket: row.balanceBucket as SellerWalletResponse["entries"][number]["balanceBucket"],
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      occurredAt: row.occurredAt.toISOString(),
    };
  }

  /** Maps one tokenized payout account while withholding the provider-owned reference. */
  private toPayoutAccountResponse(row: PayoutAccountRow): PayoutAccountResponse {
    return {
      id: row.id,
      sellerId: row.sellerId,
      providerType: row.providerType,
      maskedDetails: row.maskedDetails,
      status: row.status as PayoutAccountResponse["status"],
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    };
  }

  /** Maps one Payout plus immutable allocations to the shared seller/admin safe response contract. */
  private toPayoutResponse(
    row: PayoutRow,
    allocations: PayoutAllocationRow[],
  ): PayoutResponse {
    return payoutResponseSchema.parse({
      id: row.id,
      payoutNo: row.payoutNo,
      sellerId: row.sellerId,
      amount: row.amount,
      currency: row.currency,
      accountId: row.accountId,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
      providerRef: row.providerRef,
      allocations: allocations.map((allocation) => ({
        walletEntryId: allocation.walletEntryId,
        amount: allocation.amount,
      })),
    });
  }

  /** Formats the stable human-readable Payout number from its UUID without adding a separate sequence. */
  private payoutNumber(id: string): string {
    return `PAY-${id.replaceAll("-", "").toUpperCase()}`;
  }

  /** Returns the stable insufficient-balance conflict without exposing other seller Wallet facts. */
  private insufficientBalance(): AppError {
    return walletPayoutError(
      WALLET_PAYOUT_ERROR_CODE.INSUFFICIENT_AVAILABLE_BALANCE,
      "Seller Wallet does not have enough available balance for this Payout.",
      409,
    );
  }

  /** Returns the stable Payout lifecycle error for missing or invalid finance transitions. */
  private payoutStatusInvalid(
    message = "Payout status does not allow this operation.",
    statusCode = 409,
  ): AppError {
    return walletPayoutError(WALLET_PAYOUT_ERROR_CODE.PAYOUT_STATUS_INVALID, message, statusCode);
  }

  /** Returns a generic invalid-source error when authoritative Commission facts are unsupported by the frozen Wallet contract. */
  private walletSourceInvalid(message: string): AppError {
    return walletPayoutError(ERROR_CODE.INVALID_REQUEST, message, 409);
  }

  /** Returns the stable immutable-source conflict for unsafe Wallet source reuse. */
  private walletSourceDuplicate(
    message = "Wallet source was already used with conflicting immutable facts.",
  ): AppError {
    return walletPayoutError(WALLET_PAYOUT_ERROR_CODE.WALLET_SOURCE_DUPLICATE, message, 409);
  }

  /** Returns the stable provider-terminal error after funds have been safely reconciled. */
  private providerFailed(): AppError {
    return walletPayoutError(
      WALLET_PAYOUT_ERROR_CODE.PAYOUT_PROVIDER_ERROR,
      "External payout failed; reserved funds were released.",
      502,
    );
  }
}

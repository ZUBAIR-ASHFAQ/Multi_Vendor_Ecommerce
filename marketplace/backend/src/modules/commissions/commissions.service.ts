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
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import type {
  CommissionEntryRow,
  CommissionRuleRow,
  CommissionRuleSnapshotRow,
} from "../../database/schema/commissions.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { ORDER_PAYMENT_STATUS } from "../orders/orders.constants.js";
import {
  OrdersService,
  type OrderCommissionItemSnapshot,
  type OrderCommissionSnapshot,
} from "../orders/orders.service.js";
import {
  PaymentsService,
  type CommissionPaymentCaptureSnapshot,
  type CommissionPaymentRefundSnapshot,
} from "../payments/payments.service.js";
import { ProductsService } from "../products/products.service.js";
import { PROMOTION_FUNDING_TYPE } from "../promotions/promotions.constants.js";
import {
  PromotionsService,
  type CheckoutPromotionEvaluationResult,
} from "../promotions/promotions.service.js";
import { SellersService } from "../sellers/sellers.service.js";
import { CatalogTaxonomyService } from "../catalog-taxonomy/catalog-taxonomy.service.js";
import type { CategoryTreeNodeResponse } from "../catalog-taxonomy/catalog-taxonomy.schema.js";
import {
  COMMISSION_CALCULATION_POLICY,
  COMMISSION_IDEMPOTENCY_SCOPE,
  COMMISSION_ENTRY_TYPE,
  COMMISSION_RULE_ACTIVE_STATUS,
  COMMISSIONS_AUDIT_ACTION,
  COMMISSIONS_ERROR_CODE,
  COMMISSIONS_OUTBOX_EVENT,
  COMMISSIONS_PERMISSION,
  COMMISSIONS_RESOURCE_TYPE,
} from "./commissions.constants.js";
import {
  CommissionsRepository,
  type CreateCommissionEntryRecordInput,
  type CreateCommissionRuleSnapshotRecordInput,
} from "./commissions.repository.js";
import {
  commissionOrderSettleResultSchema,
  commissionRefundAdjustResultSchema,
} from "./commissions.schema.js";
import type {
  AdminCommissionEntryListQuery,
  AdminCommissionRuleListQuery,
  CommissionEntryResponse,
  CommissionOrderSettleResult,
  CommissionRefundAdjustResult,
  CommissionRuleResponse,
  CreateCommissionRuleInput,
  InternalCommissionOrderSettleInput,
  InternalCommissionPartialRefundAdjustInput,
  InternalCommissionRefundAdjustInput,
  SellerCommissionStatementQuery,
  SellerCommissionStatementResponse,
  UpdateCommissionRuleInput,
} from "./commissions.schema.js";

/** Runs one Commission transaction and allows focused service tests to replace the real database boundary. */
export type CommissionsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Narrow Orders service contract used by Commissions without importing Orders persistence. */
export interface CommissionsOrdersIntegration {
  /** Returns immutable Order/Item economics for one trusted settlement command. */
  getCommissionSnapshot(context: RequestContext, orderId: string): Promise<OrderCommissionSnapshot>;
}

/** Narrow Payments service contract that proves provider-authoritative capture/refund state. */
export interface CommissionsPaymentsIntegration {
  /** Returns exactly one succeeded capture for the requested Order. */
  getCommissionCapture(
    context: RequestContext,
    orderId: string,
  ): Promise<CommissionPaymentCaptureSnapshot>;

  /** Returns one succeeded provider refund belonging to the requested Order. */
  getCommissionRefund(
    context: RequestContext,
    orderId: string,
    paymentTransactionId: string,
  ): Promise<CommissionPaymentRefundSnapshot>;
}

/** Product classification boundary used only while a Commission rule is being snapshotted. */
export interface CommissionsProductsIntegration {
  /** Resolves the Product's seller/store/category classification at settlement time. */
  resolveProductCommissionScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string; categoryId: string } | null>;
}

/** Historical Promotion boundary used to distinguish seller-funded and platform-funded discounts. */
export interface CommissionsPromotionsIntegration {
  /** Returns immutable funding ownership for the coupon that produced the Order discount. */
  resolveHistoricalCouponFunding(
    couponCode: string,
  ): Promise<{ promotionId: string; fundingType: CheckoutPromotionEvaluationResult["fundingType"] } | null>;
}

/** Seller validation boundary used for seller-scoped Commission rule configuration. */
export interface CommissionsSellersIntegration {
  /** Verifies the target seller currently exists and may participate in marketplace commerce. */
  assertSellerCommerceEligible(sellerId: string): Promise<void>;
}

/** Catalog validation boundary used for category-scoped Commission rule configuration. */
export interface CommissionsCatalogIntegration {
  /** Returns the active category tree used to validate a category scope target. */
  listCategories(context?: RequestContext | null): Promise<CategoryTreeNodeResponse[]>;
}

/** Foundation idempotency boundary used by trusted Commission settlement and refund commands. */
export interface CommissionsIdempotencyIntegration {
  /** Acquires a new source key, returns a completed replay, or rejects conflicting/in-progress reuse. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Persists the safe result so an exact retry can return without repeating business work. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Releases one failed source key for a later safe retry. */
  fail(recordId: string): Promise<void>;
}

/** Small audit dependency used for Commission configuration and financial command evidence. */
export interface CommissionsAuditIntegration {
  /** Appends one immutable audit record. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Transactional outbox dependency used for durable Commission events. */
export interface CommissionsOutboxIntegration {
  /** Appends one event inside the current Commission transaction. */
  enqueue<TPayload>(input: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Explicit dependencies keep Commission business logic readable and independently testable. */
export interface CommissionsServiceDependencies {
  repository?: CommissionsRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => CommissionsRepository;
  transactionRunner?: CommissionsTransactionRunner;
  orders?: CommissionsOrdersIntegration;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => CommissionsOrdersIntegration;
  payments?: CommissionsPaymentsIntegration;
  products?: CommissionsProductsIntegration;
  promotions?: CommissionsPromotionsIntegration;
  sellers?: CommissionsSellersIntegration;
  catalog?: CommissionsCatalogIntegration;
  idempotency?: CommissionsIdempotencyIntegration;
  audit?: CommissionsAuditIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => CommissionsAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => CommissionsOutboxIntegration;
  now?: () => Date;
}

/** Paginated Commission rules returned before the future HTTP envelope is added. */
export interface PaginatedCommissionRulesResult {
  items: CommissionRuleResponse[];
  meta: PaginationMeta;
}

/** Paginated immutable Commission entries returned to finance/admin callers. */
export interface PaginatedCommissionEntriesResult {
  items: CommissionEntryResponse[];
  meta: PaginationMeta;
}

/** Seller statement plus page metadata kept separate from the stable response body contract. */
export interface SellerCommissionStatementResult {
  statement: SellerCommissionStatementResponse;
  meta: PaginationMeta;
}


/** Immutable Commission ledger facts exposed only to trusted Module 17 Wallet source verification. */
export interface CommissionWalletEntrySnapshot {
  commissionEntryId: string;
  orderId: string;
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  entryType: (typeof COMMISSION_ENTRY_TYPE)[keyof typeof COMMISSION_ENTRY_TYPE];
  sellerNetAmount: string;
  currency: string;
  sourceKey: string;
  occurredAt: string;
}

/** Exact scale used by Commission money rows. */
const MONEY_FACTOR = 10_000n;

/** Exact six-decimal scale used by percentage rates. */
const RATE_FACTOR = 1_000_000n;

/** Percentage divisor converts scale-6 percent into a scale-4 money result. */
const PERCENT_DIVISOR = 100n * RATE_FACTOR;

/** Converts one canonical signed scale-4 money string into an exact integer. */
function moneyToScale4(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const amount = BigInt(whole) * MONEY_FACTOR + BigInt(`${fraction}0000`.slice(0, 4));
  return negative ? -amount : amount;
}

/** Converts one exact signed scale-4 integer back into canonical Commission money. */
function scale4ToMoney(value: bigint): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const whole = unsigned / MONEY_FACTOR;
  const fraction = (unsigned % MONEY_FACTOR).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Converts one canonical non-negative scale-6 percentage into an exact integer. */
function rateToScale6(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * RATE_FACTOR + BigInt(`${fraction}000000`.slice(0, 6));
}

/** Divides exact integers using deterministic half-up rounding for positive Commission fees. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Allocates one signed immutable sale component cumulatively by quantity using scale-4 half-up rounding. */
function allocateSignedComponent(
  value: string,
  cumulativeQuantity: number,
  commercialQuantity: number,
): bigint {
  const original = moneyToScale4(value);
  const sign = original < 0n ? -1n : 1n;
  const magnitude = original < 0n ? -original : original;
  return sign * divideHalfUp(
    magnitude * BigInt(cumulativeQuantity),
    BigInt(commercialQuantity),
  );
}

/** Returns true when a new signed reversal delta moves toward the original component, never backward. */
function reversalDeltaIsForward(original: bigint, delta: bigint): boolean {
  if (original === 0n) return delta === 0n;
  return original > 0n ? delta >= 0n : delta <= 0n;
}

/** Creates one lowercase SHA-256 digest so item-level source keys stay bounded and deterministic. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Creates the trusted system identity used only for internal cross-module settlement reads. */
function systemContext(requestId: string = randomUUID()): RequestContext {
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

/** Creates one safe Module 16 business error with a stable public code. */
function commissionsError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Returns true when the active category tree contains one category ID. */
function categoryTreeContains(nodes: CategoryTreeNodeResponse[], categoryId: string): boolean {
  return nodes.some(
    (node) => node.id === categoryId || categoryTreeContains(node.children, categoryId),
  );
}

/** Reads only the basis fields Module 16 itself writes into immutable snapshot JSON. */
function readBasis(snapshot: CommissionRuleSnapshotRow): {
  sellerFundedDiscountAmount: string;
} {
  const basis = snapshot.basisJson;
  if (!basis || typeof basis !== "object") {
    throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission snapshot basis is invalid.", 500);
  }
  const value = (basis as { sellerFundedDiscountAmount?: unknown }).sellerFundedDiscountAmount;
  if (typeof value !== "string") {
    throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission snapshot discount basis is invalid.", 500);
  }
  return { sellerFundedDiscountAmount: value };
}

/** Module 16 service for rule lifecycle, immutable fee snapshots, ledger posting, and refund adjustments. */
export class CommissionsService {
  private readonly repository: CommissionsRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CommissionsRepository;
  private readonly transactionRunner: CommissionsTransactionRunner;
  private readonly orders: CommissionsOrdersIntegration;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CommissionsOrdersIntegration;
  private readonly payments: CommissionsPaymentsIntegration;
  private readonly products: CommissionsProductsIntegration;
  private readonly promotions: CommissionsPromotionsIntegration;
  private readonly sellers: CommissionsSellersIntegration;
  private readonly catalog: CommissionsCatalogIntegration;
  private readonly idempotency: CommissionsIdempotencyIntegration;
  private readonly audit: CommissionsAuditIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CommissionsAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CommissionsOutboxIntegration;
  private readonly now: () => Date;

  /** Stores explicit dependencies while keeping default production composition straightforward. */
  constructor(dependencies: CommissionsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new CommissionsRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ?? ((transaction) => new CommissionsRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.orders = dependencies.orders ?? new OrdersService();
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.payments = dependencies.payments ?? new PaymentsService();
    this.products = dependencies.products ?? new ProductsService();
    this.promotions = dependencies.promotions ?? new PromotionsService();
    this.sellers = dependencies.sellers ?? new SellersService();
    this.catalog = dependencies.catalog ?? new CatalogTaxonomyService();
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.audit = dependencies.audit ?? AuditService.using(db);
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Returns one persisted Commission entry as trusted Wallet source truth for Module 17. */
  async getWalletEntrySnapshot(
    context: RequestContext,
    commissionEntryId: string,
  ): Promise<CommissionWalletEntrySnapshot> {
    this.requireSystem(context);
    const source = await this.repository.findWalletEntrySourceById(commissionEntryId);
    if (!source) {
      throw commissionsError(
        ERROR_CODE.RESOURCE_NOT_FOUND,
        "Commission Wallet source was not found.",
        404,
      );
    }

    return {
      commissionEntryId: source.entry.id,
      orderId: source.orderId,
      sellerId: source.entry.sellerId,
      sellerOrderId: source.entry.sellerOrderId,
      orderItemId: source.entry.orderItemId,
      entryType: source.entry.type as CommissionWalletEntrySnapshot["entryType"],
      sellerNetAmount: source.entry.sellerNetAmount,
      currency: source.entry.currency,
      sourceKey: source.entry.sourceKey,
      occurredAt: source.entry.occurredAt.toISOString(),
    };
  }

  /** Lists Commission rules for an authorized finance/admin actor. */
  async listRules(
    context: RequestContext,
    query: AdminCommissionRuleListQuery,
  ): Promise<PaginatedCommissionRulesResult> {
    assertPermission(context, COMMISSIONS_PERMISSION.ADMIN_READ);
    const result = await this.repository.listAdminRules(query);
    return {
      items: result.items.map((row) => this.toRuleResponse(row)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Creates one effective-dated Commission rule after validating target scope and equal-priority overlap. */
  async createRule(
    context: RequestContext,
    input: CreateCommissionRuleInput,
  ): Promise<CommissionRuleResponse> {
    assertPermission(context, COMMISSIONS_PERMISSION.ADMIN_MANAGE);
    await this.assertRuleScopeExists(input.scopeType, input.scopeId ?? null);
    const startAt = new Date(input.startAt);
    const endAt = input.endAt ? new Date(input.endAt) : null;
    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      await repository.lockRuleConfiguration(input.scopeType, input.scopeId ?? null, input.priority);
      await this.assertNoEqualPriorityOverlap(repository, {
        priority: input.priority,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
        status: input.status,
        startAt,
        endAt,
      });
      const created = await repository.createRule({
        priority: input.priority,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
        ratePercent: input.ratePercent,
        fixedFee: input.fixedFee ?? null,
        fundingRulesJson: input.fundingRulesJson ?? null,
        startAt,
        endAt,
        status: input.status,
      });
      const safe = this.toRuleResponse(created);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: COMMISSIONS_AUDIT_ACTION.RULE_CREATED,
        entityType: COMMISSIONS_RESOURCE_TYPE.RULE,
        entityId: created.id,
        requestId: context.requestId,
        after: safe,
      });
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: COMMISSIONS_OUTBOX_EVENT.RULE_CREATED,
        aggregateType: COMMISSIONS_RESOURCE_TYPE.RULE,
        aggregateId: created.id,
        payload: safe,
      });
      return safe;
    });
  }

  /** Updates only a future-effective Commission rule so already-applicable economics cannot be rewritten. */
  async updateRule(
    context: RequestContext,
    ruleId: string,
    input: UpdateCommissionRuleInput,
  ): Promise<CommissionRuleResponse> {
    assertPermission(context, COMMISSIONS_PERMISSION.ADMIN_MANAGE);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const current = await repository.findRuleByIdForUpdate(ruleId);
      if (!current) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission rule was not found.", 404);
      }
      if (current.startAt.getTime() <= this.now().getTime()) {
        throw commissionsError(
          COMMISSIONS_ERROR_CODE.RULE_INVALID,
          "Only future-effective Commission rules may be edited.",
          409,
        );
      }

      const next = {
        priority: input.priority ?? current.priority,
        scopeType: (input.scopeType ?? current.scopeType) as CreateCommissionRuleInput["scopeType"],
        scopeId: input.scopeId !== undefined ? input.scopeId : current.scopeId,
        ratePercent: input.ratePercent ?? current.ratePercent,
        fixedFee: input.fixedFee !== undefined ? input.fixedFee : current.fixedFee,
        fundingRulesJson:
          input.fundingRulesJson !== undefined ? input.fundingRulesJson : current.fundingRulesJson,
        startAt: input.startAt ? new Date(input.startAt) : current.startAt,
        endAt: input.endAt !== undefined ? (input.endAt ? new Date(input.endAt) : null) : current.endAt,
        status: input.status ?? current.status,
      };
      if (next.startAt.getTime() <= this.now().getTime()) {
        throw commissionsError(
          COMMISSIONS_ERROR_CODE.RULE_INVALID,
          "A Commission rule update must remain future-effective.",
          409,
        );
      }
      if (next.endAt && next.endAt.getTime() <= next.startAt.getTime()) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission rule date range is invalid.", 422);
      }
      await this.assertRuleScopeExists(next.scopeType, next.scopeId);
      await repository.lockRuleConfiguration(next.scopeType, next.scopeId, next.priority);
      await this.assertNoEqualPriorityOverlap(repository, { ...next, excludeRuleId: ruleId });

      const updated = await repository.updateRule(ruleId, {
        priority: next.priority,
        scopeType: next.scopeType,
        scopeId: next.scopeId,
        ratePercent: next.ratePercent,
        fixedFee: next.fixedFee,
        fundingRulesJson: next.fundingRulesJson,
        startAt: next.startAt,
        endAt: next.endAt,
        status: next.status,
        updatedAt: this.now(),
      });
      if (!updated) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission rule was not found.", 404);
      }
      const safe = this.toRuleResponse(updated);
      await this.auditUsingTransaction(transaction).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: COMMISSIONS_AUDIT_ACTION.RULE_UPDATED,
        entityType: COMMISSIONS_RESOURCE_TYPE.RULE,
        entityId: updated.id,
        requestId: context.requestId,
        before: this.toRuleResponse(current),
        after: safe,
      });
      return safe;
    });
  }

  /** Returns an immutable seller statement only for the single seller scope authorized in this request. */
  async getSellerStatement(
    context: RequestContext,
    query: SellerCommissionStatementQuery,
  ): Promise<SellerCommissionStatementResult> {
    const sellerId = this.resolveSellerStatementScope(context);
    const [result, summaries] = await Promise.all([
      this.repository.listEntriesForSeller(sellerId, query),
      this.repository.summarizeEntriesForSeller(sellerId, query),
    ]);

    return {
      statement: {
        sellerId,
        summaries,
        entries: result.items.map((entry) => this.toEntryResponse(entry)),
      },
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists immutable Commission ledger rows for an authorized finance/admin actor. */
  async listAdminEntries(
    context: RequestContext,
    query: AdminCommissionEntryListQuery,
  ): Promise<PaginatedCommissionEntriesResult> {
    assertPermission(context, COMMISSIONS_PERMISSION.ADMIN_READ);
    const result = await this.repository.listAdminEntries(query);
    await this.audit.record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: COMMISSIONS_AUDIT_ACTION.FINANCE_READ,
      entityType: COMMISSIONS_RESOURCE_TYPE.ENTRY,
      requestId: context.requestId,
      metadata: { sellerId: query.sellerId ?? null, page: query.page, pageSize: query.pageSize },
    });
    return {
      items: result.items.map((entry) => this.toEntryResponse(entry)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Posts Commission sale entries exactly once after provider-authoritative capture. */
  async settleOrder(
    context: RequestContext,
    input: InternalCommissionOrderSettleInput,
  ): Promise<CommissionOrderSettleResult> {
    this.requireSystem(context);
    const idempotency = await this.beginCommandIdempotency(
      COMMISSION_IDEMPOTENCY_SCOPE.ORDER_SETTLE,
      input.sourceKey,
      sha256(`module16-order-settle-v1|${input.orderId}`),
    );
    if (idempotency.mode === "replay") {
      return commissionOrderSettleResultSchema.parse(idempotency.replay.responseBody);
    }

    try {
      const trusted = systemContext(context.requestId);
      const capture = await this.payments.getCommissionCapture(trusted, input.orderId);
      const order = await this.orders.getCommissionSnapshot(trusted, input.orderId);
      this.assertCaptureMatchesOrder(capture, order);
      const funding = await this.resolveOrderDiscountFunding(order);

      const response = await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const transactionOrders = this.ordersUsingTransaction(transaction);
        const lockedOrder = await transactionOrders.getCommissionSnapshot(trusted, input.orderId);
        this.assertCaptureMatchesOrder(capture, lockedOrder);
        const entryIds: string[] = [];

        for (const item of lockedOrder.items) {
          if (item.cancelledQuantity > 0) {
            throw commissionsError(
              COMMISSIONS_ERROR_CODE.RULE_INVALID,
              "Pre-capture cancelled quantities require an explicit Commission allocation contract.",
              409,
            );
          }
          const productScope = await this.products.resolveProductCommissionScope(item.productId);
          if (!productScope || productScope.sellerId !== item.sellerId) {
            throw commissionsError(
              COMMISSIONS_ERROR_CODE.RULE_INVALID,
              "Commission Product classification is unavailable or inconsistent.",
              409,
            );
          }
          const snapshot = await this.getOrCreateRuleSnapshot(
            repository,
            item,
            productScope.categoryId,
            capture.capturedAt,
            funding,
            lockedOrder.orderId,
          );
          const basis = readBasis(snapshot);
          const amounts = this.calculateSaleAmounts(item, snapshot, basis.sellerFundedDiscountAmount);
          const sourceKey = this.itemSourceKey("sale", capture.paymentTransactionId, item.orderItemId);
          const existing = await repository.findEntryBySourceKey(sourceKey);
          const expected: CreateCommissionEntryRecordInput = {
            sellerId: item.sellerId,
            sellerOrderId: item.sellerOrderId,
            orderItemId: item.orderItemId,
            type: COMMISSION_ENTRY_TYPE.SALE,
            grossAmount: amounts.grossAmount,
            commissionAmount: amounts.commissionAmount,
            sellerNetAmount: amounts.sellerNetAmount,
            currency: lockedOrder.currency,
            sourceKey,
            occurredAt: new Date(capture.capturedAt),
          };
          if (existing) {
            this.assertEntryMatchesReplay(existing, expected);
            entryIds.push(existing.id);
            continue;
          }
          const created = await repository.createEntryIfMissing(expected);
          const persisted = created ?? (await repository.findEntryBySourceKey(sourceKey));
          if (!persisted) {
            throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission entry could not be persisted.", 500);
          }
          this.assertEntryMatchesReplay(persisted, expected);
          entryIds.push(persisted.id);
          if (created) {
            await this.outboxUsingTransaction(transaction).enqueue({
              eventType: COMMISSIONS_OUTBOX_EVENT.POSTED,
              aggregateType: COMMISSIONS_RESOURCE_TYPE.ENTRY,
              aggregateId: created.id,
              payload: {
                commissionEntryId: created.id,
                orderId: lockedOrder.orderId,
                sellerId: created.sellerId,
                sellerOrderId: created.sellerOrderId,
                orderItemId: created.orderItemId,
                currency: created.currency,
                grossAmount: created.grossAmount,
                commissionAmount: created.commissionAmount,
                sellerNetAmount: created.sellerNetAmount,
                paymentId: capture.paymentId,
                paymentTransactionId: capture.paymentTransactionId,
              },
            });
          }
        }

        await this.auditUsingTransaction(transaction).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: COMMISSIONS_AUDIT_ACTION.ORDER_SETTLED,
          entityType: COMMISSIONS_RESOURCE_TYPE.ORDER,
          entityId: lockedOrder.orderId,
          requestId: context.requestId,
          metadata: {
            sourceKeyHash: sha256(input.sourceKey.trim()),
            paymentId: capture.paymentId,
            paymentTransactionId: capture.paymentTransactionId,
            entryIds,
          },
        });
        return { orderId: lockedOrder.orderId, entryIds };
      });

      await this.idempotency.complete(idempotency.recordId, 200, response);
      return response;
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Reverses cumulative item-level sale economics for one provider-authoritative partial Return refund. */
  async adjustPartialRefund(
    context: RequestContext,
    input: InternalCommissionPartialRefundAdjustInput,
  ): Promise<CommissionRefundAdjustResult> {
    this.requireSystem(context);
    const normalizedItems = [...input.items].sort((left, right) =>
      left.orderItemId.localeCompare(right.orderItemId),
    );
    const idempotency = await this.beginCommandIdempotency(
      COMMISSION_IDEMPOTENCY_SCOPE.REFUND_ADJUST,
      input.sourceKey,
      sha256(
        `module16-partial-refund-adjust-v1|${input.orderId}|${input.refundPaymentTransactionId}|${JSON.stringify(normalizedItems)}`,
      ),
    );
    if (idempotency.mode === "replay") {
      return commissionRefundAdjustResultSchema.parse(
        idempotency.replay.responseBody,
      );
    }

    try {
      const trusted = systemContext(context.requestId);
      const refund = await this.payments.getCommissionRefund(
        trusted,
        input.orderId,
        input.refundPaymentTransactionId,
      );
      const order = await this.orders.getCommissionSnapshot(
        trusted,
        input.orderId,
      );
      this.assertPartialRefundAllocation(order, refund, normalizedItems);

      const response = await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const entryIds: string[] = [];

        for (const requestedItem of normalizedItems) {
          entryIds.push(
            await this.applyPartialRefundItem(
              transaction,
              repository,
              input.orderId,
              order,
              refund,
              requestedItem,
            ),
          );
        }

        await this.auditUsingTransaction(transaction).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: COMMISSIONS_AUDIT_ACTION.REFUND_ADJUSTED,
          entityType: COMMISSIONS_RESOURCE_TYPE.ORDER,
          entityId: input.orderId,
          requestId: context.requestId,
          metadata: {
            sourceKeyHash: sha256(input.sourceKey.trim()),
            refundPaymentTransactionId: refund.paymentTransactionId,
            partial: true,
            entryIds,
          },
        });
        return {
          orderId: input.orderId,
          refundPaymentTransactionId: refund.paymentTransactionId,
          entryIds,
        };
      });

      await this.idempotency.complete(idempotency.recordId, 200, response);
      return response;
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Verifies the item allocation reconciles with the immutable Order and provider refund. */
  private assertPartialRefundAllocation(
    order: OrderCommissionSnapshot,
    refund: CommissionPaymentRefundSnapshot,
    items: InternalCommissionPartialRefundAdjustInput["items"],
  ): void {
    if (order.currency !== refund.currency) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Refund currency does not match Order currency.",
        409,
      );
    }

    const requestedRefundTotal = items.reduce(
      (total, item) => total + moneyToScale4(item.currentRefundAmount),
      0n,
    );
    if (requestedRefundTotal !== moneyToScale4(refund.refundAmount)) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Partial Commission allocation does not reconcile to the provider refund amount.",
        409,
      );
    }
  }

  /** Calculates one refund delta from the cumulative target and immutable prior reversals. */
  private calculateCurrentReversal(
    saleValue: string,
    priorRefunds: CommissionEntryRow[],
    readValue: (entry: CommissionEntryRow) => string,
    cumulativeRefundQuantity: number,
    commercialQuantity: number,
  ): bigint {
    const original = moneyToScale4(saleValue);
    const cumulativeTarget = allocateSignedComponent(
      saleValue,
      cumulativeRefundQuantity,
      commercialQuantity,
    );
    const priorReversal = priorRefunds.reduce(
      (total, entry) => total - moneyToScale4(readValue(entry)),
      0n,
    );
    const current = cumulativeTarget - priorReversal;
    if (!reversalDeltaIsForward(original, current)) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Partial Commission cumulative target is behind existing refund history.",
        409,
      );
    }
    return current;
  }

  /** Validates one requested item against the immutable Order and returns its commercial quantity. */
  private getPartialRefundOrderItem(
    order: OrderCommissionSnapshot,
    requestedItem: InternalCommissionPartialRefundAdjustInput["items"][number],
  ): { orderItem: OrderCommissionItemSnapshot; commercialQuantity: number } {
    const orderItem = order.items.find(
      (candidate) => candidate.orderItemId === requestedItem.orderItemId,
    );
    if (!orderItem) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Partial Commission allocation contains an Order Item outside the requested Order.",
        409,
      );
    }

    const commercialQuantity = orderItem.quantity - orderItem.cancelledQuantity;
    if (
      commercialQuantity <= 0 ||
      requestedItem.currentRefundQuantity > requestedItem.cumulativeRefundQuantity ||
      requestedItem.cumulativeRefundQuantity > commercialQuantity
    ) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Partial Commission refund quantity is inconsistent with the immutable Order Item.",
        409,
      );
    }

    return { orderItem, commercialQuantity };
  }

  /** Loads the single original sale entry plus all prior refund reversals for one Order Item. */
  private async getPartialRefundHistory(
    repository: CommissionsRepository,
    orderItemId: string,
  ): Promise<{ sale: CommissionEntryRow; priorRefunds: CommissionEntryRow[] }> {
    const history = await repository.listEntriesByOrderItemId(orderItemId);
    const sales = history.filter(
      (entry) => entry.type === COMMISSION_ENTRY_TYPE.SALE,
    );
    if (sales.length !== 1) {
      throw commissionsError(
        ERROR_CODE.INTERNAL_ERROR,
        "Commission sale history is not unique for this Order Item.",
        500,
      );
    }

    return {
      sale: sales[0] as CommissionEntryRow,
      priorRefunds: history.filter(
        (entry) => entry.type === COMMISSION_ENTRY_TYPE.REFUND,
      ),
    };
  }

  /** Builds the exact item-level refund entry from cumulative quantity and immutable Commission history. */
  private buildPartialRefundEntry(
    sale: CommissionEntryRow,
    priorRefunds: CommissionEntryRow[],
    requestedItem: InternalCommissionPartialRefundAdjustInput["items"][number],
    commercialQuantity: number,
    refund: CommissionPaymentRefundSnapshot,
  ): CreateCommissionEntryRecordInput {
    const grossReversal = this.calculateCurrentReversal(
      sale.grossAmount,
      priorRefunds,
      (entry) => entry.grossAmount,
      requestedItem.cumulativeRefundQuantity,
      commercialQuantity,
    );
    const commissionReversal = this.calculateCurrentReversal(
      sale.commissionAmount,
      priorRefunds,
      (entry) => entry.commissionAmount,
      requestedItem.cumulativeRefundQuantity,
      commercialQuantity,
    );
    const sellerNetReversal = this.calculateCurrentReversal(
      sale.sellerNetAmount,
      priorRefunds,
      (entry) => entry.sellerNetAmount,
      requestedItem.cumulativeRefundQuantity,
      commercialQuantity,
    );

    return {
      sellerId: sale.sellerId,
      sellerOrderId: sale.sellerOrderId,
      orderItemId: sale.orderItemId,
      type: COMMISSION_ENTRY_TYPE.REFUND,
      grossAmount: scale4ToMoney(-grossReversal),
      commissionAmount: scale4ToMoney(-commissionReversal),
      sellerNetAmount: scale4ToMoney(-sellerNetReversal),
      currency: sale.currency,
      sourceKey: this.itemSourceKey(
        "refund",
        refund.paymentTransactionId,
        sale.orderItemId,
      ),
      occurredAt: new Date(refund.refundedAt),
    };
  }

  /** Persists or replays one partial-refund entry and emits its durable adjustment event once. */
  private async persistPartialRefundEntry(
    transaction: DatabaseTransaction,
    repository: CommissionsRepository,
    orderId: string,
    refund: CommissionPaymentRefundSnapshot,
    requestedItem: InternalCommissionPartialRefundAdjustInput["items"][number],
    expected: CreateCommissionEntryRecordInput,
  ): Promise<string> {
    const existing = await repository.findEntryBySourceKey(expected.sourceKey);
    if (existing) {
      this.assertEntryMatchesReplay(existing, expected);
      return existing.id;
    }

    const created = await repository.createEntryIfMissing(expected);
    const persisted =
      created ?? (await repository.findEntryBySourceKey(expected.sourceKey));
    if (!persisted) {
      throw commissionsError(
        ERROR_CODE.INTERNAL_ERROR,
        "Partial Commission refund entry could not be persisted.",
        500,
      );
    }
    this.assertEntryMatchesReplay(persisted, expected);

    if (created) {
      await this.outboxUsingTransaction(transaction).enqueue({
        eventType: COMMISSIONS_OUTBOX_EVENT.ADJUSTED,
        aggregateType: COMMISSIONS_RESOURCE_TYPE.ENTRY,
        aggregateId: created.id,
        payload: {
          commissionEntryId: created.id,
          orderId,
          sellerId: created.sellerId,
          sellerOrderId: created.sellerOrderId,
          orderItemId: created.orderItemId,
          currency: created.currency,
          grossAmount: created.grossAmount,
          commissionAmount: created.commissionAmount,
          sellerNetAmount: created.sellerNetAmount,
          refundPaymentTransactionId: refund.paymentTransactionId,
          currentRefundQuantity: requestedItem.currentRefundQuantity,
          cumulativeRefundQuantity: requestedItem.cumulativeRefundQuantity,
        },
      });
    }

    return persisted.id;
  }

  /** Creates or safely replays one item-level partial refund Commission entry. */
  private async applyPartialRefundItem(
    transaction: DatabaseTransaction,
    repository: CommissionsRepository,
    orderId: string,
    order: OrderCommissionSnapshot,
    refund: CommissionPaymentRefundSnapshot,
    requestedItem: InternalCommissionPartialRefundAdjustInput["items"][number],
  ): Promise<string> {
    const { orderItem, commercialQuantity } = this.getPartialRefundOrderItem(
      order,
      requestedItem,
    );
    const { sale, priorRefunds } = await this.getPartialRefundHistory(
      repository,
      orderItem.orderItemId,
    );
    const expected = this.buildPartialRefundEntry(
      sale,
      priorRefunds,
      requestedItem,
      commercialQuantity,
      refund,
    );
    return this.persistPartialRefundEntry(
      transaction,
      repository,
      orderId,
      refund,
      requestedItem,
      expected,
    );
  }

  /** Reverses original sale economics for one full provider-authoritative refund without rewriting history. */
  async adjustRefund(
    context: RequestContext,
    input: InternalCommissionRefundAdjustInput,
  ): Promise<CommissionRefundAdjustResult> {
    this.requireSystem(context);
    const idempotency = await this.beginCommandIdempotency(
      COMMISSION_IDEMPOTENCY_SCOPE.REFUND_ADJUST,
      input.sourceKey,
      sha256(
        `module16-refund-adjust-v1|${input.orderId}|${input.refundPaymentTransactionId}`,
      ),
    );
    if (idempotency.mode === "replay") {
      return commissionRefundAdjustResultSchema.parse(idempotency.replay.responseBody);
    }

    try {
      const trusted = systemContext(context.requestId);
      const refund = await this.payments.getCommissionRefund(
        trusted,
        input.orderId,
        input.refundPaymentTransactionId,
      );
      if (refund.refundAmount !== refund.capturedAmount) {
        throw commissionsError(
          COMMISSIONS_ERROR_CODE.RULE_INVALID,
          "Partial refund Commission allocation requires Module 14 item eligibility and is not inferred here.",
          409,
        );
      }
      const order = await this.orders.getCommissionSnapshot(trusted, input.orderId);
      if (order.currency !== refund.currency) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Refund currency does not match Order currency.", 409);
      }

      const response = await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const entryIds: string[] = [];

        for (const item of order.items) {
          const history = await repository.listEntriesByOrderItemId(item.orderItemId);
          const sales = history.filter((entry) => entry.type === COMMISSION_ENTRY_TYPE.SALE);
          if (sales.length === 0) continue;
          if (sales.length !== 1) {
            throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission sale history is not unique for this Order Item.", 500);
          }
          const sale = sales[0] as CommissionEntryRow;
          const sourceKey = this.itemSourceKey("refund", refund.paymentTransactionId, item.orderItemId);
          const expected: CreateCommissionEntryRecordInput = {
            sellerId: sale.sellerId,
            sellerOrderId: sale.sellerOrderId,
            orderItemId: sale.orderItemId,
            type: COMMISSION_ENTRY_TYPE.REFUND,
            grossAmount: scale4ToMoney(-moneyToScale4(sale.grossAmount)),
            commissionAmount: scale4ToMoney(-moneyToScale4(sale.commissionAmount)),
            sellerNetAmount: scale4ToMoney(-moneyToScale4(sale.sellerNetAmount)),
            currency: sale.currency,
            sourceKey,
            occurredAt: new Date(refund.refundedAt),
          };
          const existing = await repository.findEntryBySourceKey(sourceKey);
          if (existing) {
            this.assertEntryMatchesReplay(existing, expected);
            entryIds.push(existing.id);
            continue;
          }
          const created = await repository.createEntryIfMissing(expected);
          const persisted = created ?? (await repository.findEntryBySourceKey(sourceKey));
          if (!persisted) {
            throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission refund entry could not be persisted.", 500);
          }
          this.assertEntryMatchesReplay(persisted, expected);
          entryIds.push(persisted.id);
          if (created) {
            await this.outboxUsingTransaction(transaction).enqueue({
              eventType: COMMISSIONS_OUTBOX_EVENT.ADJUSTED,
              aggregateType: COMMISSIONS_RESOURCE_TYPE.ENTRY,
              aggregateId: created.id,
              payload: {
                commissionEntryId: created.id,
                orderId: input.orderId,
                sellerId: created.sellerId,
                sellerOrderId: created.sellerOrderId,
                orderItemId: created.orderItemId,
                currency: created.currency,
                grossAmount: created.grossAmount,
                commissionAmount: created.commissionAmount,
                sellerNetAmount: created.sellerNetAmount,
                refundPaymentTransactionId: refund.paymentTransactionId,
              },
            });
          }
        }

        await this.auditUsingTransaction(transaction).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: COMMISSIONS_AUDIT_ACTION.REFUND_ADJUSTED,
          entityType: COMMISSIONS_RESOURCE_TYPE.ORDER,
          entityId: input.orderId,
          requestId: context.requestId,
          metadata: {
            sourceKeyHash: sha256(input.sourceKey.trim()),
            refundPaymentTransactionId: refund.paymentTransactionId,
            entryIds,
          },
        });
        return {
          orderId: input.orderId,
          refundPaymentTransactionId: refund.paymentTransactionId,
          entryIds,
        };
      });

      await this.idempotency.complete(idempotency.recordId, 200, response);
      return response;
    } catch (error) {
      await this.failIdempotencySafely(idempotency.recordId);
      throw error;
    }
  }

  /** Acquires one normalized trusted source key through the Foundation idempotency service. */
  private async beginCommandIdempotency(
    scope: string,
    sourceKey: string,
    requestHash: string,
  ): Promise<BeginIdempotentOperationResult> {
    const key = sourceKey.trim();
    if (!key) {
      throw commissionsError(ERROR_CODE.VALIDATION_FAILED, "Commission sourceKey is required.", 422);
    }
    return this.idempotency.begin({ scope, key, requestHash }, this.now());
  }

  /** Marks one acquired Foundation idempotency key failed without hiding the original business error. */
  private async failIdempotencySafely(recordId: string): Promise<void> {
    await this.idempotency.fail(recordId).catch(() => undefined);
  }

  /** Resolves the historical funding owner for the Order discount while refusing mutable inference. */
  private async resolveOrderDiscountFunding(
    order: OrderCommissionSnapshot,
  ): Promise<CheckoutPromotionEvaluationResult["fundingType"] | null> {
    const hasDiscount = order.items.some((item) => moneyToScale4(item.discountAllocated) > 0n);
    if (!hasDiscount) return null;
    if (!order.couponCode) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Discount funding provenance is missing from the immutable Checkout history.",
        409,
      );
    }
    const funding = await this.promotions.resolveHistoricalCouponFunding(order.couponCode);
    if (!funding) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Historical Promotion funding provenance could not be resolved.",
        409,
      );
    }
    return funding.fundingType;
  }

  /** Creates the immutable rule snapshot once, using explicit priority and calculation policy. */
  private async getOrCreateRuleSnapshot(
    repository: CommissionsRepository,
    item: OrderCommissionItemSnapshot,
    categoryId: string,
    capturedAt: string,
    fundingType: CheckoutPromotionEvaluationResult["fundingType"] | null,
    orderId: string,
  ): Promise<CommissionRuleSnapshotRow> {
    const existing = await repository.findSnapshotByOrderItemId(item.orderItemId);
    if (existing) return existing;

    const candidates = await repository.findApplicableRuleCandidates({
      effectiveAt: new Date(capturedAt),
      status: COMMISSION_RULE_ACTIVE_STATUS,
      sellerId: item.sellerId,
      categoryId,
      productId: item.productId,
    });
    const rule = this.resolveRule(candidates);
    const gross = moneyToScale4(item.unitPrice) * BigInt(item.quantity);
    const discount = moneyToScale4(item.discountAllocated);
    const sellerFundedDiscount =
      fundingType === PROMOTION_FUNDING_TYPE.SELLER ? discount : 0n;
    const commissionableBasis = gross - sellerFundedDiscount;
    if (commissionableBasis < 0n) {
      throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission basis cannot be negative.", 409);
    }

    const input: CreateCommissionRuleSnapshotRecordInput = {
      orderItemId: item.orderItemId,
      ruleId: rule?.id ?? null,
      ratePercent: rule?.ratePercent ?? "0.000000",
      fixedFee: rule?.fixedFee ?? null,
      basisJson: {
        version: COMMISSION_CALCULATION_POLICY.SNAPSHOT_VERSION,
        orderId,
        sellerId: item.sellerId,
        sellerOrderId: item.sellerOrderId,
        productId: item.productId,
        categoryId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        grossAmount: scale4ToMoney(gross),
        discountAllocated: item.discountAllocated,
        discountFundingType: fundingType,
        sellerFundedDiscountAmount: scale4ToMoney(sellerFundedDiscount),
        commissionableBasis: scale4ToMoney(commissionableBasis),
        shippingCreditAmount: COMMISSION_CALCULATION_POLICY.SHIPPING_CREDIT_AMOUNT,
        fixedFeeApplication: COMMISSION_CALCULATION_POLICY.FIXED_FEE_UNIT,
        rounding: COMMISSION_CALCULATION_POLICY.ROUNDING,
        priorityDirection: COMMISSION_CALCULATION_POLICY.PRIORITY_DIRECTION,
        fundingRulesJson: rule?.fundingRulesJson ?? null,
      },
    };
    const created = await repository.createRuleSnapshotIfMissing(input);
    const persisted = created ?? (await repository.findSnapshotByOrderItemId(item.orderItemId));
    if (!persisted) {
      throw commissionsError(ERROR_CODE.INTERNAL_ERROR, "Commission rule snapshot could not be persisted.", 500);
    }
    return persisted;
  }

  /** Selects the unique highest numeric priority rule and rejects equal-priority ambiguity. */
  private resolveRule(candidates: CommissionRuleRow[]): CommissionRuleRow | null {
    if (candidates.length === 0) return null;
    const highestPriority = Math.max(...candidates.map((candidate) => candidate.priority));
    const winners = candidates.filter((candidate) => candidate.priority === highestPriority);
    if (winners.length !== 1) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_AMBIGUOUS,
        "Multiple effective Commission rules share the winning priority.",
        409,
      );
    }
    return winners[0] ?? null;
  }

  /** Calculates exact sale gross, Commission, and seller-net values from the immutable snapshot. */
  private calculateSaleAmounts(
    item: OrderCommissionItemSnapshot,
    snapshot: CommissionRuleSnapshotRow,
    sellerFundedDiscountAmount: string,
  ): { grossAmount: string; commissionAmount: string; sellerNetAmount: string } {
    const grossAmount = moneyToScale4(item.unitPrice) * BigInt(item.quantity);
    const sellerFundedDiscount = moneyToScale4(sellerFundedDiscountAmount);
    const commissionableBasis = grossAmount - sellerFundedDiscount;

    if (commissionableBasis < 0n) {
      throw commissionsError(
        ERROR_CODE.INTERNAL_ERROR,
        "Stored Commission snapshot produces a negative Commission basis.",
        500,
      );
    }

    const percentageFee = divideHalfUp(
      commissionableBasis * rateToScale6(snapshot.ratePercent),
      PERCENT_DIVISOR,
    );
    const fixedFee = snapshot.fixedFee ? moneyToScale4(snapshot.fixedFee) : 0n;
    const commissionAmount = percentageFee + fixedFee;
    const shippingCredit = moneyToScale4(COMMISSION_CALCULATION_POLICY.SHIPPING_CREDIT_AMOUNT);
    const sellerNetAmount =
      grossAmount - sellerFundedDiscount - commissionAmount + shippingCredit;

    return {
      grossAmount: scale4ToMoney(grossAmount),
      commissionAmount: scale4ToMoney(commissionAmount),
      sellerNetAmount: scale4ToMoney(sellerNetAmount),
    };
  }

  /** Prevents a same-scope equal-priority effective overlap that would be ambiguous by configuration. */
  private async assertNoEqualPriorityOverlap(
    repository: CommissionsRepository,
    input: {
      priority: number;
      scopeType: CreateCommissionRuleInput["scopeType"];
      scopeId: string | null;
      status: CommissionRuleRow["status"];
      startAt: Date;
      endAt: Date | null;
      excludeRuleId?: string;
    },
  ): Promise<void> {
    if (input.status !== COMMISSION_RULE_ACTIVE_STATUS) return;
    const overlaps = await repository.findOverlappingRulesForScope(input);
    if (overlaps.length > 0) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_AMBIGUOUS,
        "An equal-priority active Commission rule already overlaps this scope and date range.",
        409,
      );
    }
  }

  /** Validates polymorphic rule targets through owning module service boundaries instead of direct repositories. */
  private async assertRuleScopeExists(
    scopeType: CreateCommissionRuleInput["scopeType"],
    scopeId: string | null,
  ): Promise<void> {
    if (scopeType === "default") {
      if (scopeId !== null) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Default rule scope must not have an ID.", 422);
      }
      return;
    }
    if (!scopeId) {
      throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Scoped Commission rule requires a target ID.", 422);
    }
    if (scopeType === "seller") {
      try {
        await this.sellers.assertSellerCommerceEligible(scopeId);
      } catch {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission seller scope is invalid.", 422);
      }
      return;
    }
    if (scopeType === "product") {
      if (!(await this.products.resolveProductCommissionScope(scopeId))) {
        throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission Product scope is invalid.", 422);
      }
      return;
    }
    const categories = await this.catalog.listCategories(null);
    if (!categoryTreeContains(categories, scopeId)) {
      throw commissionsError(COMMISSIONS_ERROR_CODE.RULE_INVALID, "Commission category scope is invalid.", 422);
    }
  }

  /** Verifies the provider capture and immutable Order agree before any Commission row is posted. */
  private assertCaptureMatchesOrder(
    capture: CommissionPaymentCaptureSnapshot,
    order: OrderCommissionSnapshot,
  ): void {
    if (
      capture.orderId !== order.orderId ||
      capture.currency !== order.currency ||
      capture.capturedAmount !== order.grandTotal ||
      order.paymentStatus !== ORDER_PAYMENT_STATUS.CAPTURED
    ) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.RULE_INVALID,
        "Order and provider-authoritative Payment state do not reconcile for Commission settlement.",
        409,
      );
    }
  }

  /** Returns the single seller scope that carries seller.commissions.read for the current route context. */
  private resolveSellerStatementScope(context: RequestContext): string {
    if (context.actorType !== ACTOR_TYPE.SELLER) {
      throw commissionsError(COMMISSIONS_ERROR_CODE.SCOPE_FORBIDDEN, "Seller Commission scope is required.", 403);
    }
    const sellerIds = [...context.sellerIds].filter((sellerId) =>
      context.sellerPermissions.get(sellerId)?.has(COMMISSIONS_PERMISSION.SELLER_READ),
    );
    if (sellerIds.length !== 1) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.SCOPE_FORBIDDEN,
        "Exactly one authorized seller scope is required for this Commission statement.",
        403,
      );
    }
    return sellerIds[0] as string;
  }

  /** Enforces the trusted internal-service identity on settlement/refund commands. */
  private requireSystem(context: RequestContext): void {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw commissionsError(ERROR_CODE.FORBIDDEN, "Internal Commission command access is required.", 403);
    }
  }

  /** Builds one bounded item-level source key from the authoritative Payment transaction identity. */
  private itemSourceKey(
    kind: "sale" | "refund",
    paymentTransactionId: string,
    orderItemId: string,
  ): string {
    return `commission:${kind}:${paymentTransactionId}:${orderItemId}`;
  }

  /** Rejects a source-key collision whose immutable ledger values do not match the original request. */
  private assertEntryMatchesReplay(
    row: CommissionEntryRow,
    expected: CreateCommissionEntryRecordInput,
  ): void {
    if (
      row.sellerId !== expected.sellerId ||
      row.sellerOrderId !== expected.sellerOrderId ||
      row.orderItemId !== expected.orderItemId ||
      row.type !== expected.type ||
      row.grossAmount !== expected.grossAmount ||
      row.commissionAmount !== expected.commissionAmount ||
      row.sellerNetAmount !== expected.sellerNetAmount ||
      row.currency !== expected.currency ||
      row.occurredAt.getTime() !== expected.occurredAt.getTime()
    ) {
      throw commissionsError(
        COMMISSIONS_ERROR_CODE.SOURCE_DUPLICATE,
        "Commission source key already belongs to different immutable economics.",
        409,
      );
    }
  }

  /** Maps one persisted Commission rule into the safe API contract. */
  private toRuleResponse(row: CommissionRuleRow): CommissionRuleResponse {
    return {
      id: row.id,
      priority: row.priority,
      scopeType: row.scopeType as CommissionRuleResponse["scopeType"],
      scopeId: row.scopeId,
      ratePercent: row.ratePercent,
      fixedFee: row.fixedFee,
      fundingRulesJson: row.fundingRulesJson,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt?.toISOString() ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Maps one immutable Commission entry without exposing its internal source key. */
  private toEntryResponse(row: CommissionEntryRow): CommissionEntryResponse {
    return {
      id: row.id,
      sellerId: row.sellerId,
      sellerOrderId: row.sellerOrderId,
      orderItemId: row.orderItemId,
      type: row.type as CommissionEntryResponse["type"],
      grossAmount: row.grossAmount,
      commissionAmount: row.commissionAmount,
      sellerNetAmount: row.sellerNetAmount,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

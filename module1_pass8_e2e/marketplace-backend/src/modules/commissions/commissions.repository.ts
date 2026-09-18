import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lte,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import {
  commissionEntries,
  commissionRules,
  commissionRuleSnapshots,
  type CommissionEntryRow,
  type CommissionRuleRow,
  type CommissionRuleSnapshotRow,
  type NewCommissionEntryRow,
  type NewCommissionRuleRow,
  type NewCommissionRuleSnapshotRow,
} from "../../database/schema/commissions.js";
import { sellerOrders } from "../../database/schema/orders.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { COMMISSION_RULE_SCOPE_TYPE } from "./commissions.constants.js";
import type {
  AdminCommissionEntryListQuery,
  AdminCommissionRuleListQuery,
  CommissionEntryType,
  CommissionRuleScopeType,
  SellerCommissionStatementQuery,
} from "./commissions.schema.js";

/** Fields already validated and normalized by the service before a Commission rule is persisted. */
export interface CreateCommissionRuleRecordInput {
  priority: number;
  scopeType: CommissionRuleScopeType;
  scopeId: string | null;
  ratePercent: string;
  fixedFee: string | null;
  fundingRulesJson: unknown | null;
  startAt: Date;
  endAt: Date | null;
  status: CommissionRuleRow["status"];
}

/** Service-approved Commission rule fields that may be changed by a future-effective update. */
export interface UpdateCommissionRuleRecordInput {
  priority?: number;
  scopeType?: CommissionRuleScopeType;
  scopeId?: string | null;
  ratePercent?: string;
  fixedFee?: string | null;
  fundingRulesJson?: unknown | null;
  startAt?: Date;
  endAt?: Date | null;
  status?: CommissionRuleRow["status"];
  updatedAt?: Date;
}

/** Scope identities used only to fetch possible rules; the service still decides whether a candidate wins. */
export interface FindCommissionRuleCandidatesInput {
  effectiveAt: Date;
  status: CommissionRuleRow["status"];
  sellerId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
}

/** Same-scope effective range used by the service to prevent equal-priority configuration ambiguity. */
export interface FindOverlappingCommissionRulesInput {
  scopeType: CommissionRuleScopeType;
  scopeId: string | null;
  priority: number;
  status: CommissionRuleRow["status"];
  startAt: Date;
  endAt: Date | null;
  excludeRuleId?: string;
}

/** Immutable rule facts already calculated/selected by the service for one Order Item. */
export interface CreateCommissionRuleSnapshotRecordInput {
  orderItemId: string;
  ruleId: string | null;
  ratePercent: string;
  fixedFee: string | null;
  basisJson: unknown;
}

/** One append-only Commission ledger row whose amounts were calculated by the service. */
export interface CreateCommissionEntryRecordInput {
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  type: CommissionEntryType;
  grossAmount: string;
  commissionAmount: string;
  sellerNetAmount: string;
  currency: string;
  sourceKey: string;
  occurredAt: Date;
}

/** Bounded Commission rule page returned to the service layer. */
export interface PaginatedCommissionRuleRows {
  items: CommissionRuleRow[];
  totalItems: number;
}

/** Bounded immutable Commission-entry page returned to the service layer. */
export interface PaginatedCommissionEntryRows {
  items: CommissionEntryRow[];
  totalItems: number;
}

export interface CommissionWalletEntrySourceRow {
  entry: CommissionEntryRow;
  orderId: string;
}


/** Exact per-currency seller statement totals calculated by PostgreSQL over the full filtered result. */
export interface SellerCommissionSummaryRow {
  currency: string;
  grossAmount: string;
  sellerFundedDiscountAmount: string;
  commissionAmount: string;
  refundAdjustmentAmount: string;
  sellerNetAmount: string;
}

/** Combines only predicates that are present so optional filters stay readable. */
function combineConditions(conditions: Array<SQL | undefined>): SQL | undefined {
  const active = conditions.filter((condition): condition is SQL => Boolean(condition));
  return active.length > 0 ? and(...active) : undefined;
}

/** Builds deterministic admin rule ordering from the validated allow-listed sort contract. */
function adminRuleSort(query: AdminCommissionRuleListQuery): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "priority":
      return [direction(commissionRules.priority), asc(commissionRules.id)];
    case "startAt":
      return [direction(commissionRules.startAt), asc(commissionRules.id)];
    case "createdAt":
    default:
      return [direction(commissionRules.createdAt), asc(commissionRules.id)];
  }
}

/** Builds deterministic immutable-entry ordering from seller/admin validated filters. */
function entrySort(
  query: Pick<SellerCommissionStatementQuery, "sort" | "order">,
): SQL[] {
  const direction = query.order === "asc" ? asc : desc;

  switch (query.sort) {
    case "createdAt":
      return [direction(commissionEntries.createdAt), asc(commissionEntries.id)];
    case "occurredAt":
    default:
      return [direction(commissionEntries.occurredAt), asc(commissionEntries.id)];
  }
}

/** Builds the effective-date predicate shared by admin inspection and candidate reads. */
function effectiveAtCondition(effectiveAt: Date): SQL {
  return and(
    lte(commissionRules.startAt, effectiveAt),
    or(isNull(commissionRules.endAt), gt(commissionRules.endAt, effectiveAt)),
  ) as SQL;
}

/** Builds all scope predicates that may match an Order Item without choosing a precedence winner. */
function candidateScopeCondition(input: FindCommissionRuleCandidatesInput): SQL {
  const candidates: SQL[] = [
    and(
      eq(commissionRules.scopeType, COMMISSION_RULE_SCOPE_TYPE.DEFAULT),
      isNull(commissionRules.scopeId),
    ) as SQL,
  ];

  if (input.sellerId) {
    candidates.push(
      and(
        eq(commissionRules.scopeType, COMMISSION_RULE_SCOPE_TYPE.SELLER),
        eq(commissionRules.scopeId, input.sellerId),
      ) as SQL,
    );
  }

  if (input.categoryId) {
    candidates.push(
      and(
        eq(commissionRules.scopeType, COMMISSION_RULE_SCOPE_TYPE.CATEGORY),
        eq(commissionRules.scopeId, input.categoryId),
      ) as SQL,
    );
  }

  if (input.productId) {
    candidates.push(
      and(
        eq(commissionRules.scopeType, COMMISSION_RULE_SCOPE_TYPE.PRODUCT),
        eq(commissionRules.scopeId, input.productId),
      ) as SQL,
    );
  }

  return or(...candidates) as SQL;
}

/**
 * Drizzle-only persistence boundary for Module 16 Commissions.
 * Rule precedence, fee arithmetic, funding decisions, idempotency policy, audit, and outbox stay in the service.
 */
export class CommissionsRepository {
  /** Creates a repository around the root database or a caller-supplied transaction executor. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns a repository bound to the caller's existing database transaction. */
  using(executor: DatabaseExecutor): CommissionsRepository {
    return new CommissionsRepository(executor);
  }

  /** Serializes same-scope/same-priority Commission rule configuration inside the caller transaction. */
  async lockRuleConfiguration(
    scopeType: CommissionRuleScopeType,
    scopeId: string | null,
    priority: number,
  ): Promise<void> {
    const lockKey = `commission-rule:${scopeType}:${scopeId ?? "default"}:${priority}`;
    await this.executor.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
  }

  /** Lists Commission rules for authorized finance/admin reads using bounded validated filters. */
  async listAdminRules(
    query: AdminCommissionRuleListQuery,
  ): Promise<PaginatedCommissionRuleRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.scopeType ? eq(commissionRules.scopeType, query.scopeType) : undefined,
      query.scopeId ? eq(commissionRules.scopeId, query.scopeId) : undefined,
      query.status ? eq(commissionRules.status, query.status) : undefined,
      query.effectiveAt
        ? effectiveAtCondition(new Date(query.effectiveAt))
        : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(commissionRules)
      .where(where)
      .orderBy(...adminRuleSort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(commissionRules)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Locks one Commission rule before a service-approved future-effective update. */
  async findRuleByIdForUpdate(ruleId: string): Promise<CommissionRuleRow | null> {
    const [row] = await this.executor
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.id, ruleId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Inserts one Commission rule after the service has validated its business lifecycle. */
  async createRule(input: CreateCommissionRuleRecordInput): Promise<CommissionRuleRow> {
    const values: NewCommissionRuleRow = input;
    const [row] = await this.executor.insert(commissionRules).values(values).returning();

    if (!row) {
      throw new Error("Commission rule insert completed without returning a row.");
    }

    return row;
  }

  /** Persists only fields already approved by the service and refreshes the rule update timestamp. */
  async updateRule(
    ruleId: string,
    input: UpdateCommissionRuleRecordInput,
  ): Promise<CommissionRuleRow | null> {
    const { updatedAt, ...changes } = input;
    const [row] = await this.executor
      .update(commissionRules)
      .set({ ...changes, updatedAt: updatedAt ?? new Date() })
      .where(eq(commissionRules.id, ruleId))
      .returning();

    return row ?? null;
  }

  /**
   * Returns every effective rule that could match the supplied Order Item identities.
   * The neutral deterministic order is for stable tests/debugging only; the service must resolve precedence.
   */
  async findApplicableRuleCandidates(
    input: FindCommissionRuleCandidatesInput,
  ): Promise<CommissionRuleRow[]> {
    return this.executor
      .select()
      .from(commissionRules)
      .where(
        and(
          eq(commissionRules.status, input.status),
          effectiveAtCondition(input.effectiveAt),
          candidateScopeCondition(input),
        ),
      )
      .orderBy(
        asc(commissionRules.scopeType),
        asc(commissionRules.scopeId),
        asc(commissionRules.startAt),
        asc(commissionRules.createdAt),
        asc(commissionRules.id),
      );
  }

  /** Returns same-scope/same-priority rules whose effective windows overlap the proposed rule window. */
  async findOverlappingRulesForScope(
    input: FindOverlappingCommissionRulesInput,
  ): Promise<CommissionRuleRow[]> {
    const scopeCondition =
      input.scopeId === null
        ? isNull(commissionRules.scopeId)
        : eq(commissionRules.scopeId, input.scopeId);
    const startsBeforeProposedEnd = input.endAt
      ? lt(commissionRules.startAt, input.endAt)
      : undefined;
    const proposedStartsBeforeExistingEnd = or(
      isNull(commissionRules.endAt),
      gt(commissionRules.endAt, input.startAt),
    );
    const where = combineConditions([
      eq(commissionRules.scopeType, input.scopeType),
      scopeCondition,
      eq(commissionRules.priority, input.priority),
      eq(commissionRules.status, input.status),
      startsBeforeProposedEnd,
      proposedStartsBeforeExistingEnd as SQL,
      input.excludeRuleId ? ne(commissionRules.id, input.excludeRuleId) : undefined,
    ]);

    return this.executor
      .select()
      .from(commissionRules)
      .where(where)
      .orderBy(asc(commissionRules.startAt), asc(commissionRules.id));
  }

  /** Reads the immutable Commission rule snapshot already attached to one Order Item. */
  async findSnapshotByOrderItemId(
    orderItemId: string,
  ): Promise<CommissionRuleSnapshotRow | null> {
    const [row] = await this.executor
      .select()
      .from(commissionRuleSnapshots)
      .where(eq(commissionRuleSnapshots.orderItemId, orderItemId))
      .limit(1);

    return row ?? null;
  }

  /**
   * Inserts one immutable Order Item rule snapshot, returning null when a concurrent request won the same snapshot race.
   */
  async createRuleSnapshotIfMissing(
    input: CreateCommissionRuleSnapshotRecordInput,
  ): Promise<CommissionRuleSnapshotRow | null> {
    const values: NewCommissionRuleSnapshotRow = input;
    const [row] = await this.executor
      .insert(commissionRuleSnapshots)
      .values(values)
      .onConflictDoNothing({ target: commissionRuleSnapshots.orderItemId })
      .returning();

    return row ?? null;
  }

  /** Reads one immutable Commission ledger row by its replay-safe source identity. */
  async findEntryBySourceKey(sourceKey: string): Promise<CommissionEntryRow | null> {
    const [row] = await this.executor
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.sourceKey, sourceKey))
      .limit(1);

    return row ?? null;
  }


  /** Reads one immutable Commission entry plus its parent Order ID for trusted Wallet source verification. */
  async findWalletEntrySourceById(
    commissionEntryId: string,
  ): Promise<CommissionWalletEntrySourceRow | null> {
    const [row] = await this.executor
      .select({
        entry: commissionEntries,
        orderId: sellerOrders.orderId,
      })
      .from(commissionEntries)
      .innerJoin(sellerOrders, eq(sellerOrders.id, commissionEntries.sellerOrderId))
      .where(eq(commissionEntries.id, commissionEntryId))
      .limit(1);

    return row ?? null;
  }

  /** Reads immutable Commission history for one Order Item in deterministic occurrence order. */
  async listEntriesByOrderItemId(orderItemId: string): Promise<CommissionEntryRow[]> {
    return this.executor
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.orderItemId, orderItemId))
      .orderBy(asc(commissionEntries.occurredAt), asc(commissionEntries.createdAt), asc(commissionEntries.id));
  }

  /**
   * Appends one service-calculated ledger row, returning null when the unique source key has already been persisted.
   */
  async createEntryIfMissing(
    input: CreateCommissionEntryRecordInput,
  ): Promise<CommissionEntryRow | null> {
    const values: NewCommissionEntryRow = input;
    const [row] = await this.executor
      .insert(commissionEntries)
      .values(values)
      .onConflictDoNothing({ target: commissionEntries.sourceKey })
      .returning();

    return row ?? null;
  }

  /** Lists immutable Commission entries only for the server-derived seller scope. */
  async listEntriesForSeller(
    sellerId: string,
    query: SellerCommissionStatementQuery,
  ): Promise<PaginatedCommissionEntryRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      eq(commissionEntries.sellerId, sellerId),
      query.type ? eq(commissionEntries.type, query.type) : undefined,
      query.sellerOrderId
        ? eq(commissionEntries.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.occurredFrom
        ? gte(commissionEntries.occurredAt, new Date(query.occurredFrom))
        : undefined,
      query.occurredTo
        ? lte(commissionEntries.occurredAt, new Date(query.occurredTo))
        : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(commissionEntries)
      .where(where)
      .orderBy(...entrySort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(commissionEntries)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }

  /** Aggregates the full filtered seller statement by currency without changing the paged entry list. */
  async summarizeEntriesForSeller(
    sellerId: string,
    query: SellerCommissionStatementQuery,
  ): Promise<SellerCommissionSummaryRow[]> {
    const where = combineConditions([
      eq(commissionEntries.sellerId, sellerId),
      query.type ? eq(commissionEntries.type, query.type) : undefined,
      query.sellerOrderId
        ? eq(commissionEntries.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.occurredFrom
        ? gte(commissionEntries.occurredAt, new Date(query.occurredFrom))
        : undefined,
      query.occurredTo
        ? lte(commissionEntries.occurredAt, new Date(query.occurredTo))
        : undefined,
    ]);

    return this.executor
      .select({
        currency: commissionEntries.currency,
        grossAmount: sql<string>`
          coalesce(
            sum(case when ${commissionEntries.type} = 'sale' then ${commissionEntries.grossAmount} else 0 end),
            0
          )::numeric(18,4)::text
        `,
        sellerFundedDiscountAmount: sql<string>`
          coalesce(
            sum(
              case
                when ${commissionEntries.type} = 'sale'
                then coalesce((${commissionRuleSnapshots.basisJson}->>'sellerFundedDiscountAmount')::numeric, 0)
                else 0
              end
            ),
            0
          )::numeric(18,4)::text
        `,
        commissionAmount: sql<string>`coalesce(sum(${commissionEntries.commissionAmount}), 0)::numeric(18,4)::text`,
        refundAdjustmentAmount: sql<string>`
          coalesce(
            sum(
              case
                when ${commissionEntries.type} <> 'sale' then ${commissionEntries.sellerNetAmount}
                else 0
              end
            ),
            0
          )::numeric(18,4)::text
        `,
        sellerNetAmount: sql<string>`coalesce(sum(${commissionEntries.sellerNetAmount}), 0)::numeric(18,4)::text`,
      })
      .from(commissionEntries)
      .leftJoin(
        commissionRuleSnapshots,
        eq(commissionRuleSnapshots.orderItemId, commissionEntries.orderItemId),
      )
      .where(where)
      .groupBy(commissionEntries.currency)
      .orderBy(asc(commissionEntries.currency));
  }

  /** Lists immutable Commission entries for authorized finance/admin reads with explicit optional seller filters. */
  async listAdminEntries(
    query: AdminCommissionEntryListQuery,
  ): Promise<PaginatedCommissionEntryRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = combineConditions([
      query.sellerId ? eq(commissionEntries.sellerId, query.sellerId) : undefined,
      query.sellerOrderId
        ? eq(commissionEntries.sellerOrderId, query.sellerOrderId)
        : undefined,
      query.orderItemId ? eq(commissionEntries.orderItemId, query.orderItemId) : undefined,
      query.type ? eq(commissionEntries.type, query.type) : undefined,
      query.currency ? eq(commissionEntries.currency, query.currency) : undefined,
      query.occurredFrom
        ? gte(commissionEntries.occurredAt, new Date(query.occurredFrom))
        : undefined,
      query.occurredTo
        ? lte(commissionEntries.occurredAt, new Date(query.occurredTo))
        : undefined,
    ]);

    const items = await this.executor
      .select()
      .from(commissionEntries)
      .where(where)
      .orderBy(...entrySort(query))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(commissionEntries)
      .where(where);

    return { items, totalItems: Number(totalRow?.totalItems ?? 0) };
  }
}

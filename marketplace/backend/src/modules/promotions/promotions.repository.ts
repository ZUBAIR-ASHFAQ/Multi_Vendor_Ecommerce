import { and, asc, count, eq, inArray } from "drizzle-orm";
import { toLimitOffset } from "../../common/utils/pagination.js";
import { db } from "../../database/db.js";
import {
  couponRedemptions,
  coupons,
  promotionScopes,
  promotions,
  type CouponRedemptionRow,
  type CouponRow,
  type NewCouponRedemptionRow,
  type NewCouponRow,
  type NewPromotionRow,
  type NewPromotionScopeRow,
  type PromotionRow,
  type PromotionScopeRow,
} from "../../database/schema/promotions.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { PROMOTION_OWNER_TYPE } from "./promotions.constants.js";
import type {
  AdminPromotionListQuery,
  SellerPromotionListQuery,
} from "./promotions.schema.js";

/** Promotion fields already authorized and derived by the service before insertion. */
export interface CreatePromotionRecordInput {
  ownerType: PromotionRow["ownerType"];
  sellerId: string | null;
  name: string;
  type: string;
  value: string;
  startAt: Date;
  endAt: Date;
  status: PromotionRow["status"];
  fundingType: PromotionRow["fundingType"];
}

/** Editable promotion fields that do not include ownership, funding, or lifecycle state. */
export interface UpdatePromotionRecordInput {
  name?: string;
  type?: string;
  value?: string;
  startAt?: Date;
  endAt?: Date;
}

/** One persisted eligibility target already validated by the Module 9 service. */
export interface PromotionScopeRecordInput {
  scopeType: PromotionScopeRow["scopeType"];
  scopeId: string;
}

/** Coupon values already normalized and validated before persistence. */
export interface CreateCouponRecordInput {
  promotionId: string;
  code: string;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  status?: CouponRow["status"];
}

/** Editable coupon fields already authorized by the Module 9 service. */
export interface UpdateCouponRecordInput {
  code?: string;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  status?: CouponRow["status"];
}

/** Immutable coupon-redemption values supplied by the future order-confirmation transaction. */
export interface CreateCouponRedemptionRecordInput {
  couponId: string;
  customerUserId: string;
  orderId: string;
  redeemedAt?: Date;
}

/** Paginated platform-owned promotions returned to the service layer. */
export interface PaginatedPromotionRows {
  items: PromotionRow[];
  totalItems: number;
}

/**
 * Persistence-only Module 9 repository.
 * Eligibility, seller ownership, lifecycle, usage limits, allocation, audit, and outbox decisions stay in the service.
 */
export class PromotionsRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Lists only platform-owned promotions using the validated bounded admin pagination contract. */
  async listPlatformPromotions(
    query: AdminPromotionListQuery,
  ): Promise<PaginatedPromotionRows> {
    const { limit, offset } = toLimitOffset(query);
    const where = eq(promotions.ownerType, PROMOTION_OWNER_TYPE.PLATFORM);

    const items = await this.executor
      .select()
      .from(promotions)
      .where(where)
      .orderBy(asc(promotions.startAt), asc(promotions.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(promotions)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Lists seller-owned promotions only for the server-derived seller IDs supplied by the service. */
  async listSellerPromotions(
    sellerIds: string[],
    query: SellerPromotionListQuery,
  ): Promise<PaginatedPromotionRows> {
    if (sellerIds.length === 0) return { items: [], totalItems: 0 };

    const { limit, offset } = toLimitOffset(query);
    const where = and(
      eq(promotions.ownerType, PROMOTION_OWNER_TYPE.SELLER),
      inArray(promotions.sellerId, sellerIds),
      query.status ? eq(promotions.status, query.status) : undefined,
    );

    const items = await this.executor
      .select()
      .from(promotions)
      .where(where)
      .orderBy(asc(promotions.startAt), asc(promotions.id))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.executor
      .select({ totalItems: count() })
      .from(promotions)
      .where(where);

    return {
      items,
      totalItems: Number(totalRow?.totalItems ?? 0),
    };
  }

  /** Reads one promotion by ID for trusted internal evaluation flows. */
  async findPromotionById(promotionId: string): Promise<PromotionRow | null> {
    const [row] = await this.executor
      .select()
      .from(promotions)
      .where(eq(promotions.id, promotionId))
      .limit(1);

    return row ?? null;
  }

  /** Locks one promotion by ID for an administrator lifecycle command regardless of funding owner. */
  async findPromotionByIdForUpdate(
    promotionId: string,
  ): Promise<PromotionRow | null> {
    const [row] = await this.executor
      .select()
      .from(promotions)
      .where(eq(promotions.id, promotionId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Locks one platform-owned promotion before an admin edit or lifecycle transition. */
  async findPlatformPromotionByIdForUpdate(
    promotionId: string,
  ): Promise<PromotionRow | null> {
    const [row] = await this.executor
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.id, promotionId),
          eq(promotions.ownerType, PROMOTION_OWNER_TYPE.PLATFORM),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Inserts one promotion after the service has derived ownership, funding, and initial state. */
  async createPromotion(input: CreatePromotionRecordInput): Promise<PromotionRow> {
    const values: NewPromotionRow = input;
    const [row] = await this.executor.insert(promotions).values(values).returning();

    if (!row) {
      throw new Error("Promotion insert completed without returning a row.");
    }

    return row;
  }

  /** Updates editable fields only when the target promotion is platform-owned. */
  async updatePlatformPromotion(
    promotionId: string,
    input: UpdatePromotionRecordInput,
  ): Promise<PromotionRow | null> {
    const [row] = await this.executor
      .update(promotions)
      .set(input)
      .where(
        and(
          eq(promotions.id, promotionId),
          eq(promotions.ownerType, PROMOTION_OWNER_TYPE.PLATFORM),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Persists a service-approved lifecycle state for one exact promotion. */
  async updatePromotionStatus(
    promotionId: string,
    status: PromotionRow["status"],
  ): Promise<PromotionRow | null> {
    const [row] = await this.executor
      .update(promotions)
      .set({ status })
      .where(eq(promotions.id, promotionId))
      .returning();

    return row ?? null;
  }

  /** Lists eligibility targets for one promotion in deterministic order. */
  async listScopesByPromotionId(
    promotionId: string,
  ): Promise<PromotionScopeRow[]> {
    return this.executor
      .select()
      .from(promotionScopes)
      .where(eq(promotionScopes.promotionId, promotionId))
      .orderBy(
        asc(promotionScopes.scopeType),
        asc(promotionScopes.scopeId),
      );
  }

  /** Batch-loads eligibility targets for a promotion page without N+1 queries. */
  async listScopesByPromotionIds(
    promotionIds: string[],
  ): Promise<PromotionScopeRow[]> {
    if (promotionIds.length === 0) return [];

    return this.executor
      .select()
      .from(promotionScopes)
      .where(inArray(promotionScopes.promotionId, promotionIds))
      .orderBy(
        asc(promotionScopes.promotionId),
        asc(promotionScopes.scopeType),
        asc(promotionScopes.scopeId),
      );
  }

  /** Replaces one promotion's persisted scope rows inside the caller's transaction. */
  async replacePromotionScopes(
    promotionId: string,
    scopes: PromotionScopeRecordInput[],
  ): Promise<PromotionScopeRow[]> {
    await this.executor
      .delete(promotionScopes)
      .where(eq(promotionScopes.promotionId, promotionId));

    if (scopes.length === 0) return [];

    const values: NewPromotionScopeRow[] = scopes.map((scope) => ({
      promotionId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    }));

    return this.executor.insert(promotionScopes).values(values).returning();
  }

  /** Lists coupon rows attached to one promotion in stable ID order. */
  async listCouponsByPromotionId(promotionId: string): Promise<CouponRow[]> {
    return this.executor
      .select()
      .from(coupons)
      .where(eq(coupons.promotionId, promotionId))
      .orderBy(asc(coupons.id));
  }

  /** Batch-loads coupons for a promotion page without N+1 queries. */
  async listCouponsByPromotionIds(promotionIds: string[]): Promise<CouponRow[]> {
    if (promotionIds.length === 0) return [];

    return this.executor
      .select()
      .from(coupons)
      .where(inArray(coupons.promotionId, promotionIds))
      .orderBy(asc(coupons.promotionId), asc(coupons.id));
  }

  /** Reads one coupon using the normalized unique code supplied by the service. */
  async findCouponByCode(code: string): Promise<CouponRow | null> {
    const [row] = await this.executor
      .select()
      .from(coupons)
      .where(eq(coupons.code, code))
      .limit(1);

    return row ?? null;
  }

  /** Locks one coupon by normalized code before a transactional redemption-limit check. */
  async findCouponByCodeForUpdate(code: string): Promise<CouponRow | null> {
    const [row] = await this.executor
      .select()
      .from(coupons)
      .where(eq(coupons.code, code))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Inserts one coupon after the service has validated promotion and code rules. */
  async createCoupon(input: CreateCouponRecordInput): Promise<CouponRow> {
    const values: NewCouponRow = input;
    const [row] = await this.executor.insert(coupons).values(values).returning();

    if (!row) {
      throw new Error("Coupon insert completed without returning a row.");
    }

    return row;
  }

  /** Updates only service-approved fields on one exact coupon row. */
  async updateCoupon(
    couponId: string,
    input: UpdateCouponRecordInput,
  ): Promise<CouponRow | null> {
    const [row] = await this.executor
      .update(coupons)
      .set(input)
      .where(eq(coupons.id, couponId))
      .returning();

    return row ?? null;
  }

  /** Counts all redemption rows for one coupon without interpreting the configured limit. */
  async countCouponRedemptions(couponId: string): Promise<number> {
    const [row] = await this.executor
      .select({ total: count() })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));

    return Number(row?.total ?? 0);
  }

  /** Counts redemption rows for one coupon/customer pair without deciding eligibility. */
  async countCouponRedemptionsForCustomer(
    couponId: string,
    customerUserId: string,
  ): Promise<number> {
    const [row] = await this.executor
      .select({ total: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          eq(couponRedemptions.customerUserId, customerUserId),
        ),
      );

    return Number(row?.total ?? 0);
  }

  /** Reads an existing coupon/order redemption row for idempotent order-confirmation retries. */
  async findCouponRedemptionByCouponAndOrder(
    couponId: string,
    orderId: string,
  ): Promise<CouponRedemptionRow | null> {
    const [row] = await this.executor
      .select()
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          eq(couponRedemptions.orderId, orderId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Inserts one immutable redemption row, returning null when the coupon/order identity already exists. */
  async createCouponRedemptionIfMissing(
    input: CreateCouponRedemptionRecordInput,
  ): Promise<CouponRedemptionRow | null> {
    const values: NewCouponRedemptionRow = input;
    const [row] = await this.executor
      .insert(couponRedemptions)
      .values(values)
      .onConflictDoNothing({
        target: [couponRedemptions.couponId, couponRedemptions.orderId],
      })
      .returning();

    return row ?? null;
  }
}

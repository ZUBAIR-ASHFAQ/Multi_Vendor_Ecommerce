import type {
  CouponRedemptionRow,
  CouponRow,
  PromotionRow,
  PromotionScopeRow,
} from "../../database/schema/promotions.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError, isAppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission, assertSellerPermission } from "../../common/policies/policy.js";
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import { CartWishlistService } from "../cart-wishlist/cart-wishlist.service.js";
import type { CartResponse } from "../cart-wishlist/cart-wishlist.schema.js";
import { CatalogTaxonomyService } from "../catalog-taxonomy/catalog-taxonomy.service.js";
import type { CategoryTreeNodeResponse } from "../catalog-taxonomy/catalog-taxonomy.schema.js";
import { ProductsService } from "../products/products.service.js";
import { SellersService } from "../sellers/sellers.service.js";
import {
  COUPON_STATUS,
  PROMOTION_ERROR_CODE,
  PROMOTION_FUNDING_TYPE,
  PROMOTION_OUTBOX_EVENT,
  PROMOTION_OWNER_TYPE,
  PROMOTION_PERMISSION,
  PROMOTION_SCOPE_TYPE,
  PROMOTION_STATUS,
} from "./promotions.constants.js";
import {
  PromotionsRepository,
  type PromotionScopeRecordInput,
  type UpdatePromotionRecordInput,
} from "./promotions.repository.js";
import type {
  AdminPromotionListQuery,
  CreatePlatformPromotionInput,
  CreateSellerPromotionInput,
  PromotionResponse,
  PromotionScopeInput,
  PromotionValidationResponse,
  SellerPromotionListQuery,
  UpdateCouponInput,
  UpdatePromotionInput,
  ValidatePromotionQuery,
} from "./promotions.schema.js";

/** Runs one Module 9 transaction and allows focused service tests to replace the real database boundary. */
export type PromotionsTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Seller/store metadata consumed by Promotion scope validation without importing seller persistence. */
export interface PromotionSellerIntegration {
  /** Verifies one seller remains approved and active for marketplace commerce. */
  assertSellerCommerceEligible(sellerId: string): Promise<void>;

  /** Resolves one active store to its owning seller for promotion scope validation. */
  resolveCommerceStoreById(storeId: string): Promise<{ sellerId: string; storeId: string }>;
}

/** Public Product scope used by Promotion eligibility and seller-ownership checks. */
export interface PromotionProductScope {
  productId: string;
  sellerId: string;
  storeId: string;
  categoryId: string;
}

/** Product boundary consumed by Promotions without importing Product repositories. */
export interface PromotionProductIntegration {
  /** Resolves one existing Product to seller/store/category scope for promotion configuration. */
  resolveProductPromotionScope(productId: string): Promise<PromotionProductScope | null>;

  /** Resolves one public Product to the seller/store/category scope used by the promotion evaluator. */
  resolvePublicProductPromotionScope(productId: string): Promise<PromotionProductScope | null>;
}

/** Catalog boundary consumed by Promotions to validate active category targets. */
export interface PromotionCatalogIntegration {
  /** Returns the active public category hierarchy used to validate category scope IDs. */
  listCategories(context?: RequestContext | null): Promise<CategoryTreeNodeResponse[]>;
}

/** Cart boundary consumed by coupon preview without reading Module 8 persistence directly. */
export interface PromotionCartIntegration {
  /** Returns the authenticated customer's current non-authoritative cart preview. */
  getCart(context: RequestContext): Promise<CartResponse>;
}

/** Explicit dependencies keep Module 9 business rules readable and independently testable. */
export interface PromotionsServiceDependencies {
  repository?: PromotionsRepository;
  transactionRunner?: PromotionsTransactionRunner;
  sellers?: PromotionSellerIntegration;
  products?: PromotionProductIntegration;
  catalog?: PromotionCatalogIntegration;
  cart?: PromotionCartIntegration;
  now?: () => Date;
}

/** Paginated platform promotion result returned before the HTTP response envelope is applied. */
export interface PaginatedPromotionsResult {
  items: PromotionResponse[];
  meta: PaginationMeta;
}

/** Idempotent coupon-redemption command used by the later order-confirmation transaction. */
export interface RecordCouponRedemptionInput {
  code: string;
  customerUserId: string;
  orderId: string;
}

/** Safe result returned when one coupon redemption has been recorded or replayed. */
export interface CouponRedemptionResult {
  id: string;
  couponId: string;
  promotionId: string;
  customerUserId: string;
  orderId: string;
  redeemedAt: string;
}

/** One current Product line supplied by Checkout after Product ownership and price revalidation. */
export interface CheckoutPromotionLineInput {
  productId: string;
  variantId: string;
  sellerId: string;
  storeId: string;
  categoryId: string;
  quantity: number;
  unitPrice: string;
  currency: string;
}

/** Trusted Checkout promotion request built only from current server-owned commerce facts. */
export interface CheckoutPromotionEvaluationInput {
  customerUserId: string;
  currency: string;
  couponCode: string | null;
  lines: CheckoutPromotionLineInput[];
}

/** Exact scale-4 discount allocated to one Checkout variant. */
export interface CheckoutPromotionAllocation {
  variantId: string;
  discountAmount: string;
}

/** Authoritative Promotion decision consumed by Checkout quote calculation and confirmation revalidation. */
export interface CheckoutPromotionEvaluationResult {
  couponCode: string | null;
  promotionId: string | null;
  couponId: string | null;
  fundingType: PromotionValidationResponse["fundingType"] | null;
  discountTotal: string;
  allocations: CheckoutPromotionAllocation[];
}

/** One cart line enriched with authoritative current Product scope for deterministic discount allocation. */
interface EligiblePromotionLine {
  cartItemId: string;
  productId: string;
  variantId: string;
  subtotalCents: bigint;
}

/** Canonical executable rule names supported by the current deterministic Module 9 evaluator. */
const EXECUTABLE_PROMOTION_TYPE = {
  PERCENTAGE: "percentage",
} as const;

/** Stable audit actions for meaningful Promotion changes required by the Module 9 guide. */
const PROMOTION_AUDIT_ACTION = {
  CREATED: "promotion.created",
  UPDATED: "promotion.updated",
  ACTIVATED: "promotion.activated",
  DEACTIVATED: "promotion.deactivated",
} as const;

/** Stable audit resource label shared by all Module 9 promotion changes. */
const PROMOTION_RESOURCE_TYPE = "promotion";

/** Creates one stable Module 9 application error. */
function promotionError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Reads a PostgreSQL error code through nested database-driver causes. */
function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseErrorCode(candidate.cause);
}

/** Reads a PostgreSQL constraint name through nested database-driver causes. */
function databaseConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { constraint?: unknown; cause?: unknown };
  if (typeof candidate.constraint === "string") return candidate.constraint;
  return databaseConstraint(candidate.cause);
}

/** Normalizes one coupon code for direct service callers as well as HTTP/Zod callers. */
function normalizeCouponCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Converts one non-negative decimal string into an exact integer at the requested decimal scale. */
function decimalToScaledInteger(value: string, scale: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const paddedFraction = `${fraction}${"0".repeat(scale)}`.slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(paddedFraction || "0");
}

/** Converts one two-decimal price string into exact integer cents. */
function moneyToCents(value: string): bigint {
  return decimalToScaledInteger(value, 2);
}

/** Converts exact non-negative integer cents into the canonical two-decimal money representation. */
function centsToMoney(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** Converts exact scale-4 money units into Checkout's canonical four-decimal representation. */
function scale4ToMoney(value: bigint): string {
  const whole = value / 10_000n;
  const fraction = (value % 10_000n).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** Divides positive integers using deterministic half-up rounding. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Discount denominator must be positive.");
  return (numerator + denominator / 2n) / denominator;
}

/** Calculates the deterministic total discount for one currently supported promotion rule. */
function calculateDiscountTotalCents(
  promotionType: string,
  promotionValue: string,
  eligibleSubtotalCents: bigint,
): bigint {
  if (promotionType === EXECUTABLE_PROMOTION_TYPE.PERCENTAGE) {
    const percentageScaled = decimalToScaledInteger(promotionValue, 4);
    return divideRoundHalfUp(
      eligibleSubtotalCents * percentageScaled,
      100n * 10_000n,
    );
  }

  throw promotionError(
    ERROR_CODE.INVALID_REQUEST,
    "This promotion rule type is not supported by the current evaluator.",
    422,
  );
}

/** Calculates one percentage discount using exact scale-4 Checkout money units. */
function calculateCheckoutDiscountScale4(
  promotionType: string,
  promotionValue: string,
  eligibleSubtotal: bigint,
): bigint {
  if (promotionType === EXECUTABLE_PROMOTION_TYPE.PERCENTAGE) {
    const percentageScaled = decimalToScaledInteger(promotionValue, 4);
    return divideRoundHalfUp(
      eligibleSubtotal * percentageScaled,
      100n * 10_000n,
    );
  }

  throw promotionError(
    ERROR_CODE.INVALID_REQUEST,
    "This promotion rule type is not supported by the current evaluator.",
    422,
  );
}

/** Allocates an exact scale-4 Checkout discount proportionally in stable variant order. */
function allocateCheckoutDiscountScale4(
  totalDiscount: bigint,
  lines: Array<{ variantId: string; subtotal: bigint }>,
): Map<string, bigint> {
  const allocations = new Map<string, bigint>();
  if (totalDiscount <= 0n || lines.length === 0) return allocations;

  const sortedLines = [...lines].sort((left, right) =>
    left.variantId.localeCompare(right.variantId),
  );
  const subtotal = sortedLines.reduce((total, line) => total + line.subtotal, 0n);
  if (subtotal <= 0n) return allocations;

  let allocated = 0n;
  for (const line of sortedLines) {
    const lineDiscount = (totalDiscount * line.subtotal) / subtotal;
    allocations.set(line.variantId, lineDiscount);
    allocated += lineDiscount;
  }

  let remainder = totalDiscount - allocated;
  for (const line of sortedLines) {
    if (remainder <= 0n) break;
    const current = allocations.get(line.variantId) ?? 0n;
    if (current < line.subtotal) {
      allocations.set(line.variantId, current + 1n);
      remainder -= 1n;
    }
  }

  if (remainder !== 0n) {
    throw new Error("Checkout discount allocation did not reconcile to the calculated total.");
  }
  return allocations;
}

/** Allocates one total discount proportionally and distributes rounding cents in stable cart-item order. */
function allocateDiscountCents(
  totalDiscountCents: bigint,
  lines: EligiblePromotionLine[],
): Map<string, bigint> {
  const allocations = new Map<string, bigint>();
  if (totalDiscountCents <= 0n || lines.length === 0) return allocations;

  const sortedLines = [...lines].sort((left, right) =>
    left.cartItemId.localeCompare(right.cartItemId),
  );
  const subtotalCents = sortedLines.reduce(
    (total, line) => total + line.subtotalCents,
    0n,
  );
  if (subtotalCents <= 0n) return allocations;

  let allocatedCents = 0n;
  for (const line of sortedLines) {
    const lineDiscount = (totalDiscountCents * line.subtotalCents) / subtotalCents;
    allocations.set(line.cartItemId, lineDiscount);
    allocatedCents += lineDiscount;
  }

  let remainder = totalDiscountCents - allocatedCents;
  for (const line of sortedLines) {
    if (remainder <= 0n) break;
    const current = allocations.get(line.cartItemId) ?? 0n;
    if (current < line.subtotalCents) {
      allocations.set(line.cartItemId, current + 1n);
      remainder -= 1n;
    }
  }

  if (remainder !== 0n) {
    throw new Error("Discount allocation did not reconcile to the calculated total.");
  }
  return allocations;
}

/** Returns every category ID contained in one nested public category tree. */
function collectCategoryIds(nodes: CategoryTreeNodeResponse[]): Set<string> {
  const ids = new Set<string>();

  /** Visits one category subtree and records each stable category identifier exactly once. */
  function visit(items: CategoryTreeNodeResponse[]): void {
    for (const item of items) {
      ids.add(item.id);
      visit(item.children);
    }
  }

  visit(nodes);
  return ids;
}

/** Module 9 business service for promotion lifecycle, scoped eligibility, deterministic allocation, audit, and outbox. */
export class PromotionsService {
  private readonly repository: PromotionsRepository;
  private readonly transactionRunner: PromotionsTransactionRunner;
  private readonly sellers: PromotionSellerIntegration;
  private readonly products: PromotionProductIntegration;
  private readonly catalog: PromotionCatalogIntegration;
  private readonly cart: PromotionCartIntegration;
  private readonly now: () => Date;

  /** Stores explicit dependencies without introducing a container or hiding cross-module boundaries. */
  constructor(dependencies: PromotionsServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new PromotionsRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.sellers = dependencies.sellers ?? new SellersService();
    this.products = dependencies.products ?? new ProductsService();
    this.catalog = dependencies.catalog ?? new CatalogTaxonomyService();
    this.cart = dependencies.cart ?? new CartWishlistService();
    this.now = dependencies.now ?? (() => new Date());
  }

  /** Creates a transaction-bound service for the future Checkout/Order confirmation flow. */
  static using(transaction: DatabaseTransaction): PromotionsService {
    return new PromotionsService({
      repository: new PromotionsRepository(transaction),
      /** Reuses the caller's transaction so coupon usage checks and order confirmation remain atomic. */
      transactionRunner: async (work) => work(transaction),
    });
  }

  /** Lists only platform-owned promotions for an authorized administrative reader. */
  async listAdminPromotions(
    context: RequestContext,
    query: AdminPromotionListQuery,
  ): Promise<PaginatedPromotionsResult> {
    assertPermission(context, PROMOTION_PERMISSION.ADMIN_MANAGE);
    const result = await this.repository.listPlatformPromotions(query);
    const promotionIds = result.items.map((item) => item.id);
    const scopes = await this.repository.listScopesByPromotionIds(promotionIds);
    const coupons = await this.repository.listCouponsByPromotionIds(promotionIds);
    const scopesByPromotion = this.groupScopesByPromotion(scopes);
    const couponsByPromotion = this.groupCouponsByPromotion(coupons);

    return {
      items: result.items.map((promotion) =>
        this.toPromotionResponse(
          promotion,
          scopesByPromotion.get(promotion.id) ?? [],
          couponsByPromotion.get(promotion.id) ?? [],
        ),
      ),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Lists only seller-owned promotions inside seller scopes where promotion management is effective. */
  async listSellerPromotions(
    context: RequestContext,
    query: SellerPromotionListQuery,
  ): Promise<PaginatedPromotionsResult> {
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.promotionScopeForbidden();
    const sellerIds = [...context.sellerIds].filter(
      (sellerId) =>
        context.sellerPermissions.get(sellerId)?.has(PROMOTION_PERMISSION.SELLER_MANAGE) === true,
    );
    if (sellerIds.length === 0) throw this.promotionScopeForbidden();

    const result = await this.repository.listSellerPromotions(sellerIds, query);
    const promotionIds = result.items.map((item) => item.id);
    const scopes = await this.repository.listScopesByPromotionIds(promotionIds);
    const coupons = await this.repository.listCouponsByPromotionIds(promotionIds);
    const scopesByPromotion = this.groupScopesByPromotion(scopes);
    const couponsByPromotion = this.groupCouponsByPromotion(coupons);

    return {
      items: result.items.map((promotion) =>
        this.toPromotionResponse(
          promotion,
          scopesByPromotion.get(promotion.id) ?? [],
          couponsByPromotion.get(promotion.id) ?? [],
        ),
      ),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Creates one platform-funded draft promotion after validating every eligibility target. */
  async createPlatformPromotion(
    context: RequestContext,
    input: CreatePlatformPromotionInput,
  ): Promise<PromotionResponse> {
    assertPermission(context, PROMOTION_PERMISSION.ADMIN_MANAGE);
    this.assertPromotionRuleIsValid({
      type: input.type,
      value: input.value,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    });
    this.assertExecutablePromotionType(input.type);
    await this.assertScopesAreValid(input.scopes, null);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new PromotionsRepository(tx);
        const created = await repository.createPromotion({
          ownerType: PROMOTION_OWNER_TYPE.PLATFORM,
          sellerId: null,
          name: input.name,
          type: input.type,
          value: input.value,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          status: PROMOTION_STATUS.DRAFT,
          fundingType: PROMOTION_FUNDING_TYPE.PLATFORM,
        });
        const scopes = await repository.replacePromotionScopes(
          created.id,
          this.toScopeRecords(input.scopes),
        );
        const coupon = input.coupon
          ? await repository.createCoupon({
              promotionId: created.id,
              code: normalizeCouponCode(input.coupon.code),
              maxUses: input.coupon.maxUses ?? null,
              maxUsesPerCustomer: input.coupon.maxUsesPerCustomer ?? null,
              status: COUPON_STATUS.ACTIVE,
            })
          : null;
        const safe = this.toPromotionResponse(created, scopes, coupon ? [coupon] : []);

        await this.recordPromotionCreated(tx, context, safe);
        return safe;
      });
    } catch (error) {
      throw this.mapPromotionWriteError(error);
    }
  }

  /** Creates one seller-funded draft promotion with seller ownership derived only from authenticated scope. */
  async createSellerPromotion(
    context: RequestContext,
    input: CreateSellerPromotionInput,
  ): Promise<PromotionResponse> {
    if (context.actorType !== ACTOR_TYPE.SELLER) throw this.promotionScopeForbidden();
    this.assertPromotionRuleIsValid({
      type: input.type,
      value: input.value,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    });
    this.assertExecutablePromotionType(input.type);

    const sellerId = await this.resolveSellerPromotionOwner(context, input.scopes);
    assertSellerPermission(context, sellerId, PROMOTION_PERMISSION.SELLER_MANAGE);
    await this.assertScopesAreValid(input.scopes, sellerId);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new PromotionsRepository(tx);
        const created = await repository.createPromotion({
          ownerType: PROMOTION_OWNER_TYPE.SELLER,
          sellerId,
          name: input.name,
          type: input.type,
          value: input.value,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          status: PROMOTION_STATUS.DRAFT,
          fundingType: PROMOTION_FUNDING_TYPE.SELLER,
        });
        const scopes = await repository.replacePromotionScopes(
          created.id,
          this.toScopeRecords(input.scopes),
        );
        const coupon = input.coupon
          ? await repository.createCoupon({
              promotionId: created.id,
              code: normalizeCouponCode(input.coupon.code),
              maxUses: input.coupon.maxUses ?? null,
              maxUsesPerCustomer: input.coupon.maxUsesPerCustomer ?? null,
              status: COUPON_STATUS.ACTIVE,
            })
          : null;
        const safe = this.toPromotionResponse(created, scopes, coupon ? [coupon] : []);

        await this.recordPromotionCreated(tx, context, safe);
        return safe;
      });
    } catch (error) {
      throw this.mapPromotionWriteError(error);
    }
  }

  /** Updates editable fields on one platform promotion while preserving lifecycle and ownership authority. */
  async updateAdminPromotion(
    context: RequestContext,
    promotionId: string,
    input: UpdatePromotionInput,
  ): Promise<PromotionResponse> {
    assertPermission(context, PROMOTION_PERMISSION.ADMIN_MANAGE);

    try {
      return await this.transactionRunner(async (tx) => {
        const repository = new PromotionsRepository(tx);
        const existing = await repository.findPlatformPromotionByIdForUpdate(promotionId);
        if (!existing) throw this.promotionNotFound();
        if (
          existing.status !== PROMOTION_STATUS.DRAFT &&
          existing.status !== PROMOTION_STATUS.SCHEDULED
        ) {
          throw promotionError(
            ERROR_CODE.CONFLICT,
            "Only draft or scheduled promotions can be edited.",
            409,
          );
        }

        const before = await this.toPromotionResponseFromRow(repository, existing);

        const nextRule = {
          type: input.type ?? existing.type,
          value: input.value ?? existing.value,
          startAt: input.startAt ? new Date(input.startAt) : existing.startAt,
          endAt: input.endAt ? new Date(input.endAt) : existing.endAt,
        };
        this.assertPromotionRuleIsValid(nextRule);
        this.assertExecutablePromotionType(nextRule.type);

        const nextScopes = input.scopes ?? (await repository.listScopesByPromotionId(existing.id)).map(
          (scope) => ({
            scopeType: scope.scopeType as PromotionScopeInput["scopeType"],
            scopeId: scope.scopeId,
          }),
        );
        await this.assertScopesAreValid(nextScopes, null);

        const updateRecord: UpdatePromotionRecordInput = {};
        if (input.name !== undefined) updateRecord.name = input.name;
        if (input.type !== undefined) updateRecord.type = input.type;
        if (input.value !== undefined) updateRecord.value = input.value;
        if (input.startAt !== undefined) updateRecord.startAt = new Date(input.startAt);
        if (input.endAt !== undefined) updateRecord.endAt = new Date(input.endAt);

        const updated =
          Object.keys(updateRecord).length > 0
            ? await repository.updatePlatformPromotion(existing.id, updateRecord)
            : existing;
        if (!updated) throw this.promotionNotFound();

        const scopes = input.scopes
          ? await repository.replacePromotionScopes(
              existing.id,
              this.toScopeRecords(input.scopes),
            )
          : await repository.listScopesByPromotionId(existing.id);
        const coupons = await this.applyCouponUpdate(repository, existing.id, input.coupon);
        const after = this.toPromotionResponse(updated, scopes, coupons);

        await AuditService.using(tx).record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: PROMOTION_AUDIT_ACTION.UPDATED,
          entityType: PROMOTION_RESOURCE_TYPE,
          entityId: existing.id,
          sellerId: updated.sellerId,
          requestId: context.requestId,
          before,
          after,
        });
        return after;
      });
    } catch (error) {
      throw this.mapPromotionWriteError(error);
    }
  }

  /** Activates or schedules one promotion after rechecking rule, scope, and ownership invariants. */
  async activateAdminPromotion(
    context: RequestContext,
    promotionId: string,
  ): Promise<PromotionResponse> {
    assertPermission(context, PROMOTION_PERMISSION.ADMIN_MANAGE);

    return this.transactionRunner(async (tx) => {
      const repository = new PromotionsRepository(tx);
      const existing = await repository.findPromotionByIdForUpdate(promotionId);
      if (!existing) throw this.promotionNotFound();
      if (
        existing.status === PROMOTION_STATUS.ACTIVE ||
        existing.status === PROMOTION_STATUS.SCHEDULED
      ) {
        return this.toPromotionResponseFromRow(repository, existing);
      }

      const now = this.now();
      this.assertPromotionRuleIsValid(existing);
      if (existing.endAt <= now) {
        throw promotionError(
          ERROR_CODE.CONFLICT,
          "An expired promotion cannot be activated.",
          409,
        );
      }
      this.assertExecutablePromotionType(existing.type);
      const scopes = await repository.listScopesByPromotionId(existing.id);
      await this.assertScopesAreValid(
        scopes.map((scope) => ({
          scopeType: scope.scopeType as PromotionScopeInput["scopeType"],
          scopeId: scope.scopeId,
        })),
        existing.sellerId,
      );

      const nextStatus =
        existing.startAt > now ? PROMOTION_STATUS.SCHEDULED : PROMOTION_STATUS.ACTIVE;
      const updated = await repository.updatePromotionStatus(existing.id, nextStatus);
      if (!updated) throw this.promotionNotFound();
      const after = await this.toPromotionResponseFromRow(repository, updated);

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PROMOTION_AUDIT_ACTION.ACTIVATED,
        entityType: PROMOTION_RESOURCE_TYPE,
        entityId: updated.id,
        sellerId: updated.sellerId,
        requestId: context.requestId,
        before: { status: existing.status },
        after: { status: updated.status },
      });
      await OutboxService.using(tx).enqueue({
        eventType: PROMOTION_OUTBOX_EVENT.ACTIVATED,
        aggregateType: PROMOTION_RESOURCE_TYPE,
        aggregateId: updated.id,
        payload: {
          promotionId: updated.id,
          ownerType: updated.ownerType,
          sellerId: updated.sellerId,
          status: updated.status,
          startAt: updated.startAt.toISOString(),
          endAt: updated.endAt.toISOString(),
        },
      });
      return after;
    });
  }

  /** Deactivates one active or scheduled promotion without deleting historical promotion/coupon records. */
  async deactivateAdminPromotion(
    context: RequestContext,
    promotionId: string,
  ): Promise<PromotionResponse> {
    assertPermission(context, PROMOTION_PERMISSION.ADMIN_MANAGE);

    return this.transactionRunner(async (tx) => {
      const repository = new PromotionsRepository(tx);
      const existing = await repository.findPromotionByIdForUpdate(promotionId);
      if (!existing) throw this.promotionNotFound();
      if (existing.status === PROMOTION_STATUS.INACTIVE) {
        return this.toPromotionResponseFromRow(repository, existing);
      }
      if (
        existing.status !== PROMOTION_STATUS.ACTIVE &&
        existing.status !== PROMOTION_STATUS.SCHEDULED
      ) {
        throw promotionError(
          ERROR_CODE.CONFLICT,
          "Only active or scheduled promotions can be deactivated.",
          409,
        );
      }

      const updated = await repository.updatePromotionStatus(
        existing.id,
        PROMOTION_STATUS.INACTIVE,
      );
      if (!updated) throw this.promotionNotFound();
      const after = await this.toPromotionResponseFromRow(repository, updated);

      await AuditService.using(tx).record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: PROMOTION_AUDIT_ACTION.DEACTIVATED,
        entityType: PROMOTION_RESOURCE_TYPE,
        entityId: updated.id,
        sellerId: updated.sellerId,
        requestId: context.requestId,
        before: { status: existing.status },
        after: { status: updated.status },
      });
      await OutboxService.using(tx).enqueue({
        eventType: PROMOTION_OUTBOX_EVENT.DEACTIVATED,
        aggregateType: PROMOTION_RESOURCE_TYPE,
        aggregateId: updated.id,
        payload: {
          promotionId: updated.id,
          ownerType: updated.ownerType,
          sellerId: updated.sellerId,
          status: updated.status,
        },
      });
      return after;
    });
  }

  /** Validates one coupon against the authenticated customer's current Cart and returns a non-authoritative preview. */
  async validateCoupon(
    context: RequestContext,
    query: ValidatePromotionQuery,
  ): Promise<PromotionValidationResponse> {
    assertPermission(context, PROMOTION_PERMISSION.READ);
    if (context.actorType !== ACTOR_TYPE.CUSTOMER || !context.actorId) {
      throw promotionError(
        ERROR_CODE.FORBIDDEN,
        "Coupon validation requires an authenticated customer.",
        403,
      );
    }

    const code = normalizeCouponCode(query.code);
    const coupon = await this.repository.findCouponByCode(code);
    if (!coupon || coupon.status !== COUPON_STATUS.ACTIVE) throw this.couponInvalid();
    const promotion = await this.repository.findPromotionById(coupon.promotionId);
    if (!promotion) throw this.couponInvalid();
    this.assertPromotionCurrentlyEligible(promotion, this.now());
    await this.assertCouponUsageAvailable(this.repository, coupon, context.actorId);

    const cart = await this.cart.getCart(context);
    const scopes = await this.repository.listScopesByPromotionId(promotion.id);
    const eligibleLines = await this.loadEligibleCartLines(cart, promotion, scopes);
    if (eligibleLines.length === 0) throw this.promotionScopeForbiddenForCart();

    const eligibleSubtotalCents = eligibleLines.reduce(
      (total, line) => total + line.subtotalCents,
      0n,
    );
    const discountTotalCents = calculateDiscountTotalCents(
      promotion.type,
      promotion.value,
      eligibleSubtotalCents,
    );
    if (discountTotalCents <= 0n) throw this.couponInvalid();

    const allocations = allocateDiscountCents(discountTotalCents, eligibleLines);
    return {
      valid: true,
      promotionId: promotion.id,
      couponId: coupon.id,
      code: coupon.code,
      fundingType: promotion.fundingType as PromotionValidationResponse["fundingType"],
      currency: cart.currency,
      discountTotal: centsToMoney(discountTotalCents),
      allocations: eligibleLines
        .filter((line) => (allocations.get(line.cartItemId) ?? 0n) > 0n)
        .sort((left, right) => left.cartItemId.localeCompare(right.cartItemId))
        .map((line) => ({
          cartItemId: line.cartItemId,
          productId: line.productId,
          variantId: line.variantId,
          discountAmount: centsToMoney(allocations.get(line.cartItemId) ?? 0n),
        })),
    };
  }

  /** Resolves immutable Promotion funding ownership for a historical Checkout coupon without rechecking current eligibility. */
  async resolveHistoricalCouponFunding(
    couponCode: string,
  ): Promise<{ promotionId: string; fundingType: PromotionValidationResponse["fundingType"] } | null> {
    const coupon = await this.repository.findCouponByCode(normalizeCouponCode(couponCode));
    if (!coupon) return null;
    const promotion = await this.repository.findPromotionById(coupon.promotionId);
    if (!promotion) return null;
    return {
      promotionId: promotion.id,
      fundingType: promotion.fundingType as PromotionValidationResponse["fundingType"],
    };
  }

  /** Calculates authoritative scale-4 Checkout discounts from current server-resolved Product lines. */
  async calculateCheckoutDiscounts(
    input: CheckoutPromotionEvaluationInput,
  ): Promise<CheckoutPromotionEvaluationResult> {
    const currency = input.currency.trim().toUpperCase();
    const seenVariants = new Set<string>();

    for (const line of input.lines) {
      if (seenVariants.has(line.variantId)) {
        throw promotionError(
          ERROR_CODE.INVALID_REQUEST,
          "Checkout promotion lines must contain each variant only once.",
          422,
        );
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw promotionError(
          ERROR_CODE.INVALID_REQUEST,
          "Checkout promotion quantities must be positive integers.",
          422,
        );
      }
      if (line.currency.trim().toUpperCase() !== currency) {
        throw promotionError(
          ERROR_CODE.CONFLICT,
          "Checkout promotion lines must use one currency.",
          409,
        );
      }
      seenVariants.add(line.variantId);
    }

    const sortedLines = [...input.lines].sort((left, right) =>
      left.variantId.localeCompare(right.variantId),
    );
    const zeroAllocations = sortedLines.map((line) => ({
      variantId: line.variantId,
      discountAmount: "0.0000",
    }));

    if (input.couponCode === null) {
      return {
        couponCode: null,
        promotionId: null,
        couponId: null,
        fundingType: null,
        discountTotal: "0.0000",
        allocations: zeroAllocations,
      };
    }

    const code = normalizeCouponCode(input.couponCode);
    const coupon = await this.repository.findCouponByCode(code);
    if (!coupon || coupon.status !== COUPON_STATUS.ACTIVE) throw this.couponInvalid();

    const promotion = await this.repository.findPromotionById(coupon.promotionId);
    if (!promotion) throw this.couponInvalid();
    this.assertPromotionCurrentlyEligible(promotion, this.now());
    await this.assertCouponUsageAvailable(
      this.repository,
      coupon,
      input.customerUserId,
    );

    const scopes = await this.repository.listScopesByPromotionId(promotion.id);
    const eligibleLines = sortedLines
      .filter((line) => {
        if (
          promotion.ownerType === PROMOTION_OWNER_TYPE.SELLER &&
          promotion.sellerId !== line.sellerId
        ) {
          return false;
        }

        return this.lineMatchesScopes(
          {
            productId: line.productId,
            sellerId: line.sellerId,
            storeId: line.storeId,
            categoryId: line.categoryId,
          },
          scopes,
        );
      })
      .map((line) => ({
        variantId: line.variantId,
        subtotal: decimalToScaledInteger(line.unitPrice, 4) * BigInt(line.quantity),
      }))
      .filter((line) => line.subtotal > 0n);

    if (eligibleLines.length === 0) throw this.promotionScopeForbiddenForCart();

    const eligibleSubtotal = eligibleLines.reduce(
      (total, line) => total + line.subtotal,
      0n,
    );
    const discountTotal = calculateCheckoutDiscountScale4(
      promotion.type,
      promotion.value,
      eligibleSubtotal,
    );
    if (discountTotal <= 0n) throw this.couponInvalid();

    const discountByVariant = allocateCheckoutDiscountScale4(
      discountTotal,
      eligibleLines,
    );

    return {
      couponCode: coupon.code,
      promotionId: promotion.id,
      couponId: coupon.id,
      fundingType: promotion.fundingType as PromotionValidationResponse["fundingType"],
      discountTotal: scale4ToMoney(discountTotal),
      allocations: sortedLines.map((line) => ({
        variantId: line.variantId,
        discountAmount: scale4ToMoney(discountByVariant.get(line.variantId) ?? 0n),
      })),
    };
  }

  /** Records one coupon redemption exactly once while enforcing usage limits inside the caller's transaction. */
  async recordCouponRedemption(
    input: RecordCouponRedemptionInput,
  ): Promise<CouponRedemptionResult> {
    const code = normalizeCouponCode(input.code);

    return this.transactionRunner(async (tx) => {
      const repository = new PromotionsRepository(tx);
      const coupon = await repository.findCouponByCodeForUpdate(code);
      if (!coupon) throw this.couponInvalid();

      const replay = await repository.findCouponRedemptionByCouponAndOrder(
        coupon.id,
        input.orderId,
      );
      if (replay) {
        if (replay.customerUserId !== input.customerUserId) {
          throw promotionError(
            ERROR_CODE.IDEMPOTENCY_CONFLICT,
            "The order redemption identity does not match the original request.",
            409,
          );
        }
        return this.toCouponRedemptionResult(replay, coupon.promotionId);
      }

      if (coupon.status !== COUPON_STATUS.ACTIVE) throw this.couponInvalid();
      const promotion = await repository.findPromotionById(coupon.promotionId);
      if (!promotion) throw this.couponInvalid();
      this.assertPromotionCurrentlyEligible(promotion, this.now());
      await this.assertCouponUsageAvailable(repository, coupon, input.customerUserId);

      const created = await repository.createCouponRedemptionIfMissing({
        couponId: coupon.id,
        customerUserId: input.customerUserId,
        orderId: input.orderId,
        redeemedAt: this.now(),
      });
      if (!created) {
        const concurrentReplay = await repository.findCouponRedemptionByCouponAndOrder(
          coupon.id,
          input.orderId,
        );
        if (!concurrentReplay) throw this.internalStateError();
        return this.toCouponRedemptionResult(concurrentReplay, coupon.promotionId);
      }

      await OutboxService.using(tx).enqueue({
        eventType: PROMOTION_OUTBOX_EVENT.COUPON_REDEEMED,
        aggregateType: "coupon",
        aggregateId: coupon.id,
        payload: {
          couponId: coupon.id,
          promotionId: coupon.promotionId,
          customerUserId: input.customerUserId,
          orderId: input.orderId,
          redeemedAt: created.redeemedAt.toISOString(),
        },
      });
      return this.toCouponRedemptionResult(created, coupon.promotionId);
    });
  }

  /** Records the required creation audit and outbox event inside the same transaction as persistence. */
  private async recordPromotionCreated(
    tx: DatabaseTransaction,
    context: RequestContext,
    promotion: PromotionResponse,
  ): Promise<void> {
    await AuditService.using(tx).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: PROMOTION_AUDIT_ACTION.CREATED,
      entityType: PROMOTION_RESOURCE_TYPE,
      entityId: promotion.id,
      sellerId: promotion.sellerId,
      requestId: context.requestId,
      after: promotion,
    });
    await OutboxService.using(tx).enqueue({
      eventType: PROMOTION_OUTBOX_EVENT.CREATED,
      aggregateType: PROMOTION_RESOURCE_TYPE,
      aggregateId: promotion.id,
      payload: {
        promotionId: promotion.id,
        ownerType: promotion.ownerType,
        sellerId: promotion.sellerId,
        fundingType: promotion.fundingType,
        status: promotion.status,
      },
    });
  }

  /** Applies one optional coupon edit, creating the first coupon only when a code is supplied explicitly. */
  private async applyCouponUpdate(
    repository: PromotionsRepository,
    promotionId: string,
    input: UpdateCouponInput | undefined,
  ): Promise<CouponRow[]> {
    const coupons = await repository.listCouponsByPromotionId(promotionId);
    if (!input) return coupons;
    if (coupons.length > 1) throw this.internalStateError();

    const existing = coupons[0];
    if (!existing) {
      if (!input.code) {
        throw promotionError(
          PROMOTION_ERROR_CODE.COUPON_INVALID,
          "A coupon code is required when attaching the first coupon.",
          409,
        );
      }
      const created = await repository.createCoupon({
        promotionId,
        code: normalizeCouponCode(input.code),
        maxUses: input.maxUses ?? null,
        maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
        status: input.status ?? COUPON_STATUS.ACTIVE,
      });
      return [created];
    }

    const updated = await repository.updateCoupon(existing.id, {
      ...(input.code !== undefined ? { code: normalizeCouponCode(input.code) } : {}),
      ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
      ...(input.maxUsesPerCustomer !== undefined
        ? { maxUsesPerCustomer: input.maxUsesPerCustomer }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) throw this.internalStateError();
    return [updated];
  }

  /** Resolves the one seller owner implied by server-derived seller permissions plus seller-specific targets. */
  private async resolveSellerPromotionOwner(
    context: RequestContext,
    scopes: PromotionScopeInput[],
  ): Promise<string> {
    const permittedSellerIds = [...context.sellerIds].filter(
      (sellerId) =>
        context.sellerPermissions.get(sellerId)?.has(PROMOTION_PERMISSION.SELLER_MANAGE) ===
        true,
    );
    if (permittedSellerIds.length === 0) throw this.promotionScopeForbidden();

    const targetedSellerIds = new Set<string>();
    for (const scope of scopes) {
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.SELLER) {
        targetedSellerIds.add(scope.scopeId);
      } else if (scope.scopeType === PROMOTION_SCOPE_TYPE.STORE) {
        const store = await this.resolveStoreScope(scope.scopeId);
        targetedSellerIds.add(store.sellerId);
      } else if (scope.scopeType === PROMOTION_SCOPE_TYPE.PRODUCT) {
        const product = await this.resolveProductScope(scope.scopeId);
        targetedSellerIds.add(product.sellerId);
      }
    }

    if (targetedSellerIds.size > 1) throw this.promotionScopeForbidden();
    const targetedSellerId = targetedSellerIds.values().next().value as string | undefined;
    const sellerId = targetedSellerId ?? (permittedSellerIds.length === 1 ? permittedSellerIds[0] : undefined);
    if (!sellerId || !permittedSellerIds.includes(sellerId)) {
      throw this.promotionScopeForbidden();
    }
    return sellerId;
  }

  /** Validates every scope target and enforces seller ownership for seller-funded promotions. */
  private async assertScopesAreValid(
    scopes: ReadonlyArray<PromotionScopeInput>,
    ownerSellerId: string | null,
  ): Promise<void> {
    if (ownerSellerId) {
      try {
        await this.sellers.assertSellerCommerceEligible(ownerSellerId);
      } catch (error) {
        if (isAppError(error)) throw this.promotionScopeForbidden();
        throw error;
      }
    }

    const categoryIds = scopes.some(
      (scope) => scope.scopeType === PROMOTION_SCOPE_TYPE.CATEGORY,
    )
      ? collectCategoryIds(await this.catalog.listCategories(null))
      : new Set<string>();

    for (const scope of scopes) {
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.SELLER) {
        await this.assertSellerScopeTarget(scope.scopeId, ownerSellerId);
        continue;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.STORE) {
        const store = await this.resolveStoreScope(scope.scopeId);
        this.assertTargetSellerMatchesOwner(store.sellerId, ownerSellerId);
        continue;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.PRODUCT) {
        const product = await this.resolveProductScope(scope.scopeId);
        this.assertTargetSellerMatchesOwner(product.sellerId, ownerSellerId);
        continue;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.CATEGORY) {
        if (!categoryIds.has(scope.scopeId)) throw this.promotionScopeForbidden();
        continue;
      }
      throw this.promotionScopeForbidden();
    }
  }

  /** Validates one seller scope target and enforces the owner boundary when supplied. */
  private async assertSellerScopeTarget(
    sellerId: string,
    ownerSellerId: string | null,
  ): Promise<void> {
    this.assertTargetSellerMatchesOwner(sellerId, ownerSellerId);
    try {
      await this.sellers.assertSellerCommerceEligible(sellerId);
    } catch (error) {
      if (isAppError(error)) throw this.promotionScopeForbidden();
      throw error;
    }
  }

  /** Resolves one active store target and converts safe upstream business failures into a Module 9 scope error. */
  private async resolveStoreScope(
    storeId: string,
  ): Promise<{ sellerId: string; storeId: string }> {
    try {
      return await this.sellers.resolveCommerceStoreById(storeId);
    } catch (error) {
      if (isAppError(error)) throw this.promotionScopeForbidden();
      throw error;
    }
  }

  /** Resolves one public Product target and hides upstream private-state details behind the Module 9 scope error. */
  private async resolveProductScope(productId: string): Promise<PromotionProductScope> {
    try {
      const product = await this.products.resolveProductPromotionScope(productId);
      if (!product) throw this.promotionScopeForbidden();
      return product;
    } catch (error) {
      if (isAppError(error)) throw this.promotionScopeForbidden();
      throw error;
    }
  }

  /** Rejects any seller-specific target that does not belong to the derived seller-funded owner. */
  private assertTargetSellerMatchesOwner(
    targetSellerId: string,
    ownerSellerId: string | null,
  ): void {
    if (ownerSellerId && targetSellerId !== ownerSellerId) {
      throw this.promotionScopeForbidden();
    }
  }

  /** Validates merged promotion dates/percentage bounds for direct service callers and partial PATCH requests. */
  private assertPromotionRuleIsValid(input: {
    type: string;
    value: string;
    startAt: Date;
    endAt: Date;
  }): void {
    if (decimalToScaledInteger(input.value, 4) <= 0n) {
      throw promotionError(
        ERROR_CODE.INVALID_REQUEST,
        "Promotion value must be greater than zero.",
        422,
      );
    }

    if (!(input.startAt < input.endAt)) {
      throw promotionError(
        ERROR_CODE.INVALID_REQUEST,
        "Promotion endAt must be later than startAt.",
        422,
      );
    }

    if (input.type === EXECUTABLE_PROMOTION_TYPE.PERCENTAGE) {
      const scaled = decimalToScaledInteger(input.value, 4);
      if (scaled > 100n * 10_000n) {
        throw promotionError(
          ERROR_CODE.INVALID_REQUEST,
          "Percentage promotion value must not exceed 100.",
          422,
        );
      }
    }
  }

  /** Rejects rule identifiers that the deterministic evaluator cannot execute safely yet. */
  private assertExecutablePromotionType(type: string): void {
    if (type !== EXECUTABLE_PROMOTION_TYPE.PERCENTAGE) {
      throw promotionError(
        ERROR_CODE.INVALID_REQUEST,
        "This promotion rule type is not supported by the current evaluator.",
        422,
      );
    }
  }

  /** Rejects coupons whose promotion lifecycle/date window cannot currently affect Checkout. */
  private assertPromotionCurrentlyEligible(promotion: PromotionRow, now: Date): void {
    const lifecycleEligible =
      promotion.status === PROMOTION_STATUS.ACTIVE ||
      promotion.status === PROMOTION_STATUS.SCHEDULED;
    if (!lifecycleEligible || now < promotion.startAt || now >= promotion.endAt) {
      throw this.couponInvalid();
    }
    this.assertExecutablePromotionType(promotion.type);
  }

  /** Checks global and per-customer coupon limits without deciding when the caller should commit an order. */
  private async assertCouponUsageAvailable(
    repository: PromotionsRepository,
    coupon: CouponRow,
    customerUserId: string,
  ): Promise<void> {
    if (coupon.maxUses !== null) {
      const totalUses = await repository.countCouponRedemptions(coupon.id);
      if (totalUses >= coupon.maxUses) throw this.couponLimitReached();
    }

    if (coupon.maxUsesPerCustomer !== null) {
      const customerUses = await repository.countCouponRedemptionsForCustomer(
        coupon.id,
        customerUserId,
      );
      if (customerUses >= coupon.maxUsesPerCustomer) throw this.couponLimitReached();
    }
  }

  /** Loads only purchasable Cart lines that match the promotion's allow-listed scopes and funding owner. */
  private async loadEligibleCartLines(
    cart: CartResponse,
    promotion: PromotionRow,
    scopes: PromotionScopeRow[],
  ): Promise<EligiblePromotionLine[]> {
    const lines: EligiblePromotionLine[] = [];

    for (const item of cart.items) {
      if (!item.isPurchasable || !item.currentUnitPrice || item.currency !== cart.currency) {
        continue;
      }

      let product: PromotionProductScope | null = null;
      try {
        product = await this.products.resolvePublicProductPromotionScope(item.productId);
      } catch (error) {
        if (!isAppError(error)) throw error;
      }
      if (!product) continue;
      if (
        promotion.ownerType === PROMOTION_OWNER_TYPE.SELLER &&
        promotion.sellerId !== product.sellerId
      ) {
        continue;
      }
      if (!this.lineMatchesScopes(product, scopes)) continue;

      const subtotalCents = moneyToCents(item.currentUnitPrice) * BigInt(item.quantity);
      if (subtotalCents <= 0n) continue;
      lines.push({
        cartItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        subtotalCents,
      });
    }

    return lines;
  }

  /** Returns whether one Product scope matches at least one persisted promotion target. */
  private lineMatchesScopes(
    product: PromotionProductScope,
    scopes: PromotionScopeRow[],
  ): boolean {
    return scopes.some((scope) => {
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.SELLER) {
        return scope.scopeId === product.sellerId;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.STORE) {
        return scope.scopeId === product.storeId;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.CATEGORY) {
        return scope.scopeId === product.categoryId;
      }
      if (scope.scopeType === PROMOTION_SCOPE_TYPE.PRODUCT) {
        return scope.scopeId === product.productId;
      }
      return false;
    });
  }

  /** Converts request scope objects into the repository's persistence-only input shape. */
  private toScopeRecords(scopes: ReadonlyArray<PromotionScopeInput>): PromotionScopeRecordInput[] {
    return scopes.map((scope) => ({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    }));
  }

  /** Loads scopes/coupon rows and builds one complete safe promotion response. */
  private async toPromotionResponseFromRow(
    repository: PromotionsRepository,
    promotion: PromotionRow,
  ): Promise<PromotionResponse> {
    const [scopes, coupons] = await Promise.all([
      repository.listScopesByPromotionId(promotion.id),
      repository.listCouponsByPromotionId(promotion.id),
    ]);
    return this.toPromotionResponse(promotion, scopes, coupons);
  }

  /** Converts persisted Promotion, scope, and coupon rows into the stable Module 9 response contract. */
  private toPromotionResponse(
    promotion: PromotionRow,
    scopes: PromotionScopeRow[],
    coupons: CouponRow[],
  ): PromotionResponse {
    if (coupons.length > 1) throw this.internalStateError();
    const coupon = coupons[0] ?? null;

    return {
      id: promotion.id,
      ownerType: promotion.ownerType as PromotionResponse["ownerType"],
      sellerId: promotion.sellerId,
      name: promotion.name,
      type: promotion.type,
      value: promotion.value,
      startAt: promotion.startAt.toISOString(),
      endAt: promotion.endAt.toISOString(),
      status: promotion.status as PromotionResponse["status"],
      fundingType: promotion.fundingType as PromotionResponse["fundingType"],
      scopes: scopes.map((scope) => ({
        scopeType: scope.scopeType as PromotionResponse["scopes"][number]["scopeType"],
        scopeId: scope.scopeId,
      })),
      coupon: coupon
        ? {
            id: coupon.id,
            promotionId: coupon.promotionId,
            code: coupon.code,
            maxUses: coupon.maxUses,
            maxUsesPerCustomer: coupon.maxUsesPerCustomer,
            status: coupon.status as NonNullable<PromotionResponse["coupon"]>["status"],
          }
        : null,
    };
  }

  /** Groups persisted scope rows by promotion ID for paginated list rendering without N+1 queries. */
  private groupScopesByPromotion(
    scopes: PromotionScopeRow[],
  ): Map<string, PromotionScopeRow[]> {
    const grouped = new Map<string, PromotionScopeRow[]>();
    for (const scope of scopes) {
      const items = grouped.get(scope.promotionId) ?? [];
      items.push(scope);
      grouped.set(scope.promotionId, items);
    }
    return grouped;
  }

  /** Groups persisted coupon rows by promotion ID for paginated list rendering without N+1 queries. */
  private groupCouponsByPromotion(coupons: CouponRow[]): Map<string, CouponRow[]> {
    const grouped = new Map<string, CouponRow[]>();
    for (const coupon of coupons) {
      const items = grouped.get(coupon.promotionId) ?? [];
      items.push(coupon);
      grouped.set(coupon.promotionId, items);
    }
    return grouped;
  }

  /** Converts one immutable redemption row into the downstream-safe service result. */
  private toCouponRedemptionResult(
    redemption: CouponRedemptionRow,
    promotionId: string,
  ): CouponRedemptionResult {
    return {
      id: redemption.id,
      couponId: redemption.couponId,
      promotionId,
      customerUserId: redemption.customerUserId,
      orderId: redemption.orderId,
      redeemedAt: redemption.redeemedAt.toISOString(),
    };
  }

  /** Maps only known database uniqueness failures to a stable coupon contract error. */
  private mapPromotionWriteError(error: unknown): unknown {
    if (
      databaseErrorCode(error) === "23505" &&
      databaseConstraint(error) === "coupons_code_uq"
    ) {
      return promotionError(
        PROMOTION_ERROR_CODE.COUPON_INVALID,
        "Coupon code is already in use.",
        409,
      );
    }
    return error;
  }

  /** Builds the required not-found error without exposing unauthorized promotion details. */
  private promotionNotFound(): AppError {
    return promotionError(
      PROMOTION_ERROR_CODE.PROMOTION_NOT_FOUND,
      "Promotion not found.",
      404,
    );
  }

  /** Builds the required invalid/inactive coupon error. */
  private couponInvalid(): AppError {
    return promotionError(
      PROMOTION_ERROR_CODE.COUPON_INVALID,
      "Coupon is invalid or inactive.",
      409,
    );
  }

  /** Builds the required coupon usage-limit error. */
  private couponLimitReached(): AppError {
    return promotionError(
      PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
      "Coupon usage limit has been reached.",
      409,
    );
  }

  /** Builds the required seller/resource promotion-scope error. */
  private promotionScopeForbidden(): AppError {
    return promotionError(
      PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
      "Promotion scope is not allowed.",
      403,
    );
  }

  /** Builds a customer-safe scope-mismatch error without exposing private seller or Product ownership. */
  private promotionScopeForbiddenForCart(): AppError {
    return promotionError(
      PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
      "Coupon does not apply to the current cart.",
      409,
    );
  }

  /** Builds one internal invariant failure reserved for impossible persisted aggregate states. */
  private internalStateError(): AppError {
    return promotionError(
      ERROR_CODE.INTERNAL_ERROR,
      "Promotion state could not be completed safely.",
      500,
    );
  }
}

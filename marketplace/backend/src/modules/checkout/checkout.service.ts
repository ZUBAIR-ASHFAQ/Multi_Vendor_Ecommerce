import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AppError, isAppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import {
  IdempotencyService,
  type BeginIdempotentOperationResult,
} from "../../common/idempotency/idempotency.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { db } from "../../database/db.js";
import type { CheckoutAttemptRow, CheckoutQuoteRow } from "../../database/schema/checkout.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AdministrationService } from "../administration/administration.service.js";
import type { CartResponse } from "../cart-wishlist/cart-wishlist.schema.js";
import { CartWishlistService } from "../cart-wishlist/cart-wishlist.service.js";
import { CUSTOMER_ERROR_CODE } from "../customers/customers.constants.js";
import type { CustomerAddressResponse } from "../customers/customers.schema.js";
import { CustomersService } from "../customers/customers.service.js";
import { INVENTORY_ERROR_CODE } from "../inventory/inventory.constants.js";
import type { ReserveStockInput, StockReservationResponse } from "../inventory/inventory.schema.js";
import {
  InventoryService,
  type CheckoutInventoryAvailability,
  type CheckoutInventoryRequest,
} from "../inventory/inventory.service.js";
import type { CheckoutProductVariant } from "../products/products.service.js";
import { ProductsService } from "../products/products.service.js";
import { PROMOTION_ERROR_CODE } from "../promotions/promotions.constants.js";
import {
  PromotionsService,
  type CheckoutPromotionEvaluationInput,
  type CheckoutPromotionEvaluationResult,
  type CouponRedemptionResult,
  type RecordCouponRedemptionInput,
} from "../promotions/promotions.service.js";
import type { ShippingOptionsResponse } from "../shipping/shipping.schema.js";
import { ShippingService } from "../shipping/shipping.service.js";
import { OrdersService } from "../orders/orders.service.js";
import type { CreateOrderFromCheckoutInput } from "../orders/orders.schema.js";
import {
  CHECKOUT_ATTEMPT_STATUS,
  CHECKOUT_CONFIRM_REQUEST_VERSION,
  CHECKOUT_ERROR_CODE,
  CHECKOUT_IDEMPOTENCY_SCOPE_PREFIX,
  CHECKOUT_LIMITS,
  CHECKOUT_OUTBOX_EVENT,
  CHECKOUT_PERMISSION,
  CHECKOUT_SOURCE,
  CHECKOUT_STATE_VERSION,
} from "./checkout.constants.js";
import {
  CheckoutRepository,
  type CreateCheckoutQuoteLineRecordInput,
  type CreateCheckoutQuoteShippingSelectionRecordInput,
} from "./checkout.repository.js";
import {
  checkoutAttemptContractSchema,
  type CheckoutAttemptContract,
  type CheckoutQuoteWithLinesContract,
  type CreateCheckoutQuoteInput,
} from "./checkout.schema.js";

/** Runs one Checkout transaction and allows focused service tests to replace the real database boundary. */
export type CheckoutTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Customer boundary used to resolve active customer-owned addresses without importing Customer persistence. */
export interface CheckoutCustomerIntegration {
  /** Returns one active saved address owned by the authenticated customer. */
  resolveActiveOwnedAddress(
    context: RequestContext,
    addressId: string,
  ): Promise<CustomerAddressResponse>;
}

/** Cart boundary used to reload current customer intent without trusting client Cart identifiers or totals. */
export interface CheckoutCartIntegration {
  /** Returns the authenticated customer's current server-backed Cart preview. */
  getCheckoutCart(context: RequestContext): Promise<CartResponse>;
}

/** Product boundary used to resolve the current sellable variant and authoritative commerce ownership facts. */
export interface CheckoutProductIntegration {
  /** Resolves one current public/sellable variant for Checkout. */
  resolveVariantForCheckout(variantId: string): Promise<CheckoutProductVariant | null>;
}

/** Inventory read boundary used before quote persistence and confirmation. */
export interface CheckoutInventoryReadIntegration {
  /** Returns exact current available quantity for every requested variant. */
  getCheckoutAvailability(
    requests: CheckoutInventoryRequest[],
  ): Promise<CheckoutInventoryAvailability[]>;
}

/** Transaction-bound Inventory boundary used for reservation creation during Checkout confirmation. */
export interface CheckoutInventoryTransactionIntegration
  extends CheckoutInventoryReadIntegration {
  /** Creates one idempotent reservation inside the existing Checkout transaction. */
  reserveStock(
    context: RequestContext,
    input: ReserveStockInput,
  ): Promise<StockReservationResponse>;
}

/** Promotion boundary used to calculate the authoritative discount and per-variant allocation. */
export interface CheckoutPromotionIntegration {
  /** Recalculates the current Checkout coupon decision from server-resolved Product lines. */
  calculateCheckoutDiscounts(
    input: CheckoutPromotionEvaluationInput,
  ): Promise<CheckoutPromotionEvaluationResult>;
}

/** Transaction-bound Promotion command used after an authoritative Order ID exists. */
export interface CheckoutPromotionTransactionIntegration {
  /** Records one coupon redemption inside the existing Checkout confirmation transaction. */
  recordCouponRedemption(
    input: RecordCouponRedemptionInput,
  ): Promise<CouponRedemptionResult>;
}

/** Shipping boundary used to revalidate current methods/rates for server-derived store groups. */
export interface CheckoutShippingIntegration {
  /** Returns currently eligible Shipping Core methods for the authenticated customer's Cart and address. */
  getCheckoutShippingOptions(
    context: RequestContext,
    query: { addressId: string; variantId?: string; quantity?: number },
  ): Promise<ShippingOptionsResponse>;
}

/** Administration boundary used for supported-currency and Checkout tax configuration reads. */
export interface CheckoutAdministrationIntegration {
  /** Returns whether one normalized currency is currently supported. */
  isSupportedCurrency(currency: string): Promise<boolean>;

  /** Returns the current canonical Checkout tax percentage. */
  getDefaultTaxRatePercent(): Promise<string>;
}

/** Orders boundary used only after final Checkout revalidation and Inventory reservation creation. */
export interface CheckoutOrdersIntegration {
  /** Materializes the immutable parent/Seller Order snapshot inside the existing Checkout transaction. */
  createFromCheckout(
    context: RequestContext,
    input: CreateOrderFromCheckoutInput,
  ): Promise<{ id: string; orderNo: string }>;
}

/** Foundation idempotency boundary used by Checkout confirmation. */
export interface CheckoutIdempotencyIntegration {
  /** Acquires or resolves one customer-scoped confirmation key. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores the stable successful confirmation result for exact retries. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Marks a failed in-progress operation so a later retry can safely reacquire it. */
  fail(recordId: string): Promise<void>;
}

/** Explicit dependencies keep Checkout orchestration readable and independently testable. */
export interface CheckoutServiceDependencies {
  repository?: CheckoutRepository;
  transactionRunner?: CheckoutTransactionRunner;
  customers?: CheckoutCustomerIntegration;
  cart?: CheckoutCartIntegration;
  products?: CheckoutProductIntegration;
  inventory?: CheckoutInventoryReadIntegration;
  inventoryUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => CheckoutInventoryTransactionIntegration;
  promotions?: CheckoutPromotionIntegration;
  promotionsUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => CheckoutPromotionTransactionIntegration;
  shipping?: CheckoutShippingIntegration;
  administration?: CheckoutAdministrationIntegration;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => CheckoutOrdersIntegration;
  idempotency?: CheckoutIdempotencyIntegration;
  now?: () => Date;
  quoteTtlSeconds?: number;
  attemptTtlSeconds?: number;
}

/** One normalized input shipping selection before authoritative Shipping Core validation. */
interface RequestedShippingSelection {
  storeId: string;
  shippingMethodId: string;
}

/** One direct variant/quantity intent used by Buy Now without mutating the customer Cart. */
interface CheckoutBuyNowIntent {
  variantId: string;
  quantity: number;
}

/** Server-resolved products plus quantities for either Cart Checkout or one Buy Now item. */
interface ResolvedCheckoutIntent {
  products: CheckoutProductVariant[];
  quantityByVariant: ReadonlyMap<string, number>;
  currency: string;
}

/** One complete server-rebuilt quote snapshot before persistence or confirmation comparison. */
interface AuthoritativeCheckoutSnapshot {
  shippingAddress: CustomerAddressResponse;
  billingAddress: CustomerAddressResponse;
  currency: string;
  couponCode: string | null;
  taxRatePercent: string;
  products: CheckoutProductVariant[];
  lines: CreateCheckoutQuoteLineRecordInput[];
  shippingSelections: CreateCheckoutQuoteShippingSelectionRecordInput[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  stateHash: string;
}

/** Checkout snapshot build phase used only to map stale confirmation inputs to the approved error codes. */
type SnapshotPhase = "quote" | "confirm";

/** Canonical four-decimal scale used by Checkout money calculations. */
const MONEY_FACTOR = 10_000n;

/** Canonical divisor used when applying a scale-4 percentage to scale-4 money. */
const PERCENT_FACTOR = 100n * MONEY_FACTOR;

/** Converts one non-negative decimal string into an exact integer at four-decimal Checkout scale. */
function decimalToScale4(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const paddedFraction = `${fraction}0000`.slice(0, 4);
  return BigInt(whole) * MONEY_FACTOR + BigInt(paddedFraction || "0");
}

/** Converts an exact non-negative scale-4 integer into Checkout's canonical money string. */
function scale4ToMoney(value: bigint): string {
  const whole = value / MONEY_FACTOR;
  const fraction = (value % MONEY_FACTOR).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** Divides positive integer values using deterministic half-up rounding. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Checkout rounding denominator must be positive.");
  return (numerator + denominator / 2n) / denominator;
}

/** Normalizes one optional coupon exactly as Module 9 expects before persistence and hashing. */
function normalizeCouponCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/** Builds a lowercase SHA-256 hexadecimal digest for one already-canonical UTF-8 string. */
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Creates one stable Checkout application error. */
function checkoutError(code: string, message: string, statusCode: number): AppError {
  return new AppError({ code, message, statusCode });
}

/** Validates an injected/default Checkout TTL against the approved 5-to-60-minute range. */
function validateCheckoutTtl(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 300 || value > 3600) {
    throw new Error(`${label} must be an integer between 300 and 3600 seconds.`);
  }
  return value;
}

/** Module 10 service for authoritative quote creation, confirmation, status reads, and Order/Payment handoff. */
export class CheckoutService {
  private readonly repository: CheckoutRepository;
  private readonly transactionRunner: CheckoutTransactionRunner;
  private readonly customers: CheckoutCustomerIntegration;
  private readonly cart: CheckoutCartIntegration;
  private readonly products: CheckoutProductIntegration;
  private readonly inventory: CheckoutInventoryReadIntegration;
  private readonly inventoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CheckoutInventoryTransactionIntegration;
  private readonly promotions: CheckoutPromotionIntegration;
  private readonly promotionsUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CheckoutPromotionTransactionIntegration;
  private readonly shipping: CheckoutShippingIntegration;
  private readonly administration: CheckoutAdministrationIntegration;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => CheckoutOrdersIntegration;
  private readonly idempotency: CheckoutIdempotencyIntegration;
  private readonly now: () => Date;
  private readonly quoteTtlSeconds: number;
  private readonly attemptTtlSeconds: number;

  /** Stores explicit dependencies while keeping normal application composition straightforward. */
  constructor(dependencies: CheckoutServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new CheckoutRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.customers = dependencies.customers ?? new CustomersService();
    this.cart = dependencies.cart ?? new CartWishlistService();
    this.products = dependencies.products ?? new ProductsService();
    this.inventory = dependencies.inventory ?? new InventoryService();
    this.inventoryUsingTransaction =
      dependencies.inventoryUsingTransaction ?? ((transaction) => InventoryService.using(transaction));
    this.promotions = dependencies.promotions ?? new PromotionsService();
    this.promotionsUsingTransaction =
      dependencies.promotionsUsingTransaction ?? ((transaction) => PromotionsService.using(transaction));
    this.shipping = dependencies.shipping ?? new ShippingService();
    this.administration = dependencies.administration ?? new AdministrationService();
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.now = dependencies.now ?? (() => new Date());
    this.quoteTtlSeconds = validateCheckoutTtl(
      dependencies.quoteTtlSeconds ?? env.CHECKOUT_QUOTE_TTL_SECONDS,
      "CHECKOUT_QUOTE_TTL_SECONDS",
    );
    this.attemptTtlSeconds = validateCheckoutTtl(
      dependencies.attemptTtlSeconds ?? env.CHECKOUT_ATTEMPT_TTL_SECONDS,
      "CHECKOUT_ATTEMPT_TTL_SECONDS",
    );
  }

  /** Creates and persists one short-lived authoritative quote from the customer's Cart or Buy Now item and selections. */
  async createQuote(
    context: RequestContext,
    input: CreateCheckoutQuoteInput,
  ): Promise<CheckoutQuoteWithLinesContract> {
    const customerUserId = this.requireCustomerActor(
      context,
      CHECKOUT_PERMISSION.CREATE_OWN,
    );
    const normalizedInput = this.normalizeCreateQuoteInput(input);
    const snapshot = await this.buildAuthoritativeSnapshot(
      context,
      customerUserId,
      normalizedInput,
      "quote",
    );
    const expiresAt = new Date(this.now().getTime() + this.quoteTtlSeconds * 1_000);

    return this.transactionRunner(async (transaction) => {
      const repository = new CheckoutRepository(transaction);
      const quote = await repository.createQuote({
        customerUserId,
        shippingAddressId: snapshot.shippingAddress.id,
        billingAddressId: snapshot.billingAddress.id,
        couponCode: snapshot.couponCode,
        source: normalizedInput.buyNowItem ? CHECKOUT_SOURCE.BUY_NOW : CHECKOUT_SOURCE.CART,
        currency: snapshot.currency,
        subtotal: snapshot.subtotal,
        discountTotal: snapshot.discountTotal,
        taxTotal: snapshot.taxTotal,
        shippingTotal: snapshot.shippingTotal,
        grandTotal: snapshot.grandTotal,
        expiresAt,
        stateHash: snapshot.stateHash,
      });
      const lines = await repository.createQuoteLines(quote.id, snapshot.lines);
      const shippingSelections = await repository.createQuoteShippingSelections(
        quote.id,
        snapshot.shippingSelections,
      );

      await OutboxService.using(transaction).enqueue({
        eventType: CHECKOUT_OUTBOX_EVENT.QUOTED,
        aggregateType: "checkout.quote",
        aggregateId: quote.id,
        payload: {
          quoteId: quote.id,
          customerUserId,
          currency: quote.currency,
          grandTotal: quote.grandTotal,
          expiresAt: quote.expiresAt.toISOString(),
        },
      });

      return this.toQuoteResponse(quote, lines, shippingSelections);
    });
  }

  /** Reads one unexpired quote only when it belongs to the authenticated customer. */
  async getQuote(
    context: RequestContext,
    quoteId: string,
  ): Promise<CheckoutQuoteWithLinesContract> {
    const customerUserId = this.requireCustomerActor(
      context,
      CHECKOUT_PERMISSION.CREATE_OWN,
    );
    const quote = await this.repository.findQuoteForCustomer(quoteId, customerUserId);
    if (!quote) throw this.quoteNotFound();
    if (quote.expiresAt.getTime() <= this.now().getTime()) throw this.quoteExpired();

    const [lines, shippingSelections] = await Promise.all([
      this.repository.listQuoteLinesForCustomer(quoteId, customerUserId),
      this.repository.listQuoteShippingSelectionsForCustomer(quoteId, customerUserId),
    ]);

    return this.toQuoteResponse(quote, lines, shippingSelections);
  }

  /** Confirms one quote exactly once, creating the Checkout attempt and all Inventory reservations atomically. */
  async confirmQuote(
    context: RequestContext,
    quoteId: string,
    stateHash: string,
    idempotencyKey: string,
  ): Promise<CheckoutAttemptContract> {
    const customerUserId = this.requireCustomerActor(
      context,
      CHECKOUT_PERMISSION.CONFIRM_OWN,
    );
    const normalizedKey = idempotencyKey.trim();
    const normalizedStateHash = stateHash;
    this.assertConfirmationInputIsValid(normalizedKey, normalizedStateHash);
    const requestHash = this.buildConfirmationRequestHash(quoteId, normalizedStateHash);
    const idempotencyScope = `${CHECKOUT_IDEMPOTENCY_SCOPE_PREFIX}:${customerUserId}`;

    let idempotencyResult: BeginIdempotentOperationResult;
    try {
      idempotencyResult = await this.idempotency.begin(
        {
          scope: idempotencyScope,
          key: normalizedKey,
          requestHash,
        },
        this.now(),
      );
    } catch (error) {
      if (isAppError(error) && error.code === ERROR_CODE.IDEMPOTENCY_CONFLICT) {
        await this.recordIdempotencyConflict(context, quoteId, normalizedKey);
      }
      throw this.mapIdempotencyError(error);
    }

    if (idempotencyResult.mode === "replay") {
      return this.parseIdempotencyReplay(idempotencyResult.replay.responseBody);
    }

    const recordId = idempotencyResult.recordId;
    try {
      const attempt = await this.transactionRunner(async (transaction) =>
        this.confirmQuoteInsideTransaction(
          transaction,
          context,
          customerUserId,
          quoteId,
          normalizedStateHash,
          normalizedKey,
        ),
      );
      await this.idempotency.complete(recordId, 200, attempt);
      return attempt;
    } catch (error) {
      await this.markIdempotencyFailedWithoutMasking(recordId);
      throw error;
    }
  }

  /** Reads the current customer-owned Checkout attempt without mutating the post-Order lifecycle. */
  async getAttemptStatus(
    context: RequestContext,
    attemptId: string,
  ): Promise<CheckoutAttemptContract> {
    const customerUserId = this.requireCustomerActor(
      context,
      CHECKOUT_PERMISSION.CONFIRM_OWN,
    );
    const attempt = await this.repository.findAttemptForCustomer(attemptId, customerUserId);
    if (!attempt) throw this.attemptNotFound();

    return this.toAttemptResponse(attempt);
  }

  /** Runs the ordered Patch 0004 confirmation checks and writes one attempt/reservation set inside one transaction. */
  private async confirmQuoteInsideTransaction(
    transaction: DatabaseTransaction,
    context: RequestContext,
    customerUserId: string,
    quoteId: string,
    submittedStateHash: string,
    idempotencyKey: string,
  ): Promise<CheckoutAttemptContract> {
    const repository = new CheckoutRepository(transaction);
    const quote = await repository.lockQuoteForCustomer(quoteId, customerUserId);
    if (!quote) throw this.quoteNotFound();
    if (quote.expiresAt.getTime() <= this.now().getTime()) throw this.quoteExpired();
    if (submittedStateHash !== quote.stateHash) throw this.priceChanged("The quote state changed.");

    const existingAttempt = await repository.findAttemptByQuoteForCustomer(
      quote.id,
      customerUserId,
    );
    if (existingAttempt) return this.toAttemptResponse(existingAttempt);

    const [storedLines, storedSelections] = await Promise.all([
      repository.listQuoteLinesForCustomer(quote.id, customerUserId),
      repository.listQuoteShippingSelectionsForCustomer(quote.id, customerUserId),
    ]);
    const shippingAddressId = quote.shippingAddressId;
    const billingAddressId = quote.billingAddressId;
    if (!shippingAddressId || !billingAddressId) throw this.priceChanged("The quote is no longer confirmable.");

    const snapshot = await this.buildAuthoritativeSnapshot(
      context,
      customerUserId,
      {
        shippingAddressId,
        billingAddressId,
        couponCode: quote.couponCode,
        shippingSelections: storedSelections.map((selection) => ({
          storeId: selection.storeId,
          shippingMethodId: selection.shippingMethodId,
        })),
        buyNowItem:
          quote.source === CHECKOUT_SOURCE.BUY_NOW
            ? this.buyNowIntentFromStoredLines(storedLines)
            : null,
      },
      "confirm",
    );

    this.assertStoredQuoteStillMatches(quote, storedLines, storedSelections, snapshot);

    const expiresAt = new Date(this.now().getTime() + this.attemptTtlSeconds * 1_000);
    const attempt = await repository.createAttempt({
      quoteId: quote.id,
      customerUserId,
      status: CHECKOUT_ATTEMPT_STATUS.CONFIRMED,
      idempotencyKey,
      expiresAt,
    });
    const inventory = this.inventoryUsingTransaction(transaction);
    const reservationIdByVariant = new Map<string, string>();

    try {
      for (const line of snapshot.lines) {
        const reservation = await inventory.reserveStock(context, {
          variantId: line.variantId,
          customerUserId,
          orderAttemptId: attempt.id,
          quantity: line.qty,
          expiresAt: expiresAt.toISOString(),
          sourceKey: `checkout:${attempt.id}:${line.variantId}`,
        });
        reservationIdByVariant.set(line.variantId, reservation.id);
      }
    } catch (error) {
      if (
        isAppError(error) &&
        (error.code === INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK ||
          error.code === INVENTORY_ERROR_CODE.INVENTORY_NOT_FOUND)
      ) {
        throw this.stockChanged();
      }
      throw error;
    }

    const orderInput = this.buildOrderCreationInput(
      attempt.id,
      customerUserId,
      snapshot,
      reservationIdByVariant,
    );
    const order = await this.ordersUsingTransaction(transaction).createFromCheckout(
      context,
      orderInput,
    );
    await this.recordCouponRedemption(
      transaction,
      snapshot.couponCode,
      customerUserId,
      order.id,
    );
    const linkedAttempt = await repository.attachOrderToAttempt(
      attempt.id,
      customerUserId,
      order.id,
    );
    if (!linkedAttempt) {
      throw checkoutError(
        ERROR_CODE.INTERNAL_ERROR,
        "Checkout attempt could not be linked to its Order.",
        500,
      );
    }

    await OutboxService.using(transaction).enqueue({
      eventType: CHECKOUT_OUTBOX_EVENT.CONFIRMED,
      aggregateType: "checkout.attempt",
      aggregateId: linkedAttempt.id,
      payload: {
        attemptId: linkedAttempt.id,
        quoteId: quote.id,
        orderId: order.id,
        customerUserId,
        expiresAt: linkedAttempt.expiresAt.toISOString(),
      },
    });

    return this.toAttemptResponse(linkedAttempt);
  }

  /** Records the selected coupon inside the same transaction as Order creation so usage limits cannot drift. */
  private async recordCouponRedemption(
    transaction: DatabaseTransaction,
    couponCode: string | null,
    customerUserId: string,
    orderId: string,
  ): Promise<void> {
    if (!couponCode) return;

    try {
      await this.promotionsUsingTransaction(transaction).recordCouponRedemption({
        code: couponCode,
        customerUserId,
        orderId,
      });
    } catch (error) {
      if (
        isAppError(error) &&
        [
          PROMOTION_ERROR_CODE.COUPON_INVALID,
          PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
          PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
          PROMOTION_ERROR_CODE.PROMOTION_NOT_FOUND,
        ].includes(error.code as (typeof PROMOTION_ERROR_CODE)[keyof typeof PROMOTION_ERROR_CODE])
      ) {
        throw this.promotionChanged();
      }
      throw error;
    }
  }

  /** Builds the trusted immutable Orders DTO from the final Checkout snapshot and newly created reservations. */
  private buildOrderCreationInput(
    checkoutAttemptId: string,
    customerUserId: string,
    snapshot: AuthoritativeCheckoutSnapshot,
    reservationIdByVariant: Map<string, string>,
  ): CreateOrderFromCheckoutInput {
    const productByVariant = new Map(
      snapshot.products.map((product) => [product.variantId, product]),
    );

    const lines = snapshot.lines.map((line) => {
      const product = productByVariant.get(line.variantId);
      const inventoryReservationId = reservationIdByVariant.get(line.variantId);
      if (!product || !inventoryReservationId) {
        throw checkoutError(
          ERROR_CODE.INTERNAL_ERROR,
          "Checkout could not build the immutable Order snapshot.",
          500,
        );
      }

      return {
        productId: product.productId,
        variantId: line.variantId,
        sellerId: line.sellerId,
        storeId: line.storeId,
        inventoryReservationId,
        skuSnapshot: product.skuSnapshot,
        nameSnapshot: product.nameSnapshot,
        variantTitleSnapshot: product.variantTitleSnapshot,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        discountAllocated: line.discount,
        taxAllocated: line.tax,
        lineTotal: line.lineTotal,
      };
    });

    return {
      checkoutAttemptId,
      customerUserId,
      currency: snapshot.currency,
      subtotal: snapshot.subtotal,
      discountTotal: snapshot.discountTotal,
      taxTotal: snapshot.taxTotal,
      shippingTotal: snapshot.shippingTotal,
      grandTotal: snapshot.grandTotal,
      shippingAddress: this.toOrderAddressSnapshot(snapshot.shippingAddress),
      billingAddress: this.toOrderAddressSnapshot(snapshot.billingAddress),
      lines,
      shippingSelections: snapshot.shippingSelections.map((selection) => ({
        sellerId: selection.sellerId,
        storeId: selection.storeId,
        shippingMethodId: selection.shippingMethodId,
        shippingMethodCodeSnapshot: selection.shippingMethodCodeSnapshot,
        shippingMethodNameSnapshot: selection.shippingMethodNameSnapshot,
        amount: selection.amount,
        currency: selection.currency,
      })),
    };
  }

  /** Converts one final customer-owned address into the immutable Orders address snapshot shape. */
  private toOrderAddressSnapshot(address: CustomerAddressResponse) {
    return {
      sourceAddressId: address.id,
      recipientName: address.recipientName.trim(),
      phone: address.phone.trim(),
      line1: address.line1.trim(),
      line2: address.line2 === null ? null : address.line2.trim(),
      city: address.city.trim(),
      region: address.region.trim(),
      postalCode: address.postalCode === null ? null : address.postalCode.trim(),
      countryCode: address.countryCode.trim().toUpperCase(),
    };
  }

  /** Rebuilds one quote from current Product/Inventory/Promotion/Shipping/Administration state and its persisted source. */
  private async buildAuthoritativeSnapshot(
    context: RequestContext,
    customerUserId: string,
    input: {
      shippingAddressId: string;
      billingAddressId: string;
      couponCode: string | null;
      shippingSelections: RequestedShippingSelection[];
      buyNowItem: CheckoutBuyNowIntent | null;
    },
    phase: SnapshotPhase,
  ): Promise<AuthoritativeCheckoutSnapshot> {
    const shippingAddress = await this.resolveCheckoutAddress(
      context,
      input.shippingAddressId,
    );
    const billingAddress =
      input.billingAddressId === input.shippingAddressId
        ? shippingAddress
        : await this.resolveCheckoutAddress(context, input.billingAddressId);
    const intent = await this.resolveCheckoutIntent(context, input.buyNowItem);
    const { products, quantityByVariant, currency } = intent;
    const availability = await this.inventory.getCheckoutAvailability(
      products.map((product) => ({
        variantId: product.variantId,
        quantity: quantityByVariant.get(product.variantId) ?? 0,
      })),
    );
    if (availability.some((item) => !item.sufficient)) throw this.stockChanged();

    const promotion = await this.calculatePromotion(
      customerUserId,
      currency,
      input.couponCode,
      quantityByVariant,
      products,
    );
    const shipping = await this.resolveShippingSelections(
      context,
      input.shippingAddressId,
      input.shippingSelections,
      currency,
      phase,
      input.buyNowItem,
    );
    const taxRatePercent = await this.administration.getDefaultTaxRatePercent();
    const lines = this.calculateLines(quantityByVariant, products, promotion, taxRatePercent);
    const subtotalValue = lines.reduce(
      (total, line) => total + decimalToScale4(line.unitPrice) * BigInt(line.qty),
      0n,
    );
    const discountValue = lines.reduce(
      (total, line) => total + decimalToScale4(line.discount),
      0n,
    );
    const taxValue = lines.reduce(
      (total, line) => total + decimalToScale4(line.tax),
      0n,
    );
    if (scale4ToMoney(discountValue) !== promotion.discountTotal) {
      throw this.promotionChanged();
    }
    const shippingValue = shipping.reduce(
      (total, selection) => total + decimalToScale4(selection.amount),
      0n,
    );
    const grandValue = subtotalValue - discountValue + taxValue + shippingValue;
    const totals = {
      subtotal: scale4ToMoney(subtotalValue),
      discountTotal: scale4ToMoney(discountValue),
      taxTotal: scale4ToMoney(taxValue),
      shippingTotal: scale4ToMoney(shippingValue),
      grandTotal: scale4ToMoney(grandValue),
    };
    const couponCode = normalizeCouponCode(promotion.couponCode);
    const stateHash = this.buildStateHash({
      customerUserId,
      currency,
      couponCode,
      shippingAddress,
      billingAddress,
      taxRatePercent,
      lines,
      shippingSelections: shipping,
      totals,
    });

    return {
      shippingAddress,
      billingAddress,
      currency,
      couponCode,
      taxRatePercent,
      products,
      lines,
      shippingSelections: shipping,
      ...totals,
      stateHash,
    };
  }

  /** Resolves either the current Cart or one direct Buy Now variant into the same authoritative pricing intent. */
  private async resolveCheckoutIntent(
    context: RequestContext,
    buyNowItem: CheckoutBuyNowIntent | null,
  ): Promise<ResolvedCheckoutIntent> {
    if (buyNowItem) {
      const product = await this.products.resolveVariantForCheckout(buyNowItem.variantId);
      if (!product) {
        throw this.priceChanged("The selected Buy Now item is no longer purchasable.");
      }
      return {
        products: [product],
        quantityByVariant: new Map([[product.variantId, buyNowItem.quantity]]),
        currency: product.currency.trim().toUpperCase(),
      };
    }

    const cart = await this.cart.getCheckoutCart(context);
    if (cart.items.length === 0) {
      throw checkoutError(ERROR_CODE.INVALID_REQUEST, "The cart is empty.", 422);
    }
    if (cart.hasUnavailableItems) {
      throw this.priceChanged("A cart item is no longer purchasable.");
    }

    const products = await this.resolveCurrentProducts(cart);
    return {
      products,
      quantityByVariant: new Map(cart.items.map((item) => [item.variantId, item.quantity])),
      currency: this.requireSingleSupportedCurrency(cart, products),
    };
  }

  /** Resolves and normalizes the two selected addresses while mapping Customer errors to Checkout's stable code. */
  private async resolveCheckoutAddress(
    context: RequestContext,
    addressId: string,
  ): Promise<CustomerAddressResponse> {
    try {
      return await this.customers.resolveActiveOwnedAddress(context, addressId);
    } catch (error) {
      if (
        isAppError(error) &&
        [
          CUSTOMER_ERROR_CODE.CUSTOMER_NOT_FOUND,
          CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND,
          CUSTOMER_ERROR_CODE.ADDRESS_SCOPE_FORBIDDEN,
        ].includes(error.code as (typeof CUSTOMER_ERROR_CODE)[keyof typeof CUSTOMER_ERROR_CODE])
      ) {
        throw this.addressInvalid();
      }
      throw error;
    }
  }

  /** Resolves every Cart variant from Product and rejects stale ownership/product references. */
  private async resolveCurrentProducts(cart: CartResponse): Promise<CheckoutProductVariant[]> {
    const resolved: CheckoutProductVariant[] = [];

    for (const item of [...cart.items].sort((left, right) => left.variantId.localeCompare(right.variantId))) {
      const product = await this.products.resolveVariantForCheckout(item.variantId);
      if (!product || product.productId !== item.productId) {
        throw this.priceChanged("A cart product is no longer purchasable.");
      }
      resolved.push(product);
    }

    return resolved;
  }

  /** Requires all current Product lines and the Cart to use one still-supported Checkout currency. */
  private requireSingleSupportedCurrency(
    cart: CartResponse,
    products: CheckoutProductVariant[],
  ): string {
    const currency = cart.currency.trim().toUpperCase();
    if (products.some((product) => product.currency.trim().toUpperCase() !== currency)) {
      throw this.priceChanged("The cart currency changed.");
    }
    return currency;
  }

  /** Checks the normalized Checkout currency against Administration before totals are calculated. */
  private async assertCurrencySupported(currency: string): Promise<void> {
    if (!(await this.administration.isSupportedCurrency(currency))) {
      throw this.priceChanged("The Checkout currency is no longer supported.");
    }
  }

  /** Calculates the current Promotion decision and maps coupon-rule failures to Checkout's stable Promotion code. */
  private async calculatePromotion(
    customerUserId: string,
    currency: string,
    couponCode: string | null,
    quantityByVariant: ReadonlyMap<string, number>,
    products: CheckoutProductVariant[],
  ): Promise<CheckoutPromotionEvaluationResult> {
    await this.assertCurrencySupported(currency);

    try {
      return await this.promotions.calculateCheckoutDiscounts({
        customerUserId,
        currency,
        couponCode,
        lines: products.map((product) => ({
          productId: product.productId,
          variantId: product.variantId,
          sellerId: product.sellerId,
          storeId: product.storeId,
          categoryId: product.categoryId,
          quantity: quantityByVariant.get(product.variantId) ?? 0,
          unitPrice: product.unitPrice,
          currency: product.currency,
        })),
      });
    } catch (error) {
      if (
        isAppError(error) &&
        [
          PROMOTION_ERROR_CODE.COUPON_INVALID,
          PROMOTION_ERROR_CODE.COUPON_LIMIT_REACHED,
          PROMOTION_ERROR_CODE.PROMOTION_SCOPE_FORBIDDEN,
          PROMOTION_ERROR_CODE.PROMOTION_NOT_FOUND,
        ].includes(error.code as (typeof PROMOTION_ERROR_CODE)[keyof typeof PROMOTION_ERROR_CODE])
      ) {
        throw this.promotionChanged();
      }
      throw error;
    }
  }

  /** Revalidates exactly one selected Shipping method per current store group and snapshots its current flat rate. */
  private async resolveShippingSelections(
    context: RequestContext,
    shippingAddressId: string,
    requestedSelections: RequestedShippingSelection[],
    currency: string,
    phase: SnapshotPhase,
    buyNowItem: CheckoutBuyNowIntent | null,
  ): Promise<CreateCheckoutQuoteShippingSelectionRecordInput[]> {
    const selectionByStore = new Map<string, RequestedShippingSelection>();
    for (const selection of requestedSelections) {
      if (selectionByStore.has(selection.storeId)) {
        throw checkoutError(
          ERROR_CODE.INVALID_REQUEST,
          "Each store may have only one Checkout shipping selection.",
          422,
        );
      }
      selectionByStore.set(selection.storeId, selection);
    }

    let options: ShippingOptionsResponse;
    try {
      options = await this.shipping.getCheckoutShippingOptions(context, {
        addressId: shippingAddressId,
        ...(buyNowItem
          ? { variantId: buyNowItem.variantId, quantity: buyNowItem.quantity }
          : {}),
      });
    } catch (error) {
      if (
        isAppError(error) &&
        [
          CUSTOMER_ERROR_CODE.CUSTOMER_NOT_FOUND,
          CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND,
          CUSTOMER_ERROR_CODE.ADDRESS_SCOPE_FORBIDDEN,
        ].includes(error.code as (typeof CUSTOMER_ERROR_CODE)[keyof typeof CUSTOMER_ERROR_CODE])
      ) {
        throw this.addressInvalid();
      }
      if (isAppError(error) && error.statusCode >= 400 && error.statusCode < 500) {
        throw this.priceChanged("Shipping options changed.");
      }
      throw error;
    }

    if (options.currency !== currency) throw this.priceChanged("Shipping currency changed.");
    const groupStoreIds = new Set(options.groups.map((group) => group.storeId));
    const exactGroupMatch =
      groupStoreIds.size === selectionByStore.size &&
      [...groupStoreIds].every((storeId) => selectionByStore.has(storeId));
    if (!exactGroupMatch) {
      if (phase === "confirm") throw this.priceChanged("Shipping groups changed.");
      throw checkoutError(
        ERROR_CODE.INVALID_REQUEST,
        "Select exactly one shipping method for every store group.",
        422,
      );
    }

    return [...options.groups]
      .sort((left, right) => left.storeId.localeCompare(right.storeId))
      .map((group) => {
        const requested = selectionByStore.get(group.storeId);
        if (!requested) throw this.priceChanged("Shipping groups changed.");
        const option = group.options.find((candidate) => candidate.id === requested.shippingMethodId);
        if (!option) throw this.priceChanged("A selected shipping method is no longer available.");
        if (option.currency !== currency) throw this.priceChanged("Shipping currency changed.");

        return {
          sellerId: group.sellerId,
          storeId: group.storeId,
          shippingMethodId: option.id,
          shippingMethodCodeSnapshot: option.code,
          shippingMethodNameSnapshot: option.name,
          amount: scale4ToMoney(decimalToScale4(option.rate)),
          currency: option.currency,
        };
      });
  }

  /** Calculates immutable quote lines with exact scale-4 discount and per-line tax arithmetic. */
  private calculateLines(
    quantityByVariant: ReadonlyMap<string, number>,
    products: CheckoutProductVariant[],
    promotion: CheckoutPromotionEvaluationResult,
    taxRatePercent: string,
  ): CreateCheckoutQuoteLineRecordInput[] {
    const discountByVariant = new Map(
      promotion.allocations.map((allocation) => [
        allocation.variantId,
        decimalToScale4(allocation.discountAmount),
      ]),
    );
    const taxRate = decimalToScale4(taxRatePercent);

    return [...products]
      .sort((left, right) => left.variantId.localeCompare(right.variantId))
      .map((product) => {
        const quantity = quantityByVariant.get(product.variantId) ?? 0;
        if (quantity <= 0) throw this.priceChanged("A Checkout quantity changed.");
        const unitPrice = decimalToScale4(product.unitPrice);
        const subtotal = unitPrice * BigInt(quantity);
        const discount = discountByVariant.get(product.variantId) ?? 0n;
        if (discount < 0n || discount > subtotal) throw this.promotionChanged();
        const taxable = subtotal - discount;
        const tax = divideRoundHalfUp(taxable * taxRate, PERCENT_FACTOR);

        return {
          variantId: product.variantId,
          sellerId: product.sellerId,
          storeId: product.storeId,
          qty: quantity,
          unitPrice: scale4ToMoney(unitPrice),
          discount: scale4ToMoney(discount),
          tax: scale4ToMoney(tax),
          lineTotal: scale4ToMoney(taxable + tax),
        };
      });
  }

  /** Builds the exact fixed-order Patch 0004 JSON object and hashes it once with SHA-256. */
  private buildStateHash(input: {
    customerUserId: string;
    currency: string;
    couponCode: string | null;
    shippingAddress: CustomerAddressResponse;
    billingAddress: CustomerAddressResponse;
    taxRatePercent: string;
    lines: CreateCheckoutQuoteLineRecordInput[];
    shippingSelections: CreateCheckoutQuoteShippingSelectionRecordInput[];
    totals: {
      subtotal: string;
      discountTotal: string;
      taxTotal: string;
      shippingTotal: string;
      grandTotal: string;
    };
  }): string {
    const canonical = {
      version: CHECKOUT_STATE_VERSION,
      customerUserId: input.customerUserId.toLowerCase(),
      currency: input.currency,
      couponCode: input.couponCode,
      shippingAddress: this.canonicalAddress(input.shippingAddress),
      billingAddress: this.canonicalAddress(input.billingAddress),
      taxRatePercent: input.taxRatePercent,
      lines: [...input.lines]
        .sort((left, right) => left.variantId.localeCompare(right.variantId))
        .map((line) => ({
          variantId: line.variantId.toLowerCase(),
          sellerId: line.sellerId.toLowerCase(),
          storeId: line.storeId.toLowerCase(),
          quantity: line.qty,
          unitPrice: line.unitPrice,
          discount: line.discount,
          tax: line.tax,
          lineTotal: line.lineTotal,
        })),
      shippingSelections: [...input.shippingSelections]
        .sort((left, right) => left.storeId.localeCompare(right.storeId))
        .map((selection) => ({
          sellerId: selection.sellerId.toLowerCase(),
          storeId: selection.storeId.toLowerCase(),
          shippingMethodId: selection.shippingMethodId.toLowerCase(),
          amount: selection.amount,
          currency: selection.currency,
        })),
      totals: {
        subtotal: input.totals.subtotal,
        discountTotal: input.totals.discountTotal,
        taxTotal: input.totals.taxTotal,
        shippingTotal: input.totals.shippingTotal,
        grandTotal: input.totals.grandTotal,
      },
    };

    return sha256(JSON.stringify(canonical));
  }

  /** Normalizes the address fields that Patch 0004 places inside the deterministic state hash. */
  private canonicalAddress(address: CustomerAddressResponse) {
    return {
      id: address.id.toLowerCase(),
      recipientName: address.recipientName.trim(),
      phone: address.phone.trim(),
      line1: address.line1.trim(),
      line2: address.line2 === null ? null : address.line2.trim(),
      city: address.city.trim(),
      region: address.region.trim(),
      postalCode: address.postalCode === null ? null : address.postalCode.trim(),
      countryCode: address.countryCode.trim().toUpperCase(),
    };
  }

  /** Rejects any confirmation input whose current server state no longer matches the persisted quote snapshot. */
  private assertStoredQuoteStillMatches(
    quote: CheckoutQuoteRow,
    storedLines: Awaited<ReturnType<CheckoutRepository["listQuoteLinesForCustomer"]>>,
    storedSelections: Awaited<ReturnType<CheckoutRepository["listQuoteShippingSelectionsForCustomer"]>>,
    snapshot: AuthoritativeCheckoutSnapshot,
  ): void {
    if (
      new Date(snapshot.shippingAddress.updatedAt).getTime() > quote.createdAt.getTime() ||
      new Date(snapshot.billingAddress.updatedAt).getTime() > quote.createdAt.getTime()
    ) {
      throw this.addressInvalid();
    }

    const currentLines = new Map(snapshot.lines.map((line) => [line.variantId, line]));
    if (storedLines.length !== currentLines.size) throw this.priceChanged("Cart contents changed.");

    for (const stored of storedLines) {
      const current = currentLines.get(stored.variantId);
      if (!current || stored.storeId === null) throw this.priceChanged("Cart contents changed.");
      if (
        stored.sellerId !== current.sellerId ||
        stored.storeId !== current.storeId ||
        stored.qty !== current.qty ||
        stored.unitPrice !== current.unitPrice
      ) {
        throw this.priceChanged("Product price or ownership changed.");
      }
      if (stored.discount !== current.discount) throw this.promotionChanged();
      if (stored.tax !== current.tax || stored.lineTotal !== current.lineTotal) {
        throw this.priceChanged("Tax or line total changed.");
      }
    }

    const currentSelections = new Map(
      snapshot.shippingSelections.map((selection) => [selection.storeId, selection]),
    );
    if (storedSelections.length !== currentSelections.size) throw this.priceChanged("Shipping changed.");
    for (const stored of storedSelections) {
      const current = currentSelections.get(stored.storeId);
      if (
        !current ||
        stored.sellerId !== current.sellerId ||
        stored.shippingMethodId !== current.shippingMethodId ||
        stored.amount !== current.amount ||
        stored.currency !== current.currency
      ) {
        throw this.priceChanged("Shipping changed.");
      }
    }

    if (quote.discountTotal !== snapshot.discountTotal) throw this.promotionChanged();
    if (
      quote.currency !== snapshot.currency ||
      quote.subtotal !== snapshot.subtotal ||
      quote.taxTotal !== snapshot.taxTotal ||
      quote.shippingTotal !== snapshot.shippingTotal ||
      quote.grandTotal !== snapshot.grandTotal
    ) {
      throw this.priceChanged("Checkout totals changed.");
    }
    if (quote.stateHash !== snapshot.stateHash) throw this.priceChanged("Checkout state changed.");
  }

  /** Validates service-level confirmation inputs so non-HTTP callers cannot bypass the frozen contract. */
  private assertConfirmationInputIsValid(
    idempotencyKey: string,
    stateHash: string,
  ): void {
    if (
      idempotencyKey.length < 1 ||
      idempotencyKey.length > CHECKOUT_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH
    ) {
      throw checkoutError(
        ERROR_CODE.VALIDATION_FAILED,
        "Idempotency-Key must contain between 1 and 200 trimmed characters.",
        422,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(stateHash)) {
      throw checkoutError(
        ERROR_CODE.VALIDATION_FAILED,
        "stateHash must be a lowercase SHA-256 hexadecimal value.",
        422,
      );
    }
  }

  /** Builds the exact fixed-order Patch 0004 request hash for one confirmation idempotency key. */
  private buildConfirmationRequestHash(quoteId: string, stateHash: string): string {
    return sha256(
      JSON.stringify({
        version: CHECKOUT_CONFIRM_REQUEST_VERSION,
        quoteId: quoteId.toLowerCase(),
        stateHash,
      }),
    );
  }

  /** Parses one previously stored idempotency replay and fails closed if Foundation state is malformed. */
  private parseIdempotencyReplay(responseBody: unknown): CheckoutAttemptContract {
    const parsed = checkoutAttemptContractSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw checkoutError(
        ERROR_CODE.INTERNAL_ERROR,
        "Stored Checkout idempotency response is invalid.",
        500,
      );
    }
    return parsed.data;
  }

  /** Audits one conflicting confirmation key without storing the sensitive raw Idempotency-Key value. */
  private async recordIdempotencyConflict(
    context: RequestContext,
    quoteId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await AuditService.using(db).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: "checkout.idempotency_conflict",
      entityType: "checkout.quote",
      entityId: quoteId,
      requestId: context.requestId,
      metadata: { idempotencyKeyHash: sha256(idempotencyKey) },
    });
  }

  /** Maps Foundation's payload-conflict code to the Checkout-specific idempotency error required by Patch 0004. */
  private mapIdempotencyError(error: unknown): unknown {
    if (isAppError(error) && error.code === ERROR_CODE.IDEMPOTENCY_CONFLICT) {
      return checkoutError(
        CHECKOUT_ERROR_CODE.IDEMPOTENCY_CONFLICT,
        "The idempotency key was already used with a different Checkout confirmation.",
        409,
      );
    }
    return error;
  }

  /** Marks one acquired idempotency record failed without hiding the original Checkout failure. */
  private async markIdempotencyFailedWithoutMasking(recordId: string): Promise<void> {
    try {
      await this.idempotency.fail(recordId);
    } catch {
      // The original business/database error remains the useful failure for this request.
    }
  }

  /** Normalizes optional Checkout inputs once so direct service callers receive the same behavior as HTTP/Zod callers. */
  private normalizeCreateQuoteInput(input: CreateCheckoutQuoteInput) {
    if (
      input.buyNowItem &&
      (!Number.isInteger(input.buyNowItem.quantity) ||
        input.buyNowItem.quantity < 1 ||
        input.buyNowItem.quantity > CHECKOUT_LIMITS.MAX_ITEM_QUANTITY)
    ) {
      throw checkoutError(
        ERROR_CODE.VALIDATION_FAILED,
        `Buy Now quantity must be an integer between 1 and ${CHECKOUT_LIMITS.MAX_ITEM_QUANTITY}.`,
        422,
      );
    }

    return {
      shippingAddressId: input.shippingAddressId,
      billingAddressId: input.billingAddressId ?? input.shippingAddressId,
      couponCode: normalizeCouponCode(input.couponCode),
      shippingSelections: input.shippingSelections.map((selection) => ({
        storeId: selection.storeId,
        shippingMethodId: selection.shippingMethodId,
      })),
      buyNowItem: input.buyNowItem
        ? { variantId: input.buyNowItem.variantId, quantity: input.buyNowItem.quantity }
        : null,
    };
  }

  /** Reconstructs the direct Buy Now intent from the immutable persisted quote line during confirmation. */
  private buyNowIntentFromStoredLines(
    storedLines: Awaited<ReturnType<CheckoutRepository["listQuoteLinesForCustomer"]>>,
  ): CheckoutBuyNowIntent {
    const line = storedLines[0];
    if (!line || storedLines.length !== 1) {
      throw this.priceChanged("The Buy Now quote items changed.");
    }
    return { variantId: line.variantId, quantity: line.qty };
  }

  /** Enforces customer actor identity and one Checkout permission before private service work. */
  private requireCustomerActor(context: RequestContext, permission: string): string {
    assertPermission(context, permission);
    if (context.actorType !== ACTOR_TYPE.CUSTOMER || !context.actorId) {
      throw checkoutError(ERROR_CODE.FORBIDDEN, "Checkout is available only to customers.", 403);
    }
    return context.actorId;
  }

  /** Converts one persisted quote aggregate into the stable customer-safe Checkout response. */
  private toQuoteResponse(
    quote: CheckoutQuoteRow,
    lines: Awaited<ReturnType<CheckoutRepository["listQuoteLinesForCustomer"]>>,
    shippingSelections: Awaited<ReturnType<CheckoutRepository["listQuoteShippingSelectionsForCustomer"]>>,
  ): CheckoutQuoteWithLinesContract {
    if (!quote.shippingAddressId || !quote.billingAddressId) throw this.quoteNotFound();

    return {
      id: quote.id,
      currency: quote.currency,
      shippingAddressId: quote.shippingAddressId,
      billingAddressId: quote.billingAddressId,
      couponCode: quote.couponCode,
      subtotal: quote.subtotal,
      discountTotal: quote.discountTotal,
      taxTotal: quote.taxTotal,
      shippingTotal: quote.shippingTotal,
      grandTotal: quote.grandTotal,
      expiresAt: quote.expiresAt.toISOString(),
      stateHash: quote.stateHash,
      lines: lines.map((line) => {
        if (!line.storeId) throw this.quoteNotFound();
        return {
          variantId: line.variantId,
          sellerId: line.sellerId,
          storeId: line.storeId,
          quantity: line.qty,
          unitPrice: line.unitPrice,
          discount: line.discount,
          tax: line.tax,
          lineTotal: line.lineTotal,
        };
      }),
      shippingSelections: shippingSelections.map((selection) => ({
        sellerId: selection.sellerId,
        storeId: selection.storeId,
        shippingMethodId: selection.shippingMethodId,
        shippingMethodCode: selection.shippingMethodCodeSnapshot,
        shippingMethodName: selection.shippingMethodNameSnapshot,
        amount: selection.amount,
        currency: selection.currency,
      })),
    };
  }

  /** Converts one persisted Checkout attempt into the customer-safe status contract. */
  private toAttemptResponse(
    attempt: CheckoutAttemptRow,
  ): CheckoutAttemptContract {
    return {
      id: attempt.id,
      quoteId: attempt.quoteId,
      orderId: attempt.orderId,
      status: attempt.status,
      expiresAt: attempt.expiresAt.toISOString(),
    };
  }

  /** Creates the non-enumerating generic not-found error for a private Checkout quote. */
  private quoteNotFound(): AppError {
    return checkoutError(ERROR_CODE.RESOURCE_NOT_FOUND, "Checkout quote was not found.", 404);
  }

  /** Creates the non-enumerating generic not-found error for a private Checkout attempt. */
  private attemptNotFound(): AppError {
    return checkoutError(ERROR_CODE.RESOURCE_NOT_FOUND, "Checkout attempt was not found.", 404);
  }

  /** Creates the approved expired-quote business error. */
  private quoteExpired(): AppError {
    return checkoutError(
      CHECKOUT_ERROR_CODE.QUOTE_EXPIRED,
      "The Checkout quote expired. Create a new quote.",
      409,
    );
  }

  /** Creates the approved stale non-Promotion monetary/input error. */
  private priceChanged(message: string): AppError {
    return checkoutError(CHECKOUT_ERROR_CODE.PRICE_CHANGED, message, 409);
  }

  /** Creates the approved exact-quantity stock-change error. */
  private stockChanged(): AppError {
    return checkoutError(
      CHECKOUT_ERROR_CODE.STOCK_CHANGED,
      "Available stock changed. Review the cart and try again.",
      409,
    );
  }

  /** Creates the approved Promotion/coupon change error. */
  private promotionChanged(): AppError {
    return checkoutError(
      CHECKOUT_ERROR_CODE.PROMOTION_CHANGED,
      "Promotion eligibility or discount allocation changed.",
      409,
    );
  }

  /** Creates the approved customer-address validation error. */
  private addressInvalid(): AppError {
    return checkoutError(
      CHECKOUT_ERROR_CODE.ADDRESS_INVALID,
      "The selected Checkout address is no longer valid.",
      409,
    );
  }
}

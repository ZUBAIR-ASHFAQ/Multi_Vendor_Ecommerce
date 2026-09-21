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
import type { PaginationMeta } from "../../common/schemas/pagination.schema.js";
import { ACTOR_TYPE, type PermissionCode } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { paginationMeta } from "../../common/utils/pagination.js";
import type { ShippingMethodRow, ShipmentRow } from "../../database/schema/shipping.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AdministrationService } from "../administration/administration.service.js";
import type { CartResponse } from "../cart-wishlist/cart-wishlist.schema.js";
import { CartWishlistService } from "../cart-wishlist/cart-wishlist.service.js";
import { CustomersService } from "../customers/customers.service.js";
import type { ShippingReservationSnapshot } from "../inventory/inventory.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  ORDER_PAYMENT_STATUS,
  SELLER_ORDER_STATUS,
} from "../orders/orders.constants.js";
import type {
  OrderShippingFulfillmentSnapshot,
} from "../orders/orders.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { ProductsService, type CheckoutProductVariant } from "../products/products.service.js";
import {
  SHIPMENT_STATUS,
  SHIPPING_AUDIT_ACTION,
  SHIPPING_ERROR_CODE,
  SHIPPING_IDEMPOTENCY_SCOPE,
  SHIPPING_LIMITS,
  SHIPPING_OUTBOX_EVENT,
  SHIPPING_OWNER_TYPE,
  SHIPPING_PERMISSION,
  SHIPPING_RESOURCE_TYPE,
} from "./shipping.constants.js";
import {
  ShippingRepository,
  type ShippingSellerScope,
} from "./shipping.repository.js";
import {
  sellerShipmentResponseSchema,
  type CheckoutShippingGroup,
  type CreateShipmentInput,
  type CustomerShipmentTrackingResponse,
  type SellerShipmentListQuery,
  type SellerShipmentResponse,
  type ShippingOptionsQuery,
  type ShippingOptionsResponse,
  type UpdateShipmentTrackingInput,
} from "./shipping.schema.js";

/** Customer boundary needed by Shipping Core to validate one owned active address. */
export interface ShippingCustomerIntegration {
  /** Verifies that the authenticated actor has an active customer profile and owns one active address. */
  assertActiveOwnedAddress(context: RequestContext, addressId: string): Promise<void>;
}

/** Cart boundary used to derive the current customer Cart without trusting client Cart identifiers. */
export interface ShippingCartIntegration {
  /** Returns the authenticated customer's current server-backed Cart preview. */
  getCheckoutCart(context: RequestContext): Promise<CartResponse>;
}

/** Product boundary used to resolve server-owned seller/store grouping for current Cart Products. */
export interface ShippingProductIntegration {
  /** Resolves one currently public Product to the seller/store scope needed for Cart shipment grouping. */
  resolvePublicProductSellerStoreScope(
    productId: string,
  ): Promise<{ productId: string; sellerId: string; storeId: string } | null>;

  /** Resolves one currently sellable variant for direct Buy Now shipment grouping. */
  resolveVariantForCheckout(variantId: string): Promise<CheckoutProductVariant | null>;
}

/** Administration boundary used to reject currencies that are no longer supported. */
export interface ShippingCurrencyIntegration {
  /** Returns whether one normalized currency is currently supported by Administration. */
  isSupportedCurrency(currency: string): Promise<boolean>;
}

/** Narrow Orders boundary used by Shipping without importing Orders persistence. */
export interface ShippingOrdersIntegration {
  /** Returns seller-scoped Order, Item, Payment, and Inventory-reservation facts required by fulfillment. */
  getShippingFulfillmentSnapshot(
    sellerOrderId: string,
    scope: ShippingSellerScope,
  ): Promise<OrderShippingFulfillmentSnapshot | null>;

  /** Updates the parent Order fulfillment state from the total physically issued quantity. */
  applyShippingFulfillmentStatus(orderId: string, issuedQuantity: number): Promise<string>;

  /** Returns whether one Customer Order belongs to the supplied customer. */
  customerOwnsOrder(orderId: string, customerUserId: string): Promise<boolean>;

  /** Returns whether one Customer Order exists for an already-authorized platform read. */
  orderExists(orderId: string): Promise<boolean>;
}


/** Trusted delivered quantity exposed only to Module 15 Review eligibility. */
export interface ReviewDeliveryItemSnapshot {
  orderItemId: string;
  deliveredQuantity: number;
  latestDeliveredAt: string;
}

/** Trusted delivered-quantity facts exposed only to Module 14 Return eligibility. */
export interface ReturnDeliveryItemSnapshot {
  orderItemId: string;
  deliveredQuantity: number;
  latestDeliveredAt: string;
}


/** Trusted Shipping evidence used by Module 17 to decide whether one Commission earning may become available. */
export interface WalletDeliverySnapshot {
  orderId: string;
  sellerId: string;
  sellerOrderId: string;
  orderItemId: string;
  commercialQuantity: number;
  deliveredQuantity: number;
  fullyDelivered: boolean;
  latestDeliveredAt: string | null;
}

/** Narrow Inventory boundary used by Shipment creation and stock issue. */
export interface ShippingInventoryIntegration {
  /** Returns committed-reservation facts required before creating a Shipment allocation. */
  getShippingReservationSnapshot(reservationId: string): Promise<ShippingReservationSnapshot>;

  /** Consumes committed stock exactly once using a deterministic Shipment Item source key. */
  shipStock(
    context: RequestContext,
    input: { reservationId: string; quantity: number; sourceId: string; sourceKey: string },
  ): Promise<unknown>;
}

/** Foundation idempotency boundary for create/ship/deliver commands. */
export interface ShippingIdempotencyIntegration {
  /** Acquires or replays one retry-safe operation. */
  begin(
    request: { scope: string; key: string; requestHash: string },
    now?: Date,
  ): Promise<BeginIdempotentOperationResult>;

  /** Stores one successful seller-safe response for exact replay. */
  complete(recordId: string, statusCode: number, responseBody: unknown): Promise<void>;

  /** Marks a failed operation retryable again. */
  fail(recordId: string): Promise<void>;
}

/** Transaction-aware audit boundary used by Shipment writes. */
export interface ShippingAuditIntegration {
  /** Appends one immutable redacted business/security audit event. */
  record(input: AppendAuditEventInput): Promise<string>;
}

/** Transaction-aware outbox boundary used by durable Shipment events. */
export interface ShippingOutboxIntegration {
  /** Appends one durable event inside the same transaction as the Shipment state change. */
  enqueue<TPayload>(event: EnqueueOutboxEventInput<TPayload>): Promise<string>;
}

/** Runs one Shipping transaction and allows focused service tests to replace PostgreSQL. */
export type ShippingTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Explicit dependencies keep Shipping orchestration readable and easy to unit test. */
export interface ShippingServiceDependencies {
  repository?: ShippingRepository;
  repositoryUsingTransaction?: (transaction: DatabaseTransaction) => ShippingRepository;
  transactionRunner?: ShippingTransactionRunner;
  customers?: ShippingCustomerIntegration;
  cart?: ShippingCartIntegration;
  products?: ShippingProductIntegration;
  currencies?: ShippingCurrencyIntegration;
  orders?: ShippingOrdersIntegration;
  ordersUsingTransaction?: (transaction: DatabaseTransaction) => ShippingOrdersIntegration;
  inventoryUsingTransaction?: (transaction: DatabaseTransaction) => ShippingInventoryIntegration;
  auditUsingTransaction?: (transaction: DatabaseTransaction) => ShippingAuditIntegration;
  outboxUsingTransaction?: (transaction: DatabaseTransaction) => ShippingOutboxIntegration;
  idempotency?: ShippingIdempotencyIntegration;
  idempotencyUsingTransaction?: (
    transaction: DatabaseTransaction,
  ) => ShippingIdempotencyIntegration;
  now?: () => Date;
  createId?: () => string;
}

/** Minimal server-derived shipment group before eligible methods are attached. */
interface DerivedShipmentGroup {
  sellerId: string;
  storeId: string;
}

/** Seller Shipment list plus standard pagination metadata. */
export interface PaginatedSellerShipmentsResult {
  items: SellerShipmentResponse[];
  meta: PaginationMeta;
}

/** Stable lifecycle-history source values owned by Module 13. */
const SHIPMENT_HISTORY_SOURCE = {
  CREATED: "seller_create",
  SHIPPED: "seller_mark_shipped",
  DELIVERED: "seller_mark_delivered",
} as const;

/** Creates one safe generic conflict for a stale Cart that Checkout cannot use. */
function staleCartError(): AppError {
  return new AppError({
    code: ERROR_CODE.CONFLICT,
    message: "The cart changed and must be reviewed before checkout.",
    statusCode: 409,
  });
}

/** Creates one safe configuration error when Cart currency is no longer supported. */
function unsupportedCurrencyError(): AppError {
  return new AppError({
    code: ERROR_CODE.CONFLICT,
    message: "The cart currency is not currently supported.",
    statusCode: 409,
  });
}

/** Creates a SHA-256 digest for the canonical request payload used by idempotency checks. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Formats the immutable human-readable Shipment number from its UUID. */
function shipmentNumber(id: string): string {
  return `SHP-${id.replaceAll("-", "").toUpperCase()}`;
}

/** Module 13 business service for Shipping Configuration Core and seller/customer fulfillment workflows. */
export class ShippingService {
  private readonly repository: ShippingRepository;
  private readonly repositoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingRepository;
  private readonly transactionRunner: ShippingTransactionRunner;
  private readonly customers: ShippingCustomerIntegration;
  private readonly cart: ShippingCartIntegration;
  private readonly products: ShippingProductIntegration;
  private readonly currencies: ShippingCurrencyIntegration;
  private readonly orders: ShippingOrdersIntegration;
  private readonly ordersUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingOrdersIntegration;
  private readonly inventoryUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingInventoryIntegration;
  private readonly auditUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingAuditIntegration;
  private readonly outboxUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingOutboxIntegration;
  private readonly idempotency: ShippingIdempotencyIntegration;
  private readonly idempotencyUsingTransaction: (
    transaction: DatabaseTransaction,
  ) => ShippingIdempotencyIntegration;
  private readonly now: () => Date;
  private readonly createId: () => string;

  /** Stores explicit dependencies and uses current released modules as production defaults. */
  constructor(dependencies: ShippingServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new ShippingRepository();
    this.repositoryUsingTransaction =
      dependencies.repositoryUsingTransaction ?? ((transaction) => new ShippingRepository(transaction));
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.customers = dependencies.customers ?? new CustomersService();
    this.cart = dependencies.cart ?? new CartWishlistService();
    this.products = dependencies.products ?? new ProductsService();
    this.currencies = dependencies.currencies ?? new AdministrationService();
    this.orders = dependencies.orders ?? new OrdersService();
    this.ordersUsingTransaction =
      dependencies.ordersUsingTransaction ?? ((transaction) => OrdersService.using(transaction));
    this.inventoryUsingTransaction =
      dependencies.inventoryUsingTransaction ?? ((transaction) => InventoryService.using(transaction));
    this.auditUsingTransaction =
      dependencies.auditUsingTransaction ?? ((transaction) => AuditService.using(transaction));
    this.outboxUsingTransaction =
      dependencies.outboxUsingTransaction ?? ((transaction) => OutboxService.using(transaction));
    this.idempotency = dependencies.idempotency ?? new IdempotencyService();
    this.idempotencyUsingTransaction =
      dependencies.idempotencyUsingTransaction ??
      ((transaction) => IdempotencyService.using(transaction));
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  /** Creates a Shipping service that participates in an existing cross-module transaction. */
  static using(transaction: DatabaseTransaction): ShippingService {
    return new ShippingService({
      repository: new ShippingRepository(transaction),
      repositoryUsingTransaction: () => new ShippingRepository(transaction),
      transactionRunner: async (work) => work(transaction),
      orders: OrdersService.using(transaction),
      ordersUsingTransaction: () => OrdersService.using(transaction),
      inventoryUsingTransaction: () => InventoryService.using(transaction),
      auditUsingTransaction: () => AuditService.using(transaction),
      outboxUsingTransaction: () => OutboxService.using(transaction),
      idempotency: IdempotencyService.using(transaction),
      idempotencyUsingTransaction: () => IdempotencyService.using(transaction),
    });
  }

  /** Returns active flat-rate methods for each current Cart store group after customer/address validation. */
  async getCheckoutShippingOptions(
    context: RequestContext,
    query: ShippingOptionsQuery,
  ): Promise<ShippingOptionsResponse> {
    await this.customers.assertActiveOwnedAddress(context, query.addressId);

    if (query.variantId && query.quantity) {
      const product = await this.products.resolveVariantForCheckout(query.variantId);
      if (!product) {
        throw new AppError({
          code: ERROR_CODE.CONFLICT,
          message: "The selected Buy Now item changed and must be reviewed before checkout.",
          statusCode: 409,
        });
      }
      const currency = product.currency.trim().toUpperCase();
      if (!(await this.currencies.isSupportedCurrency(currency))) {
        throw unsupportedCurrencyError();
      }
      const group = { sellerId: product.sellerId, storeId: product.storeId };
      const methods = await this.repository.listCheckoutEligibleMethods(currency, [product.sellerId]);
      return {
        addressId: query.addressId,
        currency,
        groups: [this.buildGroupResponse(group, methods)],
      };
    }

    const cart = await this.cart.getCheckoutCart(context);
    if (cart.hasUnavailableItems) throw staleCartError();
    if (!(await this.currencies.isSupportedCurrency(cart.currency))) {
      throw unsupportedCurrencyError();
    }

    const groups = await this.deriveShipmentGroups(cart);
    const sellerIds = Array.from(new Set(groups.map((group) => group.sellerId))).sort();
    const methods = await this.repository.listCheckoutEligibleMethods(cart.currency, sellerIds);

    return {
      addressId: query.addressId,
      currency: cart.currency,
      groups: groups.map((group) => this.buildGroupResponse(group, methods)),
    };
  }

  /** Lists seller-visible Shipments only inside the actor's effective seller/store read scope. */
  async listSellerShipments(
    context: RequestContext,
    query: SellerShipmentListQuery,
  ): Promise<PaginatedSellerShipmentsResult> {
    const scope = this.resolveSellerScope(context, SHIPPING_PERMISSION.SELLER_READ);
    const result = await this.repository.listSellerShipments(scope, query);
    const shipmentIds = result.items.map((shipment) => shipment.id);
    const [items, history] = await Promise.all([
      this.repository.listSellerShipmentItems(shipmentIds, scope),
      this.repository.listSellerShipmentHistory(shipmentIds, scope),
    ]);

    return {
      items: result.items.map((shipment) => this.toSellerShipmentResponse(shipment, items, history)),
      meta: paginationMeta(query, result.totalItems),
    };
  }

  /** Creates one immutable Shipment allocation after server-side Order and Inventory revalidation. */
  async createShipment(
    context: RequestContext,
    sellerOrderId: string,
    input: CreateShipmentInput,
    idempotencyKey: string,
  ): Promise<SellerShipmentResponse> {
    const actorId = this.requireActor(context);
    const scope = this.resolveSellerScope(
      context,
      SHIPPING_PERMISSION.SELLER_MANAGE,
    );
    const normalizedInput = this.normalizeCreateInput(input);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const requestHash = sha256(
      JSON.stringify({
        sellerOrderId: sellerOrderId.toLowerCase(),
        items: normalizedInput.items,
      }),
    );
    const result = await this.idempotency.begin(
      {
        scope: `${SHIPPING_IDEMPOTENCY_SCOPE.CREATE}:${actorId}`,
        key: normalizedKey,
        requestHash,
      },
      this.now(),
    );

    if (result.mode === "replay") {
      return this.parseShipmentReplay(result.replay.responseBody);
    }

    try {
      return await this.transactionRunner(async (transaction) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const snapshot = await this.ordersUsingTransaction(
          transaction,
        ).getShippingFulfillmentSnapshot(sellerOrderId, scope);
        if (!snapshot) throw this.shipmentNotFound();
        this.assertSellerOrderEligible(snapshot);

        await this.assertShipmentAllocationAvailable(
          repository,
          this.inventoryUsingTransaction(transaction),
          sellerOrderId,
          scope,
          snapshot,
          normalizedInput,
        );

        return this.persistCreatedShipment(
          transaction,
          repository,
          context,
          sellerOrderId,
          scope,
          snapshot,
          normalizedInput,
          result.recordId,
        );
      });
    } catch (error) {
      await this.failIdempotencySafely(result.recordId);
      throw error;
    }
  }

  /** Verifies requested quantities still fit the Seller Order and committed Inventory reservations. */
  private async assertShipmentAllocationAvailable(
    repository: ShippingRepository,
    inventory: ShippingInventoryIntegration,
    sellerOrderId: string,
    scope: ShippingSellerScope,
    snapshot: OrderShippingFulfillmentSnapshot,
    input: CreateShipmentInput,
  ): Promise<void> {
    const requestedIds = input.items.map((item) => item.orderItemId);
    await repository.lockShipmentAllocations(requestedIds);
    const allocatedRows = await repository.sumAllocatedQuantitiesInScope(
      sellerOrderId,
      requestedIds,
      scope,
    );
    const allocatedByItem = new Map(
      allocatedRows.map((row) => [row.orderItemId, row.allocatedQuantity]),
    );
    const orderItemById = new Map(
      snapshot.items.map((item) => [item.orderItemId, item]),
    );

    for (const requested of input.items) {
      const item = orderItemById.get(requested.orderItemId);
      if (!item) {
        throw this.quantityInvalid(
          "Shipment item does not belong to this Seller Order.",
        );
      }

      const commercialRemaining = item.quantity - item.cancelledQuantity;
      const alreadyAllocated = allocatedByItem.get(item.orderItemId) ?? 0;
      const fulfillableQuantity = commercialRemaining - alreadyAllocated;
      if (fulfillableQuantity < 0 || requested.quantity > fulfillableQuantity) {
        throw this.quantityInvalid(
          "Shipment quantity exceeds the remaining fulfillable quantity.",
        );
      }

      const reservation = await this.getReservationForShipment(
        inventory,
        item.inventoryReservationId,
      );
      if (
        reservation.variantId !== item.variantId ||
        reservation.remainingQuantity < requested.quantity
      ) {
        throw this.quantityInvalid(
          "Committed Inventory reservation cannot cover this Shipment quantity.",
        );
      }
    }
  }

  /** Persists one created Shipment, its items/history, audit event, outbox event, and replay result. */
  private async persistCreatedShipment(
    transaction: DatabaseTransaction,
    repository: ShippingRepository,
    context: RequestContext,
    sellerOrderId: string,
    scope: ShippingSellerScope,
    snapshot: OrderShippingFulfillmentSnapshot,
    input: CreateShipmentInput,
    idempotencyRecordId: string,
  ): Promise<SellerShipmentResponse> {
    const shipmentId = this.createId();
    const createdAt = this.now();
    const shipment = await repository.createShipmentInScope(
      {
        id: shipmentId,
        sellerOrderId,
        shipmentNo: shipmentNumber(shipmentId),
        status: SHIPMENT_STATUS.CREATED,
      },
      scope,
    );
    if (!shipment) throw this.shipmentNotFound();

    const createdItems = await repository.createShipmentItemsInScope(
      shipment.id,
      input.items,
      scope,
    );
    if (createdItems.length !== input.items.length) {
      throw new AppError({
        code: ERROR_CODE.INTERNAL_ERROR,
        message: "Shipment item persistence is inconsistent.",
        statusCode: 500,
      });
    }

    const history = await repository.appendStatusHistoryInScope(
      shipment.id,
      {
        status: SHIPMENT_STATUS.CREATED,
        source: SHIPMENT_HISTORY_SOURCE.CREATED,
        occurredAt: createdAt,
      },
      scope,
    );
    if (!history) throw this.shipmentNotFound();

    await this.recordShipmentCreated(
      transaction,
      context,
      shipment,
      sellerOrderId,
      snapshot,
      input,
    );

    const response = this.toSellerShipmentResponse(
      shipment,
      createdItems,
      [history],
    );
    await this.idempotencyUsingTransaction(transaction).complete(
      idempotencyRecordId,
      201,
      response,
    );
    return response;
  }

  /** Records immutable audit and outbox evidence for one newly created Shipment. */
  private async recordShipmentCreated(
    transaction: DatabaseTransaction,
    context: RequestContext,
    shipment: ShipmentRow,
    sellerOrderId: string,
    snapshot: OrderShippingFulfillmentSnapshot,
    input: CreateShipmentInput,
  ): Promise<void> {
    await this.auditUsingTransaction(transaction).record({
      actorId: context.actorId,
      actorType: context.actorType,
      action: SHIPPING_AUDIT_ACTION.CREATED,
      entityType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
      entityId: shipment.id,
      sellerId: snapshot.sellerId,
      requestId: context.requestId,
      after: {
        shipmentId: shipment.id,
        sellerOrderId,
        status: shipment.status,
        items: input.items,
      },
    });
    await this.outboxUsingTransaction(transaction).enqueue({
      eventType: SHIPPING_OUTBOX_EVENT.CREATED,
      aggregateType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
      aggregateId: shipment.id,
      payload: {
        shipmentId: shipment.id,
        sellerOrderId,
        orderId: snapshot.orderId,
        sellerId: snapshot.sellerId,
        status: shipment.status,
      },
    });
  }

  /** Sets or corrects tracking while enforcing the created/shipped/delivered tracking policy. */
  async updateShipmentTracking(
    context: RequestContext,
    shipmentId: string,
    input: UpdateShipmentTrackingInput,
  ): Promise<SellerShipmentResponse> {
    const scope = this.resolveSellerScope(context, SHIPPING_PERMISSION.SELLER_MANAGE);

    return this.transactionRunner(async (transaction) => {
      const repository = this.repositoryUsingTransaction(transaction);
      const orders = this.ordersUsingTransaction(transaction);
      const audit = this.auditUsingTransaction(transaction);
      const outbox = this.outboxUsingTransaction(transaction);
      const shipment = await repository.findShipmentForUpdateInScope(shipmentId, scope);
      if (!shipment) throw this.shipmentNotFound();

      const next = {
        carrier: input.carrier.trim(),
        trackingNo: input.trackingNo.trim(),
        serviceLevel:
          input.serviceLevel === undefined ? shipment.serviceLevel : input.serviceLevel?.trim() ?? null,
      };
      const unchanged =
        shipment.carrier === next.carrier &&
        shipment.trackingNo === next.trackingNo &&
        shipment.serviceLevel === next.serviceLevel;
      if (unchanged) return this.buildSellerShipmentResponse(repository, shipment, scope);
      if (shipment.status === SHIPMENT_STATUS.DELIVERED) {
        throw this.trackingInvalid("Tracking cannot be changed after delivery.");
      }

      const snapshot = await orders.getShippingFulfillmentSnapshot(shipment.sellerOrderId, scope);
      if (!snapshot) throw this.shipmentNotFound();

      const updated = await repository.updateTrackingInScope(shipment.id, next, scope);
      if (!updated) throw this.shipmentNotFound();

      await audit.record({
        actorId: context.actorId,
        actorType: context.actorType,
        action: SHIPPING_AUDIT_ACTION.TRACKING_UPDATED,
        entityType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
        entityId: shipment.id,
        sellerId: snapshot.sellerId,
        requestId: context.requestId,
        before: {
          carrier: shipment.carrier,
          trackingNo: shipment.trackingNo,
          serviceLevel: shipment.serviceLevel,
        },
        after: next,
      });
      await outbox.enqueue({
        eventType: SHIPPING_OUTBOX_EVENT.TRACKING_UPDATED,
        aggregateType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
        aggregateId: shipment.id,
        payload: {
          shipmentId: shipment.id,
          sellerOrderId: shipment.sellerOrderId,
          orderId: snapshot.orderId,
          status: shipment.status,
        },
      });

      return this.buildSellerShipmentResponse(repository, updated, scope);
    });
  }

  /** Issues committed Inventory exactly once and moves one Shipment from created to shipped. */
  async markShipmentShipped(
    context: RequestContext,
    shipmentId: string,
    idempotencyKey: string,
  ): Promise<SellerShipmentResponse> {
    return this.runLifecycleIdempotently(
      context,
      shipmentId,
      idempotencyKey,
      SHIPPING_IDEMPOTENCY_SCOPE.MARK_SHIPPED,
      200,
      async (transaction, scope) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const orders = this.ordersUsingTransaction(transaction);
        const inventory = this.inventoryUsingTransaction(transaction);
        const audit = this.auditUsingTransaction(transaction);
        const outbox = this.outboxUsingTransaction(transaction);
        const shipment = await repository.findShipmentForUpdateInScope(shipmentId, scope);
        if (!shipment) throw this.shipmentNotFound();
        if (shipment.status !== SHIPMENT_STATUS.CREATED) {
          throw this.statusInvalid("Only a created Shipment can be marked shipped.");
        }
        if (!shipment.carrier || !shipment.trackingNo) {
          throw this.trackingInvalid("Carrier and tracking number are required before shipping.");
        }

        const snapshot = await orders.getShippingFulfillmentSnapshot(shipment.sellerOrderId, scope);
        if (!snapshot) throw this.shipmentNotFound();
        this.assertSellerOrderEligible(snapshot);
        const shipmentItems = await repository.listSellerShipmentItems([shipment.id], scope);
        if (shipmentItems.length === 0) {
          throw this.quantityInvalid("Shipment has no immutable item allocation.");
        }
        const orderItemById = new Map(snapshot.items.map((item) => [item.orderItemId, item]));

        for (const shipmentItem of shipmentItems) {
          const orderItem = orderItemById.get(shipmentItem.orderItemId);
          if (!orderItem) throw this.quantityInvalid("Shipment item no longer matches its Seller Order.");
          const reservation = await this.getReservationForShipment(
            inventory,
            orderItem.inventoryReservationId,
          );
          if (
            reservation.variantId !== orderItem.variantId ||
            reservation.remainingQuantity < shipmentItem.quantity
          ) {
            throw this.inventoryIssueFailed("Committed Inventory reservation cannot cover the Shipment.");
          }
        }

        for (const shipmentItem of shipmentItems) {
          const orderItem = orderItemById.get(shipmentItem.orderItemId)!;
          try {
            await inventory.shipStock(context, {
              reservationId: orderItem.inventoryReservationId,
              quantity: shipmentItem.quantity,
              sourceId: shipment.id,
              sourceKey: `shipment:${shipment.id}:item:${shipmentItem.orderItemId}`,
            });
          } catch (error) {
            throw this.inventoryIssueFailed("Inventory issue could not be applied.", error);
          }
        }

        const occurredAt = this.now();
        const updated = await repository.updateLifecycleInScope(
          shipment.id,
          {
            status: SHIPMENT_STATUS.SHIPPED,
            shippedAt: occurredAt,
            deliveredAt: null,
            updatedAt: occurredAt,
          },
          scope,
        );
        if (!updated) throw this.shipmentNotFound();
        const history = await repository.appendStatusHistoryInScope(
          shipment.id,
          {
            status: SHIPMENT_STATUS.SHIPPED,
            source: SHIPMENT_HISTORY_SOURCE.SHIPPED,
            occurredAt,
          },
          scope,
        );
        if (!history) throw this.shipmentNotFound();

        await repository.lockOrderFulfillmentCalculation(snapshot.orderId);
        const issuedQuantity = await repository.sumIssuedQuantityForOrder(snapshot.orderId);
        await orders.applyShippingFulfillmentStatus(snapshot.orderId, issuedQuantity);

        await audit.record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: SHIPPING_AUDIT_ACTION.SHIPPED,
          entityType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
          entityId: shipment.id,
          sellerId: snapshot.sellerId,
          requestId: context.requestId,
          before: { status: shipment.status, shippedAt: shipment.shippedAt },
          after: { status: updated.status, shippedAt: updated.shippedAt },
        });
        await outbox.enqueue({
          eventType: SHIPPING_OUTBOX_EVENT.SHIPPED,
          aggregateType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
          aggregateId: shipment.id,
          payload: {
            shipmentId: shipment.id,
            sellerOrderId: shipment.sellerOrderId,
            orderId: snapshot.orderId,
            status: updated.status,
            shippedAt: updated.shippedAt?.toISOString() ?? null,
          },
        });

        return this.buildSellerShipmentResponse(repository, updated, scope);
      },
    );
  }

  /** Moves one shipped Shipment to delivered without changing Payment state. */
  async markShipmentDelivered(
    context: RequestContext,
    shipmentId: string,
    idempotencyKey: string,
  ): Promise<SellerShipmentResponse> {
    return this.runLifecycleIdempotently(
      context,
      shipmentId,
      idempotencyKey,
      SHIPPING_IDEMPOTENCY_SCOPE.MARK_DELIVERED,
      200,
      async (transaction, scope) => {
        const repository = this.repositoryUsingTransaction(transaction);
        const orders = this.ordersUsingTransaction(transaction);
        const audit = this.auditUsingTransaction(transaction);
        const outbox = this.outboxUsingTransaction(transaction);
        const shipment = await repository.findShipmentForUpdateInScope(shipmentId, scope);
        if (!shipment) throw this.shipmentNotFound();
        if (shipment.status !== SHIPMENT_STATUS.SHIPPED) {
          throw this.statusInvalid("Only a shipped Shipment can be marked delivered.");
        }

        const snapshot = await orders.getShippingFulfillmentSnapshot(shipment.sellerOrderId, scope);
        if (!snapshot) throw this.shipmentNotFound();

        const occurredAt = this.now();
        const updated = await repository.updateLifecycleInScope(
          shipment.id,
          {
            status: SHIPMENT_STATUS.DELIVERED,
            shippedAt: shipment.shippedAt,
            deliveredAt: occurredAt,
            updatedAt: occurredAt,
          },
          scope,
        );
        if (!updated) throw this.shipmentNotFound();
        const history = await repository.appendStatusHistoryInScope(
          shipment.id,
          {
            status: SHIPMENT_STATUS.DELIVERED,
            source: SHIPMENT_HISTORY_SOURCE.DELIVERED,
            occurredAt,
          },
          scope,
        );
        if (!history) throw this.shipmentNotFound();

        await audit.record({
          actorId: context.actorId,
          actorType: context.actorType,
          action: SHIPPING_AUDIT_ACTION.DELIVERED,
          entityType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
          entityId: shipment.id,
          sellerId: snapshot.sellerId,
          requestId: context.requestId,
          before: { status: shipment.status, deliveredAt: shipment.deliveredAt },
          after: { status: updated.status, deliveredAt: updated.deliveredAt },
        });
        await outbox.enqueue({
          eventType: SHIPPING_OUTBOX_EVENT.DELIVERED,
          aggregateType: SHIPPING_RESOURCE_TYPE.SHIPMENT,
          aggregateId: shipment.id,
          payload: {
            shipmentId: shipment.id,
            sellerOrderId: shipment.sellerOrderId,
            orderId: snapshot.orderId,
            status: updated.status,
            deliveredAt: updated.deliveredAt?.toISOString() ?? null,
          },
        });

        return this.buildSellerShipmentResponse(repository, updated, scope);
      },
    );
  }


  /** Returns delivery completion evidence for one Order Item used by trusted Module 15 Review eligibility. */
  async getReviewDeliverySnapshot(
    context: RequestContext,
    orderId: string,
    orderItemId: string,
  ): Promise<ReviewDeliveryItemSnapshot | null> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw new AppError({
        code: ERROR_CODE.FORBIDDEN,
        message: "Internal Review Shipping access is required.",
        statusCode: 403,
      });
    }

    const rows = await this.repository.listDeliveredItemsForOrder(orderId);
    const row = rows.find((candidate) => candidate.orderItemId === orderItemId);
    if (!row) return null;

    return {
      orderItemId: row.orderItemId,
      deliveredQuantity: row.deliveredQuantity,
      latestDeliveredAt: row.latestDeliveredAt.toISOString(),
    };
  }

  /** Returns delivered Order Item quantities and the latest delivery timestamp for trusted Module 14 eligibility checks. */
  async getReturnDeliverySnapshot(
    context: RequestContext,
    orderId: string,
  ): Promise<ReturnDeliveryItemSnapshot[]> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw new AppError({
        code: ERROR_CODE.FORBIDDEN,
        message: "Internal Return Shipping access is required.",
        statusCode: 403,
      });
    }

    const rows = await this.repository.listDeliveredItemsForOrder(orderId);
    return rows.map((row) => ({
      orderItemId: row.orderItemId,
      deliveredQuantity: row.deliveredQuantity,
      latestDeliveredAt: row.latestDeliveredAt.toISOString(),
    }));
  }

  /** Returns trusted delivery completion evidence for one Wallet settlement source Order Item. */
  async getWalletDeliverySnapshot(
    context: RequestContext,
    input: {
      orderId: string;
      sellerId: string;
      sellerOrderId: string;
      orderItemId: string;
    },
  ): Promise<WalletDeliverySnapshot | null> {
    if (context.actorType !== ACTOR_TYPE.SYSTEM) {
      throw new AppError({
        code: ERROR_CODE.FORBIDDEN,
        message: "Internal Wallet Shipping access is required.",
        statusCode: 403,
      });
    }

    const row = await this.repository.findWalletDeliveryItem(input);
    if (!row) return null;

    return {
      orderId: row.orderId,
      sellerId: row.sellerId,
      sellerOrderId: row.sellerOrderId,
      orderItemId: row.orderItemId,
      commercialQuantity: row.commercialQuantity,
      deliveredQuantity: row.deliveredQuantity,
      fullyDelivered:
        row.commercialQuantity > 0 &&
        row.deliveredQuantity >= row.commercialQuantity &&
        row.latestDeliveredAt !== null,
      latestDeliveredAt: row.latestDeliveredAt?.toISOString() ?? null,
    };
  }

  /** Returns customer/admin-safe tracking only after an Orders service boundary authorizes the parent Order. */
  async getOrderShipments(
    context: RequestContext,
    orderId: string,
  ): Promise<CustomerShipmentTrackingResponse[]> {
    const actorId = this.requireActor(context);
    let authorized = false;

    if (context.permissions.has(SHIPPING_PERMISSION.ADMIN_READ)) {
      authorized = await this.orders.orderExists(orderId);
    } else if (context.permissions.has(SHIPPING_PERMISSION.READ_OWN_ORDER)) {
      authorized = await this.orders.customerOwnsOrder(orderId, actorId);
    }

    if (!authorized) {
      throw new AppError({
        code: ERROR_CODE.RESOURCE_NOT_FOUND,
        message: "Order tracking was not found.",
        statusCode: 404,
      });
    }

    const shipments = await this.repository.listCustomerVisibleShipmentsForOrder(orderId);
    const shipmentIds = shipments.map((shipment) => shipment.id);
    const [items, history] = await Promise.all([
      this.repository.listCustomerVisibleShipmentItemsForOrder(orderId, shipmentIds),
      this.repository.listCustomerVisibleShipmentHistoryForOrder(orderId, shipmentIds),
    ]);

    return shipments.map((shipment) => ({
      id: shipment.id,
      shipmentNo: shipment.shipmentNo,
      carrier: shipment.carrier ?? "",
      serviceLevel: shipment.serviceLevel,
      trackingNo: shipment.trackingNo ?? "",
      status: shipment.status as "shipped" | "delivered",
      shippedAt: shipment.shippedAt?.toISOString() ?? "",
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      items: items
        .filter((item) => item.shipmentId === shipment.id)
        .map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity })),
      timeline: history
        .filter((entry) => entry.shipmentId === shipment.id)
        .map((entry) => ({
          status: entry.status as "shipped" | "delivered",
          occurredAt: entry.occurredAt.toISOString(),
        })),
    }));
  }

  /** Resolves each Cart Product to one current public seller/store and returns unique groups sorted by store ID. */
  private async deriveShipmentGroups(cart: CartResponse): Promise<DerivedShipmentGroup[]> {
    const groupsByStore = new Map<string, DerivedShipmentGroup>();

    for (const item of cart.items) {
      const scope = await this.products.resolvePublicProductSellerStoreScope(item.productId);
      if (!scope) throw staleCartError();
      const existing = groupsByStore.get(scope.storeId);
      if (existing && existing.sellerId !== scope.sellerId) {
        throw new AppError({
          code: ERROR_CODE.INTERNAL_ERROR,
          message: "Shipping group ownership is inconsistent.",
          statusCode: 500,
        });
      }
      groupsByStore.set(scope.storeId, { sellerId: scope.sellerId, storeId: scope.storeId });
    }

    return [...groupsByStore.values()].sort((left, right) =>
      left.storeId.localeCompare(right.storeId),
    );
  }

  /** Maps eligible persistence rows to one customer-safe group without leaking another seller's private method. */
  private buildGroupResponse(
    group: DerivedShipmentGroup,
    methods: ShippingMethodRow[],
  ): CheckoutShippingGroup {
    const options = methods
      .filter(
        (method) =>
          method.ownerType === SHIPPING_OWNER_TYPE.PLATFORM ||
          (method.ownerType === SHIPPING_OWNER_TYPE.SELLER && method.sellerId === group.sellerId),
      )
      .map((method) => ({
        id: method.id,
        code: method.code,
        name: method.name,
        pricingType: method.pricingType as "flat",
        rate: method.baseRate,
        currency: method.currency,
      }))
      .sort(
        (left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
      );

    return { sellerId: group.sellerId, storeId: group.storeId, options };
  }

  /** Resolves seller/store IDs where one seller-scoped Shipping permission is actually effective. */
  private resolveSellerScope(context: RequestContext, permission: PermissionCode): ShippingSellerScope {
    this.requireActor(context);
    const sellerIds = [...context.sellerPermissions.entries()]
      .filter(
        ([sellerId, permissions]) => context.sellerIds.has(sellerId) && permissions.has(permission),
      )
      .map(([sellerId]) => sellerId);
    const storeIds = [...context.storeIds];
    if (sellerIds.length === 0 || storeIds.length === 0) {
      throw new AppError({
        code: ERROR_CODE.FORBIDDEN,
        message: "You do not have permission to access seller Shipments.",
        statusCode: 403,
      });
    }
    return { sellerIds, storeIds };
  }

  /** Confirms Payment/Seller Order state before Shipment allocation or stock issue. */
  private assertSellerOrderEligible(snapshot: OrderShippingFulfillmentSnapshot): void {
    if (
      snapshot.paymentStatus !== ORDER_PAYMENT_STATUS.CAPTURED ||
      snapshot.sellerOrderStatus !== SELLER_ORDER_STATUS.PROCESSING
    ) {
      throw this.statusInvalid("Seller Order is not eligible for fulfillment.");
    }
  }

  /** Reads a committed reservation through Inventory and maps failures to the stable Shipping error. */
  private async getReservationForShipment(
    inventory: ShippingInventoryIntegration,
    reservationId: string,
  ): Promise<ShippingReservationSnapshot> {
    try {
      return await inventory.getShippingReservationSnapshot(reservationId);
    } catch (error) {
      throw this.inventoryIssueFailed("Committed Inventory reservation is not available.", error);
    }
  }

  /** Runs one no-body Shipment lifecycle command through Foundation idempotency. */
  private async runLifecycleIdempotently(
    context: RequestContext,
    shipmentId: string,
    idempotencyKey: string,
    scopePrefix: string,
    successStatus: number,
    work: (
      transaction: DatabaseTransaction,
      scope: ShippingSellerScope,
    ) => Promise<SellerShipmentResponse>,
  ): Promise<SellerShipmentResponse> {
    const actorId = this.requireActor(context);
    const scope = this.resolveSellerScope(context, SHIPPING_PERMISSION.SELLER_MANAGE);
    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const requestHash = sha256(JSON.stringify({ shipmentId: shipmentId.toLowerCase() }));
    const result = await this.idempotency.begin(
      { scope: `${scopePrefix}:${actorId}`, key: normalizedKey, requestHash },
      this.now(),
    );
    if (result.mode === "replay") return this.parseShipmentReplay(result.replay.responseBody);

    try {
      const response = await this.transactionRunner(async (transaction) => {
        const response = await work(transaction, scope);
        await this.idempotencyUsingTransaction(transaction).complete(
          result.recordId,
          successStatus,
          response,
        );
        return response;
      });
      return response;
    } catch (error) {
      await this.failIdempotencySafely(result.recordId);
      throw error;
    }
  }

  /** Loads seller-safe item/history projections and maps one Shipment row to the public service contract. */
  private async buildSellerShipmentResponse(
    repository: ShippingRepository,
    shipment: ShipmentRow,
    scope: ShippingSellerScope,
  ): Promise<SellerShipmentResponse> {
    const [items, history] = await Promise.all([
      repository.listSellerShipmentItems([shipment.id], scope),
      repository.listSellerShipmentHistory([shipment.id], scope),
    ]);
    return this.toSellerShipmentResponse(shipment, items, history);
  }

  /** Converts persisted Shipment facts into the seller-safe contract without leaking Inventory identifiers. */
  private toSellerShipmentResponse(
    shipment: ShipmentRow,
    items: Array<{ shipmentId: string; orderItemId: string; quantity: number }>,
    history: Array<{
      id: string;
      shipmentId: string;
      status: string;
      source: string;
      occurredAt: Date;
    }>,
  ): SellerShipmentResponse {
    return {
      id: shipment.id,
      sellerOrderId: shipment.sellerOrderId,
      shipmentNo: shipment.shipmentNo,
      carrier: shipment.carrier,
      serviceLevel: shipment.serviceLevel,
      trackingNo: shipment.trackingNo,
      status: shipment.status as SellerShipmentResponse["status"],
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      items: items
        .filter((item) => item.shipmentId === shipment.id)
        .map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity })),
      timeline: history
        .filter((entry) => entry.shipmentId === shipment.id)
        .map((entry) => ({
          id: entry.id,
          status: entry.status as SellerShipmentResponse["status"],
          source: entry.source,
          occurredAt: entry.occurredAt.toISOString(),
        })),
    };
  }

  /** Canonicalizes Shipment Item order so semantically identical create requests hash identically. */
  private normalizeCreateInput(input: CreateShipmentInput): CreateShipmentInput {
    return {
      items: [...input.items]
        .map((item) => ({ orderItemId: item.orderItemId.toLowerCase(), quantity: item.quantity }))
        .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId)),
    };
  }

  /** Validates and trims the required Idempotency-Key without logging its raw value. */
  private normalizeIdempotencyKey(idempotencyKey: string): string {
    const value = idempotencyKey.trim();
    if (value.length < 1 || value.length > SHIPPING_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODE.VALIDATION_FAILED,
        message: "A valid Idempotency-Key header is required.",
        statusCode: 422,
      });
    }
    return value;
  }

  /** Parses one persisted idempotency replay and fails closed if its response is inconsistent. */
  private parseShipmentReplay(responseBody: unknown): SellerShipmentResponse {
    const parsed = sellerShipmentResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODE.INTERNAL_ERROR,
        message: "Stored Shipment idempotency response is invalid.",
        statusCode: 500,
      });
    }
    return parsed.data;
  }

  /** Marks one acquired idempotency record failed without hiding the original business error. */
  private async failIdempotencySafely(recordId: string): Promise<void> {
    try {
      await this.idempotency.fail(recordId);
    } catch {
      // Preserve the original business/database error for the caller.
    }
  }

  /** Requires a real authenticated actor for every private Shipment command/read. */
  private requireActor(context: RequestContext): string {
    if (!context.actorId || context.actorType === ACTOR_TYPE.SYSTEM) {
      throw new AppError({
        code: ERROR_CODE.UNAUTHENTICATED,
        message: "Authentication is required.",
        statusCode: 401,
      });
    }
    return context.actorId;
  }

  /** Creates the non-enumerating Shipment not-found error used for seller-scoped resources. */
  private shipmentNotFound(): AppError {
    return new AppError({
      code: SHIPPING_ERROR_CODE.SHIPMENT_NOT_FOUND,
      message: "Shipment was not found.",
      statusCode: 404,
    });
  }

  /** Creates the stable quantity error for over-allocation and invalid Shipment Item ownership. */
  private quantityInvalid(message: string): AppError {
    return new AppError({
      code: SHIPPING_ERROR_CODE.SHIPMENT_QUANTITY_INVALID,
      message,
      statusCode: 409,
    });
  }

  /** Creates the stable lifecycle error for Seller Order or Shipment states that cannot progress. */
  private statusInvalid(message: string): AppError {
    return new AppError({
      code: SHIPPING_ERROR_CODE.SHIPMENT_STATUS_INVALID,
      message,
      statusCode: 409,
    });
  }

  /** Creates the stable tracking error for missing/immutable tracking information. */
  private trackingInvalid(message: string): AppError {
    return new AppError({
      code: SHIPPING_ERROR_CODE.TRACKING_INVALID,
      message,
      statusCode: 409,
    });
  }

  /** Creates the stable Shipping wrapper for Inventory reservation/issue failures. */
  private inventoryIssueFailed(message: string, cause?: unknown): AppError {
    return new AppError({
      code: SHIPPING_ERROR_CODE.INVENTORY_ISSUE_FAILED,
      message,
      statusCode: 409,
      cause,
    });
  }
}

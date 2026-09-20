import type {
  CartItemRow,
  CartRow,
  WishlistItemRow,
  WishlistRow,
} from "../../database/schema/index.js";
import type { DatabaseTransaction } from "../../database/types.js";
import { withTransaction } from "../../database/transaction.js";
import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { assertPermission } from "../../common/policies/policy.js";
import { ACTOR_TYPE } from "../../common/security/security.contract.js";
import type { RequestContext } from "../../common/types/request-context.js";
import { AdministrationService } from "../administration/administration.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { ProductsService } from "../products/products.service.js";
import type { PublicProductCommerceDetailResponse } from "../products/products.schema.js";
import {
  CART_WISHLIST_ERROR_CODE,
  CART_WISHLIST_LIMITS,
  CART_WISHLIST_OUTBOX_EVENT,
  CART_WISHLIST_PERMISSION,
  DEFAULT_WISHLIST_NAME,
} from "./cart-wishlist.constants.js";
import { CartWishlistRepository } from "./cart-wishlist.repository.js";
import type {
  AddCartItemInput,
  AddWishlistItemInput,
  CartItemResponse,
  CartResponse,
  UpdateCartItemInput,
  WishlistItemResponse,
  WishlistResponse,
} from "./cart-wishlist.schema.js";

/** Runs one Module 8 transaction and allows tests to replace the real database boundary. */
export type CartWishlistTransactionRunner = <T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
) => Promise<T>;

/** Public Product boundary consumed by Cart/Wishlist without importing Product persistence. */
export interface CartWishlistProductIntegration {
  /** Resolves a persisted variant to its Product identifier without exposing private Product fields. */
  findProductIdByVariantId(variantId: string): Promise<string | null>;

  /** Returns a public Product aggregate only while the Product is storefront-eligible. */
  findPublicProductById(productId: string): Promise<PublicProductCommerceDetailResponse | null>;

  /** Returns safe public Store/card presentation data for one storefront-eligible Product. */
  findPublicProductDisplayContextById(productId: string): Promise<{
    storeId: string;
    storeSlug: string;
    storeName: string;
    thumbnailFileId: string | null;
  } | null>;
}

/** Read-only Inventory boundary used only to show current availability in Cart/Wishlist previews. */
export interface CartWishlistInventoryIntegration {
  /** Returns whether at least one supplied variant currently has positive available stock. */
  hasAvailableStockForVariants(variantIds: string[]): Promise<boolean>;
}

/** Administration boundary used to create an empty cart with the configured marketplace currency. */
export interface CartWishlistCurrencyIntegration {
  /** Returns the current marketplace default currency from Administration settings. */
  getDefaultCurrency(): Promise<string>;
}

/** Explicit dependencies keep Module 8 service logic simple and independently testable. */
export interface CartWishlistServiceDependencies {
  repository?: CartWishlistRepository;
  transactionRunner?: CartWishlistTransactionRunner;
  products?: CartWishlistProductIntegration;
  inventory?: CartWishlistInventoryIntegration;
  currencies?: CartWishlistCurrencyIntegration;
}

/** Current public Product and optional public variant used to build one Cart display line. */
interface PublicVariantSnapshot {
  productId: string;
  product: PublicProductCommerceDetailResponse | null;
  variant: PublicProductCommerceDetailResponse["variants"][number] | null;
  display: {
    storeId: string;
    storeSlug: string;
    storeName: string;
    thumbnailFileId: string | null;
  } | null;
}

/** Creates one stable Module 8 application error. */
function cartWishlistError(
  code: string,
  message: string,
  statusCode: number,
): AppError {
  return new AppError({ code, message, statusCode });
}

/** Converts a validated two-decimal Product price into exact integer cents. */
function priceToCents(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const cents = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(cents);
}

/** Converts exact integer cents back to a canonical two-decimal money string. */
function centsToPrice(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** Multiplies a Product price by an integer quantity without floating-point money arithmetic. */
function multiplyPrice(price: string, quantity: number): string {
  return centsToPrice(priceToCents(price) * BigInt(quantity));
}

/** Module 8 business service for customer-owned Cart/Wishlist intent and non-authoritative previews. */
export class CartWishlistService {
  private readonly repository: CartWishlistRepository;
  private readonly transactionRunner: CartWishlistTransactionRunner;
  private readonly products: CartWishlistProductIntegration;
  private readonly inventory: CartWishlistInventoryIntegration;
  private readonly currencies: CartWishlistCurrencyIntegration;

  /** Stores explicit dependencies while keeping normal application composition straightforward. */
  constructor(dependencies: CartWishlistServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new CartWishlistRepository();
    this.transactionRunner = dependencies.transactionRunner ?? withTransaction;
    this.products = dependencies.products ?? new ProductsService();
    this.inventory = dependencies.inventory ?? new InventoryService();
    this.currencies = dependencies.currencies ?? new AdministrationService();
  }

  /** Returns the authenticated customer's cart with current Product/Inventory preview data. */
  async getCart(context: RequestContext): Promise<CartResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );
    return this.getOrCreateCartResponse(customerUserId);
  }

  /** Returns current customer Cart intent for trusted Checkout composition without requiring the Cart route permission. */
  async getCheckoutCart(context: RequestContext): Promise<CartResponse> {
    const customerUserId = this.requireCustomerIdentity(context);
    return this.getOrCreateCartResponse(customerUserId);
  }

  /** Adds a public active variant, merging duplicate lines while keeping Cart totals non-authoritative. */
  async addCartItem(
    context: RequestContext,
    input: AddCartItemInput,
  ): Promise<CartResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );
    this.assertQuantity(input.quantity);

    const publicSnapshot = await this.loadPublicVariantForCartAdd(input.variantId);
    const variant = publicSnapshot.variant;
    if (!variant) throw this.cartProductUnavailable();

    const cart = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      let lockedCart = await this.ensureCart(
        repository,
        customerUserId,
        variant.currency,
      );
      const currentItems = await repository.listCartItemsForCustomer(customerUserId);

      if (currentItems.length === 0 && lockedCart.currency !== variant.currency) {
        const updatedCurrency = await repository.updateCartCurrencyForCustomer(
          customerUserId,
          variant.currency,
        );
        if (!updatedCurrency) throw this.internalStateError();
        lockedCart = updatedCurrency;
      }

      if (lockedCart.currency !== variant.currency) {
        throw this.cartCurrencyMismatch();
      }

      const existing = await repository.findCartItemByVariantForCustomer(
        input.variantId,
        customerUserId,
      );
      let savedItem: CartItemRow;

      if (existing) {
        const nextQuantity = existing.quantity + input.quantity;
        this.assertQuantity(nextQuantity);
        const updated = await repository.updateCartItemQuantityForCustomer(
          existing.id,
          customerUserId,
          nextQuantity,
        );
        if (!updated) throw this.cartItemNotFound();
        savedItem = updated;
      } else {
        const created = await repository.createCartItemForCustomer({
          customerUserId,
          variantId: input.variantId,
          quantity: input.quantity,
        });
        if (!created) throw this.internalStateError();
        savedItem = created;
      }

      const touchedCart = await repository.touchCartForCustomer(customerUserId);
      if (!touchedCart) throw this.internalStateError();

      await OutboxService.using(tx).enqueue({
        eventType: CART_WISHLIST_OUTBOX_EVENT.CART_ITEM_ADDED,
        aggregateType: "cart",
        aggregateId: touchedCart.id,
        payload: {
          cartId: touchedCart.id,
          cartItemId: savedItem.id,
          customerUserId,
          variantId: savedItem.variantId,
          addedQuantity: input.quantity,
          quantity: savedItem.quantity,
        },
      });

      return touchedCart;
    });

    return this.buildCartResponse(cart, customerUserId);
  }

  /** Changes one owned cart-line quantity without treating zero as an implicit delete command. */
  async updateCartItem(
    context: RequestContext,
    itemId: string,
    input: UpdateCartItemInput,
  ): Promise<CartResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );
    this.assertQuantity(input.quantity);

    const cart = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      const lockedCart = await repository.findCartByCustomerUserIdForUpdate(customerUserId);
      if (!lockedCart) throw this.cartItemNotFound();

      const existing = await repository.findCartItemByIdForCustomer(
        itemId,
        customerUserId,
      );
      if (!existing) throw this.cartItemNotFound();

      const updated = await repository.updateCartItemQuantityForCustomer(
        itemId,
        customerUserId,
        input.quantity,
      );
      if (!updated) throw this.cartItemNotFound();

      const touchedCart = await repository.touchCartForCustomer(customerUserId);
      if (!touchedCart) throw this.internalStateError();
      return touchedCart;
    });

    return this.buildCartResponse(cart, customerUserId);
  }

  /** Removes one owned cart line and appends the required durable item-removed event. */
  async removeCartItem(
    context: RequestContext,
    itemId: string,
  ): Promise<CartResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );

    const cart = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      const lockedCart = await repository.findCartByCustomerUserIdForUpdate(customerUserId);
      if (!lockedCart) throw this.cartItemNotFound();

      const removed = await repository.deleteCartItemForCustomer(itemId, customerUserId);
      if (!removed) throw this.cartItemNotFound();

      const touchedCart = await repository.touchCartForCustomer(customerUserId);
      if (!touchedCart) throw this.internalStateError();

      await this.enqueueCartItemRemoved(tx, touchedCart, customerUserId, removed);
      return touchedCart;
    });

    return this.buildCartResponse(cart, customerUserId);
  }

  /** Clears only the authenticated customer's cart and records one removal event per deleted line. */
  async clearCart(context: RequestContext): Promise<CartResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.CART_MANAGE_OWN,
    );

    const existingCart = await this.repository.findCartByCustomerUserId(customerUserId);
    const initialCurrency = existingCart?.currency ?? await this.currencies.getDefaultCurrency();

    const cart = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      await this.ensureCart(
        repository,
        customerUserId,
        initialCurrency,
      );

      const removedItems = await repository.deleteAllCartItemsForCustomer(customerUserId);
      const touchedCart = await repository.touchCartForCustomer(customerUserId);
      if (!touchedCart) throw this.internalStateError();

      for (const removed of removedItems) {
        await this.enqueueCartItemRemoved(tx, touchedCart, customerUserId, removed);
      }

      return touchedCart;
    });

    return this.buildCartResponse(cart, customerUserId);
  }

  /** Returns the authenticated customer's default wishlist with current public display state. */
  async getWishlist(context: RequestContext): Promise<WishlistResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
    );

    let wishlist = await this.repository.findDefaultWishlistByCustomerUserId(customerUserId);
    if (!wishlist) {
      wishlist = await this.transactionRunner(async (tx) => {
        const repository = new CartWishlistRepository(tx);
        return this.ensureDefaultWishlist(repository, customerUserId);
      });
    }

    return this.buildWishlistResponse(wishlist, customerUserId);
  }

  /**
   * Adds one public Product or public variant to the default wishlist without
   * duplicating logical entries.
   */
  async addWishlistItem(
    context: RequestContext,
    input: AddWishlistItemInput,
  ): Promise<WishlistResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
    );
    const product = await this.products.findPublicProductById(input.productId);
    if (!product) throw this.wishlistProductNotFound();

    if (
      input.variantId &&
      !product.variants.some((variant) => variant.id === input.variantId)
    ) {
      throw this.wishlistProductNotFound();
    }

    const wishlist = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      const lockedWishlist = await this.ensureDefaultWishlist(repository, customerUserId);
      const existing = await repository.findWishlistItemByProductVariantForCustomer(
        customerUserId,
        input.productId,
        input.variantId ?? null,
      );
      if (existing) return lockedWishlist;

      const created = await repository.createWishlistItemForCustomer({
        customerUserId,
        productId: input.productId,
        variantId: input.variantId ?? null,
      });
      if (!created) throw this.internalStateError();

      await OutboxService.using(tx).enqueue({
        eventType: CART_WISHLIST_OUTBOX_EVENT.WISHLIST_ITEM_ADDED,
        aggregateType: "wishlist",
        aggregateId: lockedWishlist.id,
        payload: {
          wishlistId: lockedWishlist.id,
          wishlistItemId: created.id,
          customerUserId,
          productId: created.productId,
          variantId: created.variantId,
        },
      });

      return lockedWishlist;
    });

    return this.buildWishlistResponse(wishlist, customerUserId);
  }

  /** Removes one item only from the authenticated customer's default wishlist. */
  async removeWishlistItem(
    context: RequestContext,
    itemId: string,
  ): Promise<WishlistResponse> {
    const customerUserId = this.requireCustomerActor(
      context,
      CART_WISHLIST_PERMISSION.WISHLIST_MANAGE_OWN,
    );

    const wishlist = await this.transactionRunner(async (tx) => {
      const repository = new CartWishlistRepository(tx);
      const lockedWishlist = await repository.findDefaultWishlistByCustomerUserIdForUpdate(
        customerUserId,
      );
      if (!lockedWishlist) throw this.wishlistItemNotFound();

      const removed = await repository.deleteWishlistItemForCustomer(
        itemId,
        customerUserId,
      );
      if (!removed) throw this.wishlistItemNotFound();
      return lockedWishlist;
    });

    return this.buildWishlistResponse(wishlist, customerUserId);
  }

  /** Ensures one cart exists inside an already-open transaction and returns it locked for mutation. */
  private async ensureCart(
    repository: CartWishlistRepository,
    customerUserId: string,
    initialCurrency: string,
  ): Promise<CartRow> {
    const existing = await repository.findCartByCustomerUserIdForUpdate(customerUserId);
    if (existing) return existing;

    const created = await repository.createCartIfMissing({
      customerUserId,
      currency: initialCurrency,
    });
    if (created) return created;

    const concurrent = await repository.findCartByCustomerUserIdForUpdate(customerUserId);
    if (!concurrent) throw this.internalStateError();
    return concurrent;
  }

  /** Ensures the customer has exactly one default wishlist inside the current transaction. */
  private async ensureDefaultWishlist(
    repository: CartWishlistRepository,
    customerUserId: string,
  ): Promise<WishlistRow> {
    const existing = await repository.findDefaultWishlistByCustomerUserIdForUpdate(
      customerUserId,
    );
    if (existing) return existing;

    const created = await repository.createDefaultWishlistIfMissing({
      customerUserId,
      name: DEFAULT_WISHLIST_NAME,
    });
    if (created) return created;

    const concurrent = await repository.findDefaultWishlistByCustomerUserIdForUpdate(
      customerUserId,
    );
    if (!concurrent) throw this.internalStateError();
    return concurrent;
  }

  /** Builds one cart preview from persisted intent plus current public Product and Inventory reads. */
  private async buildCartResponse(
    cart: CartRow,
    customerUserId: string,
  ): Promise<CartResponse> {
    const rows = await this.repository.listCartItemsForCustomer(customerUserId);
    const items = await Promise.all(
      rows.map((row) => this.buildCartItemResponse(row, cart.currency)),
    );

    let previewSubtotalCents = 0n;
    for (const item of items) {
      if (item.previewLineSubtotal && item.currency === cart.currency) {
        previewSubtotalCents += priceToCents(item.previewLineSubtotal);
      }
    }

    return {
      id: cart.id,
      currency: cart.currency,
      items,
      previewSubtotal: centsToPrice(previewSubtotalCents),
      hasUnavailableItems: items.some(
        (item) => !item.isPurchasable || !item.inStock || item.currency !== cart.currency,
      ),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  /** Maps one persisted cart line to a current public-safe, non-authoritative display response. */
  private async buildCartItemResponse(
    row: CartItemRow,
    cartCurrency: string,
  ): Promise<CartItemResponse> {
    const snapshot = await this.loadPublicVariant(row.variantId);
    const variant = snapshot.variant;
    const inStock = variant
      ? await this.inventory.hasAvailableStockForVariants([variant.id])
      : false;
    const currency = variant?.currency ?? cartCurrency;
    const currencyMatchesCart = currency === cartCurrency;

    return {
      id: row.id,
      productId: snapshot.productId,
      variantId: row.variantId,
      productName: snapshot.product?.name ?? null,
      productSlug: snapshot.product?.slug ?? null,
      storeId: snapshot.display?.storeId ?? null,
      storeSlug: snapshot.display?.storeSlug ?? null,
      storeName: snapshot.display?.storeName ?? null,
      thumbnailFileId: snapshot.display?.thumbnailFileId ?? null,
      variantTitle: variant?.title ?? null,
      sku: variant?.sku ?? null,
      currentUnitPrice: variant?.price ?? null,
      currency,
      quantity: row.quantity,
      previewLineSubtotal:
        variant && currencyMatchesCart ? multiplyPrice(variant.price, row.quantity) : null,
      inStock,
      isPurchasable: Boolean(snapshot.product && variant && currencyMatchesCart),
      addedAt: row.addedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Builds the default wishlist response while preserving saved but currently
   * unavailable Product references.
   */
  private async buildWishlistResponse(
    wishlist: WishlistRow,
    customerUserId: string,
  ): Promise<WishlistResponse> {
    const rows = await this.repository.listWishlistItemsForCustomer(customerUserId);
    const items = await Promise.all(rows.map((row) => this.buildWishlistItemResponse(row)));

    return {
      id: wishlist.id,
      name: wishlist.name,
      isDefault: wishlist.isDefault,
      items,
      createdAt: wishlist.createdAt.toISOString(),
    };
  }

  /** Maps one saved wishlist reference to current public-safe Product and availability data. */
  private async buildWishlistItemResponse(
    row: WishlistItemRow,
  ): Promise<WishlistItemResponse> {
    const product = await this.products.findPublicProductById(row.productId);
    if (!product) return this.unavailableWishlistItem(row);

    if (row.variantId) {
      const variant = product.variants.find((candidate) => candidate.id === row.variantId) ?? null;
      if (!variant) return this.unavailableWishlistItem(row, product);

      const inStock = await this.inventory.hasAvailableStockForVariants([variant.id]);
      const display = await this.products.findPublicProductDisplayContextById(row.productId);
      return {
        id: row.id,
        productId: row.productId,
        variantId: row.variantId,
        productName: product.name,
        productSlug: product.slug,
        storeId: display?.storeId ?? null,
        storeSlug: display?.storeSlug ?? null,
        storeName: display?.storeName ?? null,
        thumbnailFileId: display?.thumbnailFileId ?? null,
        variantTitle: variant.title,
        currentUnitPrice: variant.price,
        currency: variant.currency,
        inStock,
        isPurchasable: true,
        createdAt: row.createdAt.toISOString(),
      };
    }

    const variantIds = product.variants.map((variant) => variant.id);
    const [inStock, display] = await Promise.all([
      this.inventory.hasAvailableStockForVariants(variantIds),
      this.products.findPublicProductDisplayContextById(row.productId),
    ]);
    const singleVariant = product.variants.length === 1 ? product.variants[0] : null;

    return {
      id: row.id,
      productId: row.productId,
      variantId: null,
      productName: product.name,
      productSlug: product.slug,
      storeId: display?.storeId ?? null,
      storeSlug: display?.storeSlug ?? null,
      storeName: display?.storeName ?? null,
      thumbnailFileId: display?.thumbnailFileId ?? null,
      variantTitle: null,
      currentUnitPrice: singleVariant?.price ?? null,
      currency: singleVariant?.currency ?? null,
      inStock,
      isPurchasable: product.variants.length > 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Returns a saved wishlist item safely when its Product or variant is no longer public. */
  private unavailableWishlistItem(
    row: WishlistItemRow,
    product: PublicProductCommerceDetailResponse | null = null,
  ): WishlistItemResponse {
    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      productName: product?.name ?? null,
      productSlug: product?.slug ?? null,
      storeId: null,
      storeSlug: null,
      storeName: null,
      thumbnailFileId: null,
      variantTitle: null,
      currentUnitPrice: null,
      currency: null,
      inStock: false,
      isPurchasable: false,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Resolves a client-supplied Cart variant and maps unknown/private variants to the safe unavailable error. */
  private async loadPublicVariantForCartAdd(
    variantId: string,
  ): Promise<PublicVariantSnapshot> {
    const productId = await this.products.findProductIdByVariantId(variantId);
    if (!productId) throw this.cartProductUnavailable();

    const product = await this.products.findPublicProductById(productId);
    const variant = product?.variants.find((candidate) => candidate.id === variantId) ?? null;
    if (!product || !variant) throw this.cartProductUnavailable();
    const display = await this.products.findPublicProductDisplayContextById(productId);
    return { productId, product, variant, display };
  }

  /** Resolves one persisted variant to its current public Product/variant state. */
  private async loadPublicVariant(variantId: string): Promise<PublicVariantSnapshot> {
    const productId = await this.products.findProductIdByVariantId(variantId);
    if (!productId) throw this.internalStateError();

    const [product, display] = await Promise.all([
      this.products.findPublicProductById(productId),
      this.products.findPublicProductDisplayContextById(productId),
    ]);
    const variant = product?.variants.find((candidate) => candidate.id === variantId) ?? null;
    return { productId, product, variant, display };
  }

  /** Appends the required cart.item_removed event using the same transaction as the delete. */
  private async enqueueCartItemRemoved(
    transaction: DatabaseTransaction,
    cart: CartRow,
    customerUserId: string,
    removed: CartItemRow,
  ): Promise<void> {
    await OutboxService.using(transaction).enqueue({
      eventType: CART_WISHLIST_OUTBOX_EVENT.CART_ITEM_REMOVED,
      aggregateType: "cart",
      aggregateId: cart.id,
      payload: {
        cartId: cart.id,
        cartItemId: removed.id,
        customerUserId,
        variantId: removed.variantId,
        removedQuantity: removed.quantity,
      },
    });
  }

  /** Loads the current customer Cart, creating the single empty Cart only when it does not exist yet. */
  private async getOrCreateCartResponse(customerUserId: string): Promise<CartResponse> {
    let cart = await this.repository.findCartByCustomerUserId(customerUserId);
    if (!cart) {
      const defaultCurrency = await this.currencies.getDefaultCurrency();
      cart = await this.transactionRunner(async (tx) => {
        const repository = new CartWishlistRepository(tx);
        return this.ensureCart(repository, customerUserId, defaultCurrency);
      });
    }

    return this.buildCartResponse(cart, customerUserId);
  }

  /** Requires only authenticated customer identity for trusted internal commerce composition. */
  private requireCustomerIdentity(context: RequestContext): string {
    if (!context.actorId) {
      throw cartWishlistError(
        ERROR_CODE.UNAUTHENTICATED,
        "Authentication is required.",
        401,
      );
    }
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) {
      throw cartWishlistError(
        ERROR_CODE.FORBIDDEN,
        "Customer commerce self-service is not available to this actor.",
        403,
      );
    }
    return context.actorId;
  }

  /** Requires an authenticated customer actor plus the exact customer-owned Module 8 permission. */
  private requireCustomerActor(
    context: RequestContext,
    permission: (typeof CART_WISHLIST_PERMISSION)[keyof typeof CART_WISHLIST_PERMISSION],
  ): string {
    if (!context.actorId) {
      throw cartWishlistError(
        ERROR_CODE.UNAUTHENTICATED,
        "Authentication is required.",
        401,
      );
    }
    if (context.actorType !== ACTOR_TYPE.CUSTOMER) {
      throw cartWishlistError(
        ERROR_CODE.FORBIDDEN,
        "Customer Cart/Wishlist self-service is not available to this actor.",
        403,
      );
    }

    assertPermission(context, permission);
    return context.actorId;
  }

  /** Enforces the same quantity ceiling even when service methods are called outside HTTP validation. */
  private assertQuantity(quantity: number): void {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY
    ) {
      throw cartWishlistError(
        CART_WISHLIST_ERROR_CODE.CART_QUANTITY_INVALID,
        `Cart quantity must be between 1 and ${CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY}.`,
        400,
      );
    }
  }

  /** Creates the required safe not-found error for an owned cart line. */
  private cartItemNotFound(): AppError {
    return cartWishlistError(
      CART_WISHLIST_ERROR_CODE.CART_ITEM_NOT_FOUND,
      "Cart item was not found.",
      404,
    );
  }

  /** Creates the required error when a Product/variant cannot currently be newly added to Cart. */
  private cartProductUnavailable(): AppError {
    return cartWishlistError(
      CART_WISHLIST_ERROR_CODE.CART_PRODUCT_UNAVAILABLE,
      "The Product variant is not currently available to add to Cart.",
      409,
    );
  }

  /** Creates the required conflict when one Cart would otherwise mix different currencies. */
  private cartCurrencyMismatch(): AppError {
    return cartWishlistError(
      CART_WISHLIST_ERROR_CODE.CART_CURRENCY_MISMATCH,
      "The Product currency does not match the current Cart currency.",
      409,
    );
  }

  /** Hides private Product existence when a wishlist add references a non-public Product/variant. */
  private wishlistProductNotFound(): AppError {
    return cartWishlistError(
      ERROR_CODE.RESOURCE_NOT_FOUND,
      "The requested Product or variant is not available.",
      404,
    );
  }

  /** Returns one scope-safe not-found error for an owned wishlist item. */
  private wishlistItemNotFound(): AppError {
    return cartWishlistError(
      ERROR_CODE.RESOURCE_NOT_FOUND,
      "Wishlist item was not found.",
      404,
    );
  }

  /** Returns a safe internal error when persisted Module 8 ownership state becomes inconsistent. */
  private internalStateError(): AppError {
    return cartWishlistError(
      ERROR_CODE.INTERNAL_ERROR,
      "Cart/Wishlist state could not be completed safely.",
      500,
    );
  }
}

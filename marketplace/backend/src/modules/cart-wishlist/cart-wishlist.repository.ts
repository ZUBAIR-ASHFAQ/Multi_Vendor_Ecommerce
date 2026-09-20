import {
  and,
  asc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  cartItems,
  carts,
  wishlistItems,
  wishlists,
  type CartItemRow,
  type CartRow,
  type WishlistItemRow,
  type WishlistRow,
} from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";

/** Values persisted when a customer's cart is created for the first time. */
export interface CreateCartRecordInput {
  customerUserId: string;
  currency: string;
}

/** Values used to persist a cart item inside one exact customer-owned cart. */
export interface CreateCartItemRecordInput {
  customerUserId: string;
  variantId: string;
  quantity: number;
}

/** Values persisted when the Module 8 default wishlist is created. */
export interface CreateDefaultWishlistRecordInput {
  customerUserId: string;
  name: string;
}

/** Values used to persist a Product/variant inside one exact customer's default wishlist. */
export interface CreateWishlistItemRecordInput {
  customerUserId: string;
  productId: string;
  variantId?: string | null;
}

/**
 * Persistence-only Module 8 repository.
 * Customer ownership is enforced in every private read/write query, while Product,
 * currency, quantity, duplicate-merge, and Inventory decisions remain in the service.
 */
export class CartWishlistRepository {
  /** Creates a repository bound to the root database client or an existing transaction. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Reads the single cart owned by one exact authenticated customer user ID. */
  async findCartByCustomerUserId(customerUserId: string): Promise<CartRow | null> {
    const [row] = await this.executor
      .select()
      .from(carts)
      .where(eq(carts.customerUserId, customerUserId))
      .limit(1);

    return row ?? null;
  }

  /** Locks the customer's cart so service transactions can serialize cart mutations safely. */
  async findCartByCustomerUserIdForUpdate(
    customerUserId: string,
  ): Promise<CartRow | null> {
    const [row] = await this.executor
      .select()
      .from(carts)
      .where(eq(carts.customerUserId, customerUserId))
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Creates a cart only when the customer does not already own one. */
  async createCartIfMissing(
    input: CreateCartRecordInput,
  ): Promise<CartRow | null> {
    const [row] = await this.executor
      .insert(carts)
      .values(input)
      .onConflictDoNothing({ target: carts.customerUserId })
      .returning();

    return row ?? null;
  }

  /** Refreshes the cart modification timestamp only for the supplied customer owner. */
  async touchCartForCustomer(customerUserId: string): Promise<CartRow | null> {
    const [row] = await this.executor
      .update(carts)
      .set({ updatedAt: new Date() })
      .where(eq(carts.customerUserId, customerUserId))
      .returning();

    return row ?? null;
  }

  /** Changes cart currency only for the supplied owner, used when an empty cart starts a new currency. */
  async updateCartCurrencyForCustomer(
    customerUserId: string,
    currency: string,
  ): Promise<CartRow | null> {
    const [row] = await this.executor
      .update(carts)
      .set({ currency, updatedAt: new Date() })
      .where(eq(carts.customerUserId, customerUserId))
      .returning();

    return row ?? null;
  }

  /** Lists cart items only through the cart owned by the supplied customer user ID. */
  async listCartItemsForCustomer(
    customerUserId: string,
  ): Promise<CartItemRow[]> {
    const rows = await this.executor
      .select({ item: cartItems })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(eq(carts.customerUserId, customerUserId))
      .orderBy(asc(cartItems.addedAt), asc(cartItems.id));

    return rows.map((row) => row.item);
  }

  /** Reads one cart item only when it belongs to the supplied customer. */
  async findCartItemByIdForCustomer(
    itemId: string,
    customerUserId: string,
  ): Promise<CartItemRow | null> {
    const [row] = await this.executor
      .select({ item: cartItems })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(
        and(
          eq(cartItems.id, itemId),
          eq(carts.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row?.item ?? null;
  }

  /** Reads one logical cart line by variant inside the supplied customer's cart. */
  async findCartItemByVariantForCustomer(
    variantId: string,
    customerUserId: string,
  ): Promise<CartItemRow | null> {
    const [row] = await this.executor
      .select({ item: cartItems })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(
        and(
          eq(cartItems.variantId, variantId),
          eq(carts.customerUserId, customerUserId),
        ),
      )
      .limit(1);

    return row?.item ?? null;
  }

  /** Inserts one cart line only into the cart owned by the supplied customer. */
  async createCartItemForCustomer(
    input: CreateCartItemRecordInput,
  ): Promise<CartItemRow | null> {
    const cart = await this.findCartByCustomerUserId(input.customerUserId);
    if (!cart) return null;

    const [row] = await this.executor
      .insert(cartItems)
      .values({
        cartId: cart.id,
        variantId: input.variantId,
        quantity: input.quantity,
      })
      .returning();

    return row ?? null;
  }

  /** Updates quantity only when the cart item belongs to the supplied customer. */
  async updateCartItemQuantityForCustomer(
    itemId: string,
    customerUserId: string,
    quantity: number,
  ): Promise<CartItemRow | null> {
    const ownedCartIds = this.executor
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerUserId, customerUserId));

    const [row] = await this.executor
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(
        and(
          eq(cartItems.id, itemId),
          inArray(cartItems.cartId, ownedCartIds),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Deletes one cart item only when the supplied customer owns its cart. */
  async deleteCartItemForCustomer(
    itemId: string,
    customerUserId: string,
  ): Promise<CartItemRow | null> {
    const ownedCartIds = this.executor
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerUserId, customerUserId));

    const [row] = await this.executor
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.id, itemId),
          inArray(cartItems.cartId, ownedCartIds),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Deletes and returns every cart line owned by the supplied customer only. */
  async deleteAllCartItemsForCustomer(
    customerUserId: string,
  ): Promise<CartItemRow[]> {
    const ownedCartIds = this.executor
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.customerUserId, customerUserId));

    return this.executor
      .delete(cartItems)
      .where(inArray(cartItems.cartId, ownedCartIds))
      .returning();
  }

  /** Reads the one default wishlist owned by the supplied customer. */
  async findDefaultWishlistByCustomerUserId(
    customerUserId: string,
  ): Promise<WishlistRow | null> {
    const [row] = await this.executor
      .select()
      .from(wishlists)
      .where(
        and(
          eq(wishlists.customerUserId, customerUserId),
          eq(wishlists.isDefault, true),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Locks the customer's default wishlist so service mutations can be serialized safely. */
  async findDefaultWishlistByCustomerUserIdForUpdate(
    customerUserId: string,
  ): Promise<WishlistRow | null> {
    const [row] = await this.executor
      .select()
      .from(wishlists)
      .where(
        and(
          eq(wishlists.customerUserId, customerUserId),
          eq(wishlists.isDefault, true),
        ),
      )
      .limit(1)
      .for("update");

    return row ?? null;
  }

  /** Creates the default wishlist only when no competing default wishlist already exists. */
  async createDefaultWishlistIfMissing(
    input: CreateDefaultWishlistRecordInput,
  ): Promise<WishlistRow | null> {
    const [row] = await this.executor
      .insert(wishlists)
      .values({ ...input, isDefault: true })
      .onConflictDoNothing()
      .returning();

    return row ?? null;
  }

  /** Lists items only from the default wishlist owned by the supplied customer. */
  async listWishlistItemsForCustomer(
    customerUserId: string,
  ): Promise<WishlistItemRow[]> {
    const rows = await this.executor
      .select({ item: wishlistItems })
      .from(wishlistItems)
      .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
      .where(
        and(
          eq(wishlists.customerUserId, customerUserId),
          eq(wishlists.isDefault, true),
        ),
      )
      .orderBy(asc(wishlistItems.createdAt), asc(wishlistItems.id));

    return rows.map((row) => row.item);
  }


  /** Finds a matching Product/variant entry only in the customer's default wishlist. */
  async findWishlistItemByProductVariantForCustomer(
    customerUserId: string,
    productId: string,
    variantId: string | null,
  ): Promise<WishlistItemRow | null> {
    const variantCondition = variantId
      ? eq(wishlistItems.variantId, variantId)
      : isNull(wishlistItems.variantId);

    const [row] = await this.executor
      .select({ item: wishlistItems })
      .from(wishlistItems)
      .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
      .where(
        and(
          eq(wishlists.customerUserId, customerUserId),
          eq(wishlists.isDefault, true),
          eq(wishlistItems.productId, productId),
          variantCondition,
        ),
      )
      .limit(1);

    return row?.item ?? null;
  }

  /** Inserts one wishlist item only into the supplied customer's default wishlist. */
  async createWishlistItemForCustomer(
    input: CreateWishlistItemRecordInput,
  ): Promise<WishlistItemRow | null> {
    const wishlist = await this.findDefaultWishlistByCustomerUserId(input.customerUserId);
    if (!wishlist) return null;

    const [row] = await this.executor
      .insert(wishlistItems)
      .values({
        wishlistId: wishlist.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
      })
      .returning();

    return row ?? null;
  }

  /** Deletes one item only from the supplied customer's default wishlist. */
  async deleteWishlistItemForCustomer(
    itemId: string,
    customerUserId: string,
  ): Promise<WishlistItemRow | null> {
    const ownedDefaultWishlistIds = this.executor
      .select({ id: wishlists.id })
      .from(wishlists)
      .where(
        and(
          eq(wishlists.customerUserId, customerUserId),
          eq(wishlists.isDefault, true),
        ),
      );

    const [row] = await this.executor
      .delete(wishlistItems)
      .where(
        and(
          eq(wishlistItems.id, itemId),
          inArray(wishlistItems.wishlistId, ownedDefaultWishlistIds),
        ),
      )
      .returning();

    return row ?? null;
  }
}

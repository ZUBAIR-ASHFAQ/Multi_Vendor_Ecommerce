import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import {
  CartWishlistRepository,
} from "../../src/modules/cart-wishlist/cart-wishlist.repository.js";
import {
  createCartWishlistVariantFixture,
  createPlatformAdmin,
  loginUser,
  registerCustomer,
  resetModule8Tables,
} from "./module8.test-helpers.js";

beforeEach(async () => {
  await resetModule8Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 8 repository customer scope", () => {
  it("keeps cart reads, updates, and deletes inside the exact customer owner scope", async () => {
    const admin = await createPlatformAdmin(`module8-repo-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createCartWishlistVariantFixture(adminToken, "CartScope");
    const customerA = await registerCustomer(`module8-cart-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module8-cart-b-${randomUUID()}@example.com`);
    const repository = new CartWishlistRepository();

    const cartA = await repository.createCartIfMissing({
      customerUserId: customerA.id,
      currency: "PKR",
    });
    const cartB = await repository.createCartIfMissing({
      customerUserId: customerB.id,
      currency: "PKR",
    });
    if (!cartA || !cartB) throw new Error("Module 8 cart fixtures were not created.");

    await expect(
      repository.createCartIfMissing({ customerUserId: customerA.id, currency: "PKR" }),
    ).resolves.toBeNull();

    await expect(
      repository.createCartItemForCustomer({
        customerUserId: randomUUID(),
        variantId: fixture.variant.id,
        quantity: 1,
      }),
    ).resolves.toBeNull();

    const itemA = await repository.createCartItemForCustomer({
      customerUserId: customerA.id,
      variantId: fixture.variant.id,
      quantity: 2,
    });
    await repository.createCartItemForCustomer({
      customerUserId: customerB.id,
      variantId: fixture.variant.id,
      quantity: 5,
    });
    if (!itemA) throw new Error("Module 8 cart item fixture was not created.");

    await expect(repository.listCartItemsForCustomer(customerA.id)).resolves.toEqual([
      expect.objectContaining({ id: itemA.id, quantity: 2 }),
    ]);
    await expect(
      repository.findCartItemByIdForCustomer(itemA.id, customerB.id),
    ).resolves.toBeNull();
    await expect(
      repository.updateCartItemQuantityForCustomer(itemA.id, customerB.id, 9),
    ).resolves.toBeNull();
    await expect(
      repository.updateCartItemQuantityForCustomer(itemA.id, customerA.id, 3),
    ).resolves.toMatchObject({ id: itemA.id, quantity: 3 });
    await expect(
      repository.deleteCartItemForCustomer(itemA.id, customerB.id),
    ).resolves.toBeNull();
    await expect(
      repository.findCartItemByVariantForCustomer(fixture.variant.id, customerA.id),
    ).resolves.toMatchObject({ id: itemA.id, quantity: 3 });

    const deletedB = await repository.deleteAllCartItemsForCustomer(customerB.id);
    expect(deletedB).toHaveLength(1);
    await expect(repository.listCartItemsForCustomer(customerA.id)).resolves.toHaveLength(1);
  });

  it("keeps wishlist reads and deletes inside the customer's default wishlist", async () => {
    const admin = await createPlatformAdmin(`module8-wishlist-admin-${randomUUID()}@example.com`);
    const adminToken = await loginUser(admin);
    const fixture = await createCartWishlistVariantFixture(adminToken, "WishlistScope");
    const customerA = await registerCustomer(`module8-wishlist-a-${randomUUID()}@example.com`);
    const customerB = await registerCustomer(`module8-wishlist-b-${randomUUID()}@example.com`);
    const repository = new CartWishlistRepository();

    const wishlistA = await repository.createDefaultWishlistIfMissing({
      customerUserId: customerA.id,
      name: "My Wishlist",
    });
    const wishlistB = await repository.createDefaultWishlistIfMissing({
      customerUserId: customerB.id,
      name: "My Wishlist",
    });
    if (!wishlistA || !wishlistB) {
      throw new Error("Module 8 wishlist fixtures were not created.");
    }

    await expect(
      repository.createDefaultWishlistIfMissing({
        customerUserId: customerA.id,
        name: "Another Default",
      }),
    ).resolves.toBeNull();

    await expect(
      repository.createWishlistItemForCustomer({
        customerUserId: randomUUID(),
        productId: fixture.productId,
      }),
    ).resolves.toBeNull();

    const productOnlyItem = await repository.createWishlistItemForCustomer({
      customerUserId: customerA.id,
      productId: fixture.productId,
    });
    const variantItem = await repository.createWishlistItemForCustomer({
      customerUserId: customerA.id,
      productId: fixture.productId,
      variantId: fixture.variant.id,
    });
    await repository.createWishlistItemForCustomer({
      customerUserId: customerB.id,
      productId: fixture.productId,
    });
    if (!productOnlyItem || !variantItem) {
      throw new Error("Module 8 wishlist item fixtures were not created.");
    }

    await expect(repository.listWishlistItemsForCustomer(customerA.id)).resolves.toHaveLength(2);
    await expect(
      repository.findWishlistItemByProductVariantForCustomer(
        customerA.id,
        fixture.productId,
        null,
      ),
    ).resolves.toMatchObject({ id: productOnlyItem.id, variantId: null });
    await expect(
      repository.findWishlistItemByProductVariantForCustomer(
        customerA.id,
        fixture.productId,
        fixture.variant.id,
      ),
    ).resolves.toMatchObject({ id: variantItem.id, variantId: fixture.variant.id });
    await expect(
      repository.deleteWishlistItemForCustomer(variantItem.id, customerB.id),
    ).resolves.toBeNull();
    await expect(
      repository.deleteWishlistItemForCustomer(variantItem.id, customerA.id),
    ).resolves.toMatchObject({ id: variantItem.id });
    await expect(repository.listWishlistItemsForCustomer(customerA.id)).resolves.toEqual([
      expect.objectContaining({ id: productOnlyItem.id }),
    ]);
  });
});

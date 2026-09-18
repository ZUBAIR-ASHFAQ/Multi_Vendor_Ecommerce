import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, databasePool, db } from "../../src/database/db.js";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository.js";
import {
  createCheckoutCustomerAddress,
  createCheckoutShippingMethod,
  createPlatformAdmin,
  createPublishedCartWishlistFixture,
  futureCheckoutExpiry,
  loginUser,
  registerCustomer,
  resetModule10Tables,
} from "./module10.test-helpers.js";

beforeEach(async () => {
  await resetModule10Tables();
});

afterAll(async () => {
  await closeDatabase();
});

/** Returns a valid lowercase SHA-256-shaped value without coupling repository tests to future hashing logic. */
function stateHash(character: string): string {
  return character.repeat(64);
}

describe("Module 10 Checkout repository boundaries", () => {
  it("persists Patch 0004 addresses, store lines, and shipping selections while keeping reads customer-scoped", async () => {
    const admin = await createPlatformAdmin(
      `module10-repo-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const product = await createPublishedCartWishlistFixture(adminToken, "CheckoutRepo", {
      price: "100.00",
    });
    const customerA = await registerCustomer(
      `module10-repo-a-${randomUUID()}@example.com`,
    );
    const customerB = await registerCustomer(
      `module10-repo-b-${randomUUID()}@example.com`,
    );
    const addressA = await createCheckoutCustomerAddress(customerA.id);
    const shippingMethodId = await createCheckoutShippingMethod(
      product.seller.sellerId,
      "PKR",
    );
    const repository = new CheckoutRepository();

    const quote = await repository.createQuote({
      customerUserId: customerA.id,
      shippingAddressId: addressA,
      billingAddressId: addressA,
      couponCode: "SAVE10",
      currency: "PKR",
      subtotal: "100.0000",
      discountTotal: "10.0000",
      taxTotal: "5.0000",
      shippingTotal: "15.0000",
      grandTotal: "110.0000",
      expiresAt: futureCheckoutExpiry(),
      stateHash: stateHash("a"),
    });
    await repository.createQuoteLines(quote.id, [
      {
        variantId: product.variant.id,
        sellerId: product.seller.sellerId,
        storeId: product.seller.storeId,
        qty: 1,
        unitPrice: "100.0000",
        discount: "10.0000",
        tax: "5.0000",
        lineTotal: "95.0000",
      },
    ]);
    await repository.createQuoteShippingSelections(quote.id, [
      {
        sellerId: product.seller.sellerId,
        storeId: product.seller.storeId,
        shippingMethodId,
        shippingMethodCodeSnapshot: "STANDARD",
        shippingMethodNameSnapshot: "Standard shipping",
        amount: "15.0000",
        currency: "PKR",
      },
    ]);

    await expect(repository.findQuoteForCustomer(quote.id, customerA.id)).resolves.toMatchObject({
      id: quote.id,
      customerUserId: customerA.id,
      shippingAddressId: addressA,
      billingAddressId: addressA,
      couponCode: "SAVE10",
      grandTotal: "110.0000",
    });
    await expect(repository.findQuoteForCustomer(quote.id, customerB.id)).resolves.toBeNull();

    await expect(repository.listQuoteLinesForCustomer(quote.id, customerA.id)).resolves.toEqual([
      expect.objectContaining({
        quoteId: quote.id,
        variantId: product.variant.id,
        sellerId: product.seller.sellerId,
        storeId: product.seller.storeId,
        unitPrice: "100.0000",
        lineTotal: "95.0000",
      }),
    ]);
    await expect(repository.listQuoteLinesForCustomer(quote.id, customerB.id)).resolves.toEqual([]);

    await expect(
      repository.listQuoteShippingSelectionsForCustomer(quote.id, customerA.id),
    ).resolves.toEqual([
      expect.objectContaining({
        quoteId: quote.id,
        sellerId: product.seller.sellerId,
        storeId: product.seller.storeId,
        shippingMethodId,
        amount: "15.0000",
        currency: "PKR",
      }),
    ]);
    await expect(
      repository.listQuoteShippingSelectionsForCustomer(quote.id, customerB.id),
    ).resolves.toEqual([]);

    const lockedForOwner = await db.transaction(async (transaction) =>
      new CheckoutRepository(transaction).lockQuoteForCustomer(quote.id, customerA.id),
    );
    expect(lockedForOwner?.id).toBe(quote.id);
    const lockedForOtherCustomer = await db.transaction(async (transaction) =>
      new CheckoutRepository(transaction).lockQuoteForCustomer(quote.id, customerB.id),
    );
    expect(lockedForOtherCustomer).toBeNull();
  });

  it("finds the existing attempt by quote and enforces one attempt per quote", async () => {
    const customer = await registerCustomer(
      `module10-attempt-${randomUUID()}@example.com`,
    );
    const addressId = await createCheckoutCustomerAddress(customer.id);
    const repository = new CheckoutRepository();
    const sharedIdempotencyKey = `checkout-${randomUUID()}`;

    const quote = await repository.createQuote({
      customerUserId: customer.id,
      shippingAddressId: addressId,
      billingAddressId: addressId,
      couponCode: null,
      currency: "PKR",
      subtotal: "0.0000",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      shippingTotal: "0.0000",
      grandTotal: "0.0000",
      expiresAt: futureCheckoutExpiry(),
      stateHash: stateHash("b"),
    });

    const attempt = await repository.createAttempt({
      quoteId: quote.id,
      customerUserId: customer.id,
      status: "confirmed",
      idempotencyKey: sharedIdempotencyKey,
      expiresAt: futureCheckoutExpiry(),
    });

    await expect(
      repository.findAttemptByQuoteForCustomer(quote.id, customer.id),
    ).resolves.toMatchObject({ id: attempt.id, quoteId: quote.id });

    await expect(
      repository.createAttempt({
        quoteId: quote.id,
        customerUserId: customer.id,
        status: "confirmed",
        idempotencyKey: `different-${randomUUID()}`,
        expiresAt: futureCheckoutExpiry(),
      }),
    ).rejects.toThrow();
  });

  it("rejects cross-customer addresses and duplicate store shipping selections in PostgreSQL", async () => {
    const admin = await createPlatformAdmin(
      `module10-constraints-admin-${randomUUID()}@example.com`,
    );
    const adminToken = await loginUser(admin);
    const product = await createPublishedCartWishlistFixture(
      adminToken,
      "CheckoutConstraints",
      { price: "100.00" },
    );
    const customerA = await registerCustomer(
      `module10-constraints-a-${randomUUID()}@example.com`,
    );
    const customerB = await registerCustomer(
      `module10-constraints-b-${randomUUID()}@example.com`,
    );
    const addressA = await createCheckoutCustomerAddress(customerA.id);
    const addressB = await createCheckoutCustomerAddress(customerB.id);
    const shippingMethodId = await createCheckoutShippingMethod(product.seller.sellerId);
    const repository = new CheckoutRepository();

    await expect(
      repository.createQuote({
        customerUserId: customerA.id,
        shippingAddressId: addressB,
        billingAddressId: addressB,
        couponCode: null,
        currency: "PKR",
        subtotal: "0.0000",
        discountTotal: "0.0000",
        taxTotal: "0.0000",
        shippingTotal: "0.0000",
        grandTotal: "0.0000",
        expiresAt: futureCheckoutExpiry(),
        stateHash: stateHash("c"),
      }),
    ).rejects.toThrow();

    const quote = await repository.createQuote({
      customerUserId: customerA.id,
      shippingAddressId: addressA,
      billingAddressId: addressA,
      couponCode: null,
      currency: "PKR",
      subtotal: "100.0000",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      shippingTotal: "15.0000",
      grandTotal: "115.0000",
      expiresAt: futureCheckoutExpiry(),
      stateHash: stateHash("d"),
    });

    await repository.createQuoteShippingSelections(quote.id, [
      {
        sellerId: product.seller.sellerId,
        storeId: product.seller.storeId,
        shippingMethodId,
        shippingMethodCodeSnapshot: "STANDARD",
        shippingMethodNameSnapshot: "Standard shipping",
        amount: "15.0000",
        currency: "PKR",
      },
    ]);

    await expect(
      repository.createQuoteShippingSelections(quote.id, [
        {
          sellerId: product.seller.sellerId,
          storeId: product.seller.storeId,
          shippingMethodId,
          shippingMethodCodeSnapshot: "STANDARD-2",
          shippingMethodNameSnapshot: "Duplicate store selection",
          amount: "15.0000",
          currency: "PKR",
        },
      ]),
    ).rejects.toThrow();
  });

  it("keeps the redundant attempt id/customer index removed while preserving the primary key", async () => {
    const indexes = await databasePool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'checkout_attempts'`,
    );
    const names = indexes.rows.map((row) => row.indexname);

    expect(names).toContain("checkout_attempts_pkey");
    expect(names).toContain("checkout_attempts_quote_uq");
    expect(names).not.toContain("checkout_attempts_id_customer_uq");
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import { ACTOR_TYPE } from "../../src/common/security/security.contract.js";
import type { RequestContext } from "../../src/common/types/request-context.js";
import type { CheckoutQuoteRow } from "../../src/database/schema/checkout.js";
import type { CartResponse } from "../../src/modules/cart-wishlist/cart-wishlist.schema.js";
import {
  CHECKOUT_ERROR_CODE,
  CHECKOUT_PERMISSION,
} from "../../src/modules/checkout/checkout.constants.js";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository.js";
import {
  CheckoutService,
  type CheckoutAdministrationIntegration,
  type CheckoutCustomerIntegration,
  type CheckoutIdempotencyIntegration,
  type CheckoutInventoryReadIntegration,
  type CheckoutProductIntegration,
  type CheckoutPromotionIntegration,
} from "../../src/modules/checkout/checkout.service.js";
import { CUSTOMER_ERROR_CODE } from "../../src/modules/customers/customers.constants.js";
import type { CustomerAddressResponse } from "../../src/modules/customers/customers.schema.js";

/** Builds a customer request context with the exact Checkout permissions needed by service tests. */
function customerContext(
  actorId = randomUUID(),
  permissions = [CHECKOUT_PERMISSION.CREATE_OWN, CHECKOUT_PERMISSION.CONFIRM_OWN],
): RequestContext {
  return {
    requestId: randomUUID(),
    actorId,
    actorType: ACTOR_TYPE.CUSTOMER,
    permissions: new Set(permissions),
    sellerIds: new Set(),
    storeIds: new Set(),
    sellerPermissions: new Map(),
    sessionId: randomUUID(),
  };
}

/** Builds one active customer-owned address with stable state-hash fields. */
function checkoutAddress(customerUserId: string, id = randomUUID()): CustomerAddressResponse {
  const now = "2026-09-12T12:00:00.000Z";
  return {
    id,
    customerUserId,
    label: "Home",
    recipientName: "Checkout Customer",
    phone: "+92 300 1234567",
    line1: "1 Checkout Road",
    line2: null,
    city: "Karachi",
    region: "Sindh",
    postalCode: "74000",
    countryCode: "PK",
    isDefaultShipping: true,
    isDefaultBilling: true,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

/** Builds one current Cart line with no client-authoritative totals. */
function checkoutCart(productId: string, variantId: string, quantity = 2): CartResponse {
  const now = "2026-09-12T12:00:00.000Z";
  return {
    id: randomUUID(),
    currency: "PKR",
    previewSubtotal: "200.00",
    hasUnavailableItems: false,
    updatedAt: now,
    items: [
      {
        id: randomUUID(),
        productId,
        variantId,
        productName: "Checkout Product",
        productSlug: `checkout-${productId}`,
        variantTitle: "Default",
        sku: `SKU-${variantId}`,
        currentUnitPrice: "100.00",
        currency: "PKR",
        quantity,
        previewLineSubtotal: "200.00",
        inStock: true,
        isPurchasable: true,
        addedAt: now,
        updatedAt: now,
      },
    ],
  };
}

/** Creates a narrow Checkout repository double for read-only service tests. */
function repositoryStub(
  overrides: Partial<Record<keyof CheckoutRepository, unknown>>,
): CheckoutRepository {
  return {
    findQuoteForCustomer: vi.fn(),
    listQuoteLinesForCustomer: vi.fn().mockResolvedValue([]),
    listQuoteShippingSelectionsForCustomer: vi.fn().mockResolvedValue([]),
    findAttemptForCustomer: vi.fn(),
    ...overrides,
  } as unknown as CheckoutRepository;
}

/** Builds the minimal persisted quote row used by quote-read service tests. */
function persistedQuote(customerUserId: string, expiresAt: Date): CheckoutQuoteRow {
  return {
    id: randomUUID(),
    customerUserId,
    shippingAddressId: randomUUID(),
    billingAddressId: randomUUID(),
    couponCode: null,
    currency: "PKR",
    subtotal: "100.0000",
    discountTotal: "0.0000",
    taxTotal: "0.0000",
    shippingTotal: "10.0000",
    grandTotal: "110.0000",
    expiresAt,
    stateHash: "a".repeat(64),
    createdAt: new Date("2026-09-12T12:00:00.000Z"),
  };
}

describe("Module 10 Checkout service rules", () => {
  it("maps a non-owned or missing address to CHECKOUT_ADDRESS_INVALID before persistence", async () => {
    const context = customerContext();
    const customers: CheckoutCustomerIntegration = {
      resolveActiveOwnedAddress: vi.fn().mockRejectedValue(
        new AppError({
          code: CUSTOMER_ERROR_CODE.ADDRESS_NOT_FOUND,
          message: "Address not found.",
          statusCode: 404,
        }),
      ),
    };
    const transactionRunner = vi.fn();
    const service = new CheckoutService({ customers, transactionRunner });

    await expect(
      service.createQuote(context, {
        shippingAddressId: randomUUID(),
        shippingSelections: [{ storeId: randomUUID(), shippingMethodId: randomUUID() }],
      }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODE.ADDRESS_INVALID,
      statusCode: 409,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("rejects exact requested quantity when current Inventory is insufficient", async () => {
    const context = customerContext();
    const productId = randomUUID();
    const variantId = randomUUID();
    const address = checkoutAddress(context.actorId!);
    const customers: CheckoutCustomerIntegration = {
      resolveActiveOwnedAddress: vi.fn().mockResolvedValue(address),
    };
    const products: CheckoutProductIntegration = {
      resolveVariantForCheckout: vi.fn().mockResolvedValue({
        productId,
        variantId,
        sellerId: randomUUID(),
        storeId: randomUUID(),
        categoryId: randomUUID(),
        skuSnapshot: "SKU-TEST",
        nameSnapshot: "Test Product",
        variantTitleSnapshot: "Default",
        unitPrice: "100.0000",
        currency: "PKR",
      }),
    };
    const inventory: CheckoutInventoryReadIntegration = {
      getCheckoutAvailability: vi.fn().mockResolvedValue([
        {
          variantId,
          requestedQuantity: 2,
          availableQuantity: 1,
          sufficient: false,
        },
      ]),
    };
    const transactionRunner = vi.fn();
    const service = new CheckoutService({
      customers,
      cart: { getCheckoutCart: vi.fn().mockResolvedValue(checkoutCart(productId, variantId)) },
      products,
      inventory,
      transactionRunner,
    });

    await expect(
      service.createQuote(context, {
        shippingAddressId: address.id,
        shippingSelections: [{ storeId: randomUUID(), shippingMethodId: randomUUID() }],
      }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODE.STOCK_CHANGED,
      statusCode: 409,
    });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it("fails closed when the Cart currency is no longer supported before Promotion persistence is read", async () => {
    const context = customerContext();
    const productId = randomUUID();
    const variantId = randomUUID();
    const storeId = randomUUID();
    const address = checkoutAddress(context.actorId!);
    const promotions: CheckoutPromotionIntegration = {
      calculateCheckoutDiscounts: vi.fn(),
    };
    const administration: CheckoutAdministrationIntegration = {
      isSupportedCurrency: vi.fn().mockResolvedValue(false),
      getDefaultTaxRatePercent: vi.fn().mockResolvedValue("0"),
    };
    const service = new CheckoutService({
      customers: { resolveActiveOwnedAddress: vi.fn().mockResolvedValue(address) },
      cart: { getCheckoutCart: vi.fn().mockResolvedValue(checkoutCart(productId, variantId)) },
      products: {
        resolveVariantForCheckout: vi.fn().mockResolvedValue({
          productId,
          variantId,
          sellerId: randomUUID(),
          storeId,
          categoryId: randomUUID(),
          skuSnapshot: "SKU-TEST",
          nameSnapshot: "Test Product",
          variantTitleSnapshot: "Default",
          unitPrice: "100.0000",
          currency: "PKR",
        }),
      },
      inventory: {
        getCheckoutAvailability: vi.fn().mockResolvedValue([
          {
            variantId,
            requestedQuantity: 2,
            availableQuantity: 10,
            sufficient: true,
          },
        ]),
      },
      promotions,
      administration,
      transactionRunner: vi.fn(),
    });

    await expect(
      service.createQuote(context, {
        shippingAddressId: address.id,
        shippingSelections: [{ storeId, shippingMethodId: randomUUID() }],
      }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODE.PRICE_CHANGED,
      statusCode: 409,
    });
    expect(promotions.calculateCheckoutDiscounts).not.toHaveBeenCalled();
  });

  it("keeps another customer's quote non-enumerating at the service boundary", async () => {
    const repository = repositoryStub({
      findQuoteForCustomer: vi.fn().mockResolvedValue(null),
    });
    const service = new CheckoutService({ repository });

    await expect(
      service.getQuote(customerContext(), randomUUID()),
    ).rejects.toMatchObject({
      code: ERROR_CODE.RESOURCE_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("rejects an expired customer-owned quote before reading quote lines", async () => {
    const customerUserId = randomUUID();
    const quote = persistedQuote(
      customerUserId,
      new Date("2026-09-12T11:59:59.000Z"),
    );
    const listLines = vi.fn();
    const repository = repositoryStub({
      findQuoteForCustomer: vi.fn().mockResolvedValue(quote),
      listQuoteLinesForCustomer: listLines,
    });
    const service = new CheckoutService({
      repository,
      now: () => new Date("2026-09-12T12:00:00.000Z"),
    });

    await expect(
      service.getQuote(customerContext(customerUserId), quote.id),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODE.QUOTE_EXPIRED,
      statusCode: 409,
    });
    expect(listLines).not.toHaveBeenCalled();
  });

  it("replays a completed confirmation without opening another database transaction", async () => {
    const context = customerContext();
    const replay = {
      id: randomUUID(),
      quoteId: randomUUID(),
      orderId: null,
      status: "confirmed",
      expiresAt: "2026-09-12T12:15:00.000Z",
    };
    const idempotency: CheckoutIdempotencyIntegration = {
      begin: vi.fn().mockResolvedValue({
        mode: "replay",
        replay: { statusCode: 200, responseBody: replay },
      }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const transactionRunner = vi.fn();
    const service = new CheckoutService({ idempotency, transactionRunner });

    await expect(
      service.confirmQuote(context, replay.quoteId, "a".repeat(64), "checkout-retry-1"),
    ).resolves.toEqual(replay);
    expect(transactionRunner).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(idempotency.fail).not.toHaveBeenCalled();
  });

  it("validates confirmation state-hash and retry-key input before touching idempotency storage", async () => {
    const idempotency: CheckoutIdempotencyIntegration = {
      begin: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const service = new CheckoutService({ idempotency });

    await expect(
      service.confirmQuote(customerContext(), randomUUID(), "NOT-A-HASH", "   "),
    ).rejects.toMatchObject({
      code: ERROR_CODE.VALIDATION_FAILED,
      statusCode: 422,
    });
    expect(idempotency.begin).not.toHaveBeenCalled();
  });
});

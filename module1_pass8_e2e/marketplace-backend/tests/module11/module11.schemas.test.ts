import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adminOrderListQuerySchema,
  cancelOrderBodySchema,
  createOrderFromCheckoutInputSchema,
  orderCancelHeadersSchema,
  paymentConfirmedBodySchema,
} from "../../src/modules/orders/orders.schema.js";

/** Builds one valid trusted Checkout -> Orders DTO used by focused contract tests. */
function createOrderInput() {
  const sellerId = randomUUID();
  const storeId = randomUUID();

  return {
    checkoutAttemptId: randomUUID(),
    customerUserId: randomUUID(),
    currency: "PKR",
    subtotal: "1000.0000",
    discountTotal: "100.0000",
    taxTotal: "90.0000",
    shippingTotal: "50.0000",
    grandTotal: "1040.0000",
    shippingAddress: {
      sourceAddressId: randomUUID(),
      recipientName: "Checkout Customer",
      phone: "+923001234567",
      line1: "123 Test Street",
      line2: null,
      city: "Karachi",
      region: "Sindh",
      postalCode: "74000",
      countryCode: "pk",
    },
    billingAddress: {
      sourceAddressId: randomUUID(),
      recipientName: "Checkout Customer",
      phone: "+923001234567",
      line1: "123 Test Street",
      line2: null,
      city: "Karachi",
      region: "Sindh",
      postalCode: "74000",
      countryCode: "PK",
    },
    lines: [
      {
        productId: randomUUID(),
        variantId: randomUUID(),
        sellerId,
        storeId,
        inventoryReservationId: randomUUID(),
        skuSnapshot: "SKU-ORDER-1",
        nameSnapshot: "Snapshot Product",
        variantTitleSnapshot: "Default",
        quantity: 2,
        unitPrice: "500.0000",
        discountAllocated: "100.0000",
        taxAllocated: "90.0000",
        lineTotal: "990.0000",
      },
    ],
    shippingSelections: [
      {
        sellerId,
        storeId,
        shippingMethodId: randomUUID(),
        shippingMethodCodeSnapshot: "STANDARD",
        shippingMethodNameSnapshot: "Standard Delivery",
        amount: "50.0000",
        currency: "PKR",
      },
    ],
  };
}

describe("Module 11 Pass 2 Zod contracts", () => {
  it("accepts the frozen same-transaction Checkout -> Orders DTO and normalizes country codes", () => {
    const parsed = createOrderFromCheckoutInputSchema.parse(createOrderInput());

    expect(parsed.shippingAddress.countryCode).toBe("PK");
    expect(parsed.lines[0]?.skuSnapshot).toBe("SKU-ORDER-1");
    expect(parsed.shippingSelections).toHaveLength(1);
  });

  it("rejects a trusted Order DTO when one seller/store group has no matching Shipping selection", () => {
    const input = createOrderInput();
    input.shippingSelections = [];

    expect(() => createOrderFromCheckoutInputSchema.parse(input)).toThrow();
  });

  it("rejects duplicate Inventory reservations because one reservation may back only one Order Item", () => {
    const input = createOrderInput();
    input.lines.push({
      ...input.lines[0]!,
      productId: randomUUID(),
      variantId: randomUUID(),
    });

    expect(() => createOrderFromCheckoutInputSchema.parse(input)).toThrow(
      "Each Inventory reservation may back only one Order Item.",
    );
  });

  it("accepts whole-order cancellation and rejects duplicate Order Item entries in a partial request", () => {
    expect(cancelOrderBodySchema.parse({ reason: " Changed my mind " })).toEqual({
      reason: "Changed my mind",
    });

    const orderItemId = randomUUID();
    expect(() =>
      cancelOrderBodySchema.parse({
        items: [
          { orderItemId, quantity: 1 },
          { orderItemId, quantity: 1 },
        ],
      }),
    ).toThrow("Each Order Item may be cancelled only once per request.");
  });

  it("normalizes the required cancellation Idempotency-Key without accepting an empty key", () => {
    expect(orderCancelHeadersSchema.parse({ "idempotency-key": "  cancel-key  " })).toEqual({
      "idempotency-key": "cancel-key",
    });
    expect(() => orderCancelHeadersSchema.parse({ "idempotency-key": "   " })).toThrow();
  });

  it("accepts only the frozen provider-authoritative Payment-confirmed body", () => {
    const body = {
      paymentId: randomUUID(),
      paymentTransactionId: randomUUID(),
      sourceKey: " payments:evt_123 ",
      currency: "pkr",
      capturedAmount: "1040.0000",
      capturedAt: "2026-09-12T12:34:56.000Z",
    };

    expect(paymentConfirmedBodySchema.parse(body)).toEqual({
      ...body,
      sourceKey: "payments:evt_123",
      currency: "PKR",
    });
  });

  it("keeps admin search allow-listed and rejects an inverted created-at range", () => {
    expect(() =>
      adminOrderListQuerySchema.parse({
        createdFrom: "2026-09-13T00:00:00.000Z",
        createdTo: "2026-09-12T00:00:00.000Z",
      }),
    ).toThrow("createdTo must be on or after createdFrom.");

    expect(() =>
      adminOrderListQuerySchema.parse({
        sort: "grandTotal",
      }),
    ).toThrow();
  });
});

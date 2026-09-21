import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { orderFulfillmentStatusSchema } from "../../src/modules/orders/orders.schema.js";
import {
  SHIPMENT_STATUS,
  SHIPPING_CORE_PATH,
  SHIPPING_ERROR_CODE,
  SHIPPING_METHOD_STATUS,
  SHIPPING_OWNER_TYPE,
  SHIPPING_PATH,
  SHIPPING_PERMISSION,
  SHIPPING_PRICING_TYPE,
} from "../../src/modules/shipping/shipping.constants.js";
import {
  createShipmentBodySchema,
  customerShipmentTrackingResponseSchema,
  sellerShipmentListQuerySchema,
  sellerShipmentResponseSchema,
  shipmentIdempotencyHeadersSchema,
  shipmentStatusSchema,
  shippingBaseRateSchema,
  shippingMethodCoreSchema,
  shippingMethodStatusSchema,
  shippingOptionsQuerySchema,
  shippingOptionsResponseSchema,
  shippingOwnerTypeSchema,
  shippingPricingTypeSchema,
  updateShipmentTrackingBodySchema,
} from "../../src/modules/shipping/shipping.schema.js";

describe("Module 13 Shipping Configuration Core contracts", () => {
  it("keeps the approved owner, flat pricing, lifecycle, and route values exact", () => {
    expect(shippingOwnerTypeSchema.parse(SHIPPING_OWNER_TYPE.PLATFORM)).toBe("platform");
    expect(shippingOwnerTypeSchema.parse(SHIPPING_OWNER_TYPE.SELLER)).toBe("seller");
    expect(shippingPricingTypeSchema.parse(SHIPPING_PRICING_TYPE.FLAT)).toBe("flat");
    expect(shippingMethodStatusSchema.parse(SHIPPING_METHOD_STATUS.ACTIVE)).toBe("active");
    expect(shippingMethodStatusSchema.parse(SHIPPING_METHOD_STATUS.INACTIVE)).toBe("inactive");
    expect(SHIPPING_CORE_PATH.OPTIONS).toBe("/api/v1/checkout/shipping-options");

    expect(() => shippingPricingTypeSchema.parse("weight")).toThrow();
    expect(() => shippingMethodStatusSchema.parse("paused")).toThrow();
  });

  it("keeps base-rate transport exact for the persisted NUMERIC(18,4) boundary", () => {
    expect(shippingBaseRateSchema.parse("0")).toBe("0");
    expect(shippingBaseRateSchema.parse("12.3400")).toBe("12.3400");
    expect(shippingBaseRateSchema.parse("99999999999999.9999")).toBe(
      "99999999999999.9999",
    );

    expect(() => shippingBaseRateSchema.parse("-0.0001")).toThrow();
    expect(() => shippingBaseRateSchema.parse("1.00001")).toThrow();
    expect(() => shippingBaseRateSchema.parse("100000000000000.0000")).toThrow();
    expect(() => shippingBaseRateSchema.parse(12.34)).toThrow();
  });

  it("accepts only the approved persisted Shipping Method shape", () => {
    const method = {
      id: randomUUID(),
      ownerType: "platform",
      sellerId: null,
      code: "CORE-RATE",
      name: "Core Shipping Rate",
      pricingType: "flat",
      baseRate: "15.0000",
      currency: "PKR",
      status: "active",
    } as const;

    expect(shippingMethodCoreSchema.parse(method)).toEqual(method);
    expect(() => shippingMethodCoreSchema.parse({ ...method, currency: "pkr" })).toThrow();
    expect(() => shippingMethodCoreSchema.parse({ ...method, pricingType: "zone" })).toThrow();
  });

  it("keeps the shipping-options query strict and customer input minimal", () => {
    const addressId = randomUUID();
    const variantId = randomUUID();
    expect(shippingOptionsQuerySchema.parse({ addressId })).toEqual({ addressId });
    expect(shippingOptionsQuerySchema.parse({ addressId, variantId, quantity: "2" })).toEqual({
      addressId,
      variantId,
      quantity: 2,
    });
    expect(() => shippingOptionsQuerySchema.parse({ addressId, variantId })).toThrow();
    expect(() => shippingOptionsQuerySchema.parse({ addressId, quantity: "2" })).toThrow();
    expect(() => shippingOptionsQuerySchema.parse({ addressId, sellerId: randomUUID() })).toThrow();
    expect(() => shippingOptionsQuerySchema.parse({})).toThrow();
  });

  it("accepts the approved grouped shipping-options response shape", () => {
    const addressId = randomUUID();
    const sellerId = randomUUID();
    const storeId = randomUUID();
    const methodId = randomUUID();
    const response = {
      addressId,
      currency: "PKR",
      groups: [
        {
          sellerId,
          storeId,
          options: [
            {
              id: methodId,
              code: "standard",
              name: "Standard Shipping",
              pricingType: "flat",
              rate: "12.0000",
              currency: "PKR",
            },
          ],
        },
      ],
    } as const;

    expect(shippingOptionsResponseSchema.parse(response)).toEqual(response);
  });
});

describe("Module 13 Pass 2 fulfillment contracts", () => {
  it("freezes the three Shipment states, seven route identities, permissions, and stable errors", () => {
    expect(shipmentStatusSchema.parse(SHIPMENT_STATUS.CREATED)).toBe("created");
    expect(shipmentStatusSchema.parse(SHIPMENT_STATUS.SHIPPED)).toBe("shipped");
    expect(shipmentStatusSchema.parse(SHIPMENT_STATUS.DELIVERED)).toBe("delivered");
    expect(() => shipmentStatusSchema.parse("cancelled")).toThrow();

    expect(Object.values(SHIPPING_PATH)).toEqual([
      "/api/v1/checkout/shipping-options",
      "/api/v1/seller/shipments",
      "/api/v1/seller/orders/:sellerOrderId/shipments",
      "/api/v1/seller/shipments/:id/tracking",
      "/api/v1/seller/shipments/:id/mark-shipped",
      "/api/v1/seller/shipments/:id/mark-delivered",
      "/api/v1/orders/:orderId/shipments",
    ]);
    expect(Object.values(SHIPPING_PERMISSION)).toEqual([
      "shipping.read_own_order",
      "seller.shipping.read",
      "seller.shipping.manage",
      "admin.shipping.read",
    ]);
    expect(Object.values(SHIPPING_ERROR_CODE)).toEqual([
      "SHIPMENT_NOT_FOUND",
      "SHIPMENT_QUANTITY_INVALID",
      "SHIPMENT_STATUS_INVALID",
      "TRACKING_INVALID",
      "INVENTORY_ISSUE_FAILED",
    ]);
  });

  it("accepts only immutable Shipment item allocations and rejects client authority fields", () => {
    const orderItemId = randomUUID();
    expect(
      createShipmentBodySchema.parse({
        items: [{ orderItemId, quantity: 2 }],
      }),
    ).toEqual({ items: [{ orderItemId, quantity: 2 }] });

    expect(() =>
      createShipmentBodySchema.parse({
        items: [
          { orderItemId, quantity: 1 },
          { orderItemId, quantity: 1 },
        ],
      }),
    ).toThrow("Each Order Item may appear only once in a Shipment request.");

    expect(() =>
      createShipmentBodySchema.parse({
        items: [{ orderItemId, quantity: 1 }],
        status: "shipped",
      }),
    ).toThrow();
    expect(() =>
      createShipmentBodySchema.parse({
        items: [{ orderItemId, quantity: 1 }],
        trackingNo: "client-authority",
      }),
    ).toThrow();
  });

  it("normalizes tracking text while keeping status and timestamps server-owned", () => {
    expect(
      updateShipmentTrackingBodySchema.parse({
        carrier: "  DHL  ",
        trackingNo: "  PK-123  ",
        serviceLevel: "  Express  ",
      }),
    ).toEqual({ carrier: "DHL", trackingNo: "PK-123", serviceLevel: "Express" });

    expect(() =>
      updateShipmentTrackingBodySchema.parse({
        carrier: "DHL",
        trackingNo: "PK-123",
        status: "delivered",
      }),
    ).toThrow();
    expect(() =>
      updateShipmentTrackingBodySchema.parse({ carrier: " ", trackingNo: "PK-123" }),
    ).toThrow();
  });

  it("requires bounded seller-list input without accepting a client seller scope", () => {
    const sellerOrderId = randomUUID();
    expect(
      sellerShipmentListQuerySchema.parse({
        sellerOrderId,
        status: "created",
        page: "2",
        pageSize: "25",
        sort: "shipmentNo",
        order: "asc",
      }),
    ).toEqual({
      sellerOrderId,
      status: "created",
      page: 2,
      pageSize: 25,
      sort: "shipmentNo",
      order: "asc",
    });

    expect(() =>
      sellerShipmentListQuerySchema.parse({ sellerId: randomUUID() }),
    ).toThrow();
    expect(() => sellerShipmentListQuerySchema.parse({ status: "lost" })).toThrow();
  });

  it("requires a non-blank Idempotency-Key for create, ship, and deliver commands", () => {
    expect(
      shipmentIdempotencyHeadersSchema.parse({ "idempotency-key": "  shipping-key-1  " }),
    ).toEqual({ "idempotency-key": "shipping-key-1" });
    expect(() =>
      shipmentIdempotencyHeadersSchema.parse({ "idempotency-key": "   " }),
    ).toThrow();
  });

  it("keeps seller Shipment reads rich while customer tracking hides created/internal metadata", () => {
    const shipmentId = randomUUID();
    const sellerOrderId = randomUUID();
    const orderItemId = randomUUID();
    const historyId = randomUUID();
    const shippedAt = "2026-09-15T00:00:00.000Z";

    const sellerShipment = {
      id: shipmentId,
      sellerOrderId,
      shipmentNo: `SHP-${shipmentId.replaceAll("-", "").toUpperCase()}`,
      carrier: "DHL",
      serviceLevel: null,
      trackingNo: "PK-123",
      status: "shipped",
      shippedAt,
      deliveredAt: null,
      createdAt: "2026-09-14T23:00:00.000Z",
      updatedAt: shippedAt,
      items: [{ orderItemId, quantity: 1 }],
      timeline: [
        {
          id: historyId,
          status: "shipped",
          source: "seller",
          occurredAt: shippedAt,
        },
      ],
    } as const;

    expect(sellerShipmentResponseSchema.parse(sellerShipment)).toEqual(sellerShipment);

    const customerTracking = {
      id: shipmentId,
      shipmentNo: sellerShipment.shipmentNo,
      carrier: "DHL",
      serviceLevel: null,
      trackingNo: "PK-123",
      status: "shipped",
      shippedAt,
      deliveredAt: null,
      items: [{ orderItemId, quantity: 1 }],
      timeline: [{ status: "shipped", occurredAt: shippedAt }],
    } as const;

    expect(customerShipmentTrackingResponseSchema.parse(customerTracking)).toEqual(
      customerTracking,
    );
    expect(() =>
      customerShipmentTrackingResponseSchema.parse({
        ...customerTracking,
        status: "created",
      }),
    ).toThrow();
    expect(() =>
      customerShipmentTrackingResponseSchema.parse({
        ...customerTracking,
        payloadRef: "internal-reference",
      }),
    ).toThrow();
  });

  it("extends the shared Orders fulfillment contract to all three Stage 16 values", () => {
    expect(orderFulfillmentStatusSchema.parse("unfulfilled")).toBe("unfulfilled");
    expect(orderFulfillmentStatusSchema.parse("partially_fulfilled")).toBe(
      "partially_fulfilled",
    );
    expect(orderFulfillmentStatusSchema.parse("fulfilled")).toBe("fulfilled");
    expect(() => orderFulfillmentStatusSchema.parse("delivered")).toThrow();
  });
});

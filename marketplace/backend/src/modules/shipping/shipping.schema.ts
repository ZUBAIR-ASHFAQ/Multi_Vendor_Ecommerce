import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { CART_WISHLIST_LIMITS } from "../cart-wishlist/cart-wishlist.constants.js";
import {
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES,
  SHIPMENT_LIST_SORT_VALUES,
  SHIPMENT_STATUS_VALUES,
  SHIPPING_LIMITS,
  SHIPPING_METHOD_LIMITS,
  SHIPPING_METHOD_STATUS_VALUES,
  SHIPPING_OWNER_TYPE_VALUES,
  SHIPPING_PATTERN,
  SHIPPING_PRICING_TYPE_VALUES,
  SHIPPING_SORT_DIRECTION_VALUES,
} from "./shipping.constants.js";

/** Returns true when a canonical decimal string fits one PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsignedValue.split(".");
  return integerPart.length <= precision - scale && fractionPart.length <= scale;
}

/** Creates one trimmed non-empty string bounded by the persisted/API maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Platform/seller ownership value defined by the Stage 11 shipping_methods table. */
export const shippingOwnerTypeSchema = z.enum(SHIPPING_OWNER_TYPE_VALUES);

/** The only pricing model approved for Shipping Configuration Core. */
export const shippingPricingTypeSchema = z.enum(SHIPPING_PRICING_TYPE_VALUES);

/** Active/inactive lifecycle values approved for Shipping Configuration Core. */
export const shippingMethodStatusSchema = z.enum(SHIPPING_METHOD_STATUS_VALUES);

/** Stage 16 Shipment lifecycle values frozen by Requirements Patch 0008. */
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUS_VALUES);

/** Customer tracking never exposes the internal created/preparation Shipment state. */
export const customerVisibleShipmentStatusSchema = z.enum(
  CUSTOMER_VISIBLE_SHIPMENT_STATUS_VALUES,
);

/** Normalized three-letter currency used by Shipping Configuration Core. */
export const shippingCurrencySchema = z
  .string()
  .length(SHIPPING_METHOD_LIMITS.CURRENCY_LENGTH)
  .regex(SHIPPING_PATTERN.CURRENCY, "Currency must be a normalized three-letter code.");

/** Shipping method code persisted by the Stage 11 database contract. */
export const shippingMethodCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHIPPING_METHOD_LIMITS.CODE_MAX_LENGTH);

/** Shipping method display name persisted by the Stage 11 database contract. */
export const shippingMethodNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHIPPING_METHOD_LIMITS.NAME_MAX_LENGTH);

/** Non-negative NUMERIC(18,4) base rate transported as an exact decimal string. */
export const shippingBaseRateSchema = nonNegativeDecimalStringSchema.refine(
  (value) =>
    decimalFitsNumeric(
      value,
      SHIPPING_METHOD_LIMITS.BASE_RATE_PRECISION,
      SHIPPING_METHOD_LIMITS.BASE_RATE_SCALE,
    ),
  [
    "Shipping base rate must fit NUMERIC(",
    `${SHIPPING_METHOD_LIMITS.BASE_RATE_PRECISION},${SHIPPING_METHOD_LIMITS.BASE_RATE_SCALE})`,
    " without rounding.",
  ].join(""),
);

/** Persisted Shipping Configuration Core row after approved Patch 0003. */
export const shippingMethodCoreSchema = z
  .object({
    id: uuidSchema,
    ownerType: shippingOwnerTypeSchema,
    sellerId: uuidSchema.nullable(),
    code: shippingMethodCodeSchema,
    name: shippingMethodNameSchema,
    pricingType: shippingPricingTypeSchema,
    baseRate: shippingBaseRateSchema,
    currency: shippingCurrencySchema,
    status: shippingMethodStatusSchema,
  })
  .strict();

/** Strict query accepted by GET /api/v1/checkout/shipping-options. */
export const shippingOptionsQuerySchema = z
  .object({
    addressId: uuidSchema,
    variantId: uuidSchema.optional(),
    quantity: z.coerce.number().int().min(1).max(CART_WISHLIST_LIMITS.MAX_ITEM_QUANTITY).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.variantId === undefined) !== (value.quantity === undefined)) {
      context.addIssue({
        code: "custom",
        path: [value.variantId === undefined ? "variantId" : "quantity"],
        message: "Buy Now shipping requires both variantId and quantity.",
      });
    }
  });

/** One customer-safe flat-rate option returned for one server-derived store group. */
export const checkoutShippingOptionSchema = z
  .object({
    id: uuidSchema,
    code: shippingMethodCodeSchema,
    name: shippingMethodNameSchema,
    pricingType: shippingPricingTypeSchema,
    rate: shippingBaseRateSchema,
    currency: shippingCurrencySchema,
  })
  .strict();

/** One seller/store shipment group derived from current Cart Product ownership. */
export const checkoutShippingGroupSchema = z
  .object({
    sellerId: uuidSchema,
    storeId: uuidSchema,
    options: z.array(checkoutShippingOptionSchema),
  })
  .strict();

/** Customer-safe Shipping Configuration Core response consumed by Checkout. */
export const shippingOptionsResponseSchema = z
  .object({
    addressId: uuidSchema,
    currency: shippingCurrencySchema,
    groups: z.array(checkoutShippingGroupSchema),
  })
  .strict();

/** Immutable human-readable Shipment number derived from its UUID. */
export const shipmentNumberSchema = z
  .string()
  .max(SHIPPING_LIMITS.SHIPMENT_NUMBER_MAX_LENGTH)
  .regex(SHIPPING_PATTERN.SHIPMENT_NUMBER, "Invalid Shipment number format.");

/** Shared Seller Order path contract for Shipment creation. */
export const createShipmentParamsSchema = z
  .object({
    sellerOrderId: uuidSchema,
  })
  .strict();

/** Shared Shipment path contract for tracking/shipped/delivered commands. */
export const shipmentIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Shared Customer Order path contract for customer/admin Shipment tracking reads. */
export const orderShipmentsParamsSchema = z
  .object({
    orderId: uuidSchema,
  })
  .strict();

/** One immutable Order Item quantity requested for a new Shipment allocation. */
export const createShipmentItemInputSchema = z
  .object({
    orderItemId: uuidSchema,
    quantity: z.number().int().positive(),
  })
  .strict();

/** Strict Shipment creation body; ownership, status, tracking, and timestamps remain server-derived. */
export const createShipmentBodySchema = z
  .object({
    items: z.array(createShipmentItemInputSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const seenOrderItemIds = new Set<string>();
    value.items.forEach((item, index) => {
      if (seenOrderItemIds.has(item.orderItemId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "orderItemId"],
          message: "Each Order Item may appear only once in a Shipment request.",
        });
      }
      seenOrderItemIds.add(item.orderItemId);
    });
  });

/** Strict tracking update body with normalized values and no lifecycle authority fields. */
export const updateShipmentTrackingBodySchema = z
  .object({
    carrier: nonBlankString(SHIPPING_LIMITS.CARRIER_MAX_LENGTH),
    trackingNo: nonBlankString(SHIPPING_LIMITS.TRACKING_NUMBER_MAX_LENGTH),
    serviceLevel: nonBlankString(SHIPPING_LIMITS.SERVICE_LEVEL_MAX_LENGTH)
      .nullable()
      .optional(),
  })
  .strict();

/** Explicit empty body used by the two Shipment lifecycle command routes. */
export const shipmentLifecycleCommandBodySchema = z.object({}).strict();

/** Required Foundation Idempotency-Key header for create/ship/deliver commands. */
export const shipmentIdempotencyHeadersSchema = z.object({
  "idempotency-key": nonBlankString(SHIPPING_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH),
});

/** Seller Shipment queue query; seller/store scope is always derived from the authenticated actor. */
export const sellerShipmentListQuerySchema = paginationQuerySchema
  .extend({
    sellerOrderId: uuidSchema.optional(),
    status: shipmentStatusSchema.optional(),
    sort: z.enum(SHIPMENT_LIST_SORT_VALUES).default("createdAt"),
    order: z.enum(SHIPPING_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Immutable Shipment Item allocation returned to seller/customer-safe Shipment reads. */
export const shipmentItemResponseSchema = z
  .object({
    orderItemId: uuidSchema,
    quantity: z.number().int().positive(),
  })
  .strict();

/** Seller-safe append-only Shipment timeline row; internal payload references are intentionally omitted. */
export const shipmentStatusHistoryResponseSchema = z
  .object({
    id: uuidSchema,
    status: shipmentStatusSchema,
    source: nonBlankString(SHIPPING_LIMITS.STATUS_HISTORY_SOURCE_MAX_LENGTH),
    occurredAt: isoDateTimeSchema,
  })
  .strict();

/** Customer-safe Shipment timeline row that excludes internal created history/source metadata. */
export const customerShipmentTimelineEntrySchema = z
  .object({
    status: customerVisibleShipmentStatusSchema,
    occurredAt: isoDateTimeSchema,
  })
  .strict();

/** Seller-scoped Shipment projection used by list and mutation responses. */
export const sellerShipmentResponseSchema = z
  .object({
    id: uuidSchema,
    sellerOrderId: uuidSchema,
    shipmentNo: shipmentNumberSchema,
    carrier: nonBlankString(SHIPPING_LIMITS.CARRIER_MAX_LENGTH).nullable(),
    serviceLevel: nonBlankString(SHIPPING_LIMITS.SERVICE_LEVEL_MAX_LENGTH).nullable(),
    trackingNo: nonBlankString(SHIPPING_LIMITS.TRACKING_NUMBER_MAX_LENGTH).nullable(),
    status: shipmentStatusSchema,
    shippedAt: isoDateTimeSchema.nullable(),
    deliveredAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    items: z.array(shipmentItemResponseSchema).min(1),
    timeline: z.array(shipmentStatusHistoryResponseSchema).min(1),
  })
  .strict();

/** Customer/admin-safe tracking projection; created Shipments and internal history metadata are excluded. */
export const customerShipmentTrackingResponseSchema = z
  .object({
    id: uuidSchema,
    shipmentNo: shipmentNumberSchema,
    carrier: nonBlankString(SHIPPING_LIMITS.CARRIER_MAX_LENGTH),
    serviceLevel: nonBlankString(SHIPPING_LIMITS.SERVICE_LEVEL_MAX_LENGTH).nullable(),
    trackingNo: nonBlankString(SHIPPING_LIMITS.TRACKING_NUMBER_MAX_LENGTH),
    status: customerVisibleShipmentStatusSchema,
    shippedAt: isoDateTimeSchema,
    deliveredAt: isoDateTimeSchema.nullable(),
    items: z.array(shipmentItemResponseSchema).min(1),
    timeline: z.array(customerShipmentTimelineEntrySchema).min(1),
  })
  .strict();

/** Seller Shipment queue data; pagination metadata stays in the standard API envelope meta field. */
export const sellerShipmentListDataSchema = z.array(sellerShipmentResponseSchema);

/** Customer/admin Order tracking data contains only customer-safe Shipment projections. */
export const orderShipmentsResponseSchema = z.array(customerShipmentTrackingResponseSchema);

export type ShippingOptionsQuery = z.infer<typeof shippingOptionsQuerySchema>;
export type CheckoutShippingOption = z.infer<typeof checkoutShippingOptionSchema>;
export type CheckoutShippingGroup = z.infer<typeof checkoutShippingGroupSchema>;
export type ShippingOptionsResponse = z.infer<typeof shippingOptionsResponseSchema>;
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentBodySchema>;
export type UpdateShipmentTrackingInput = z.infer<typeof updateShipmentTrackingBodySchema>;
export type SellerShipmentListQuery = z.infer<typeof sellerShipmentListQuerySchema>;
export type SellerShipmentResponse = z.infer<typeof sellerShipmentResponseSchema>;
export type CustomerShipmentTrackingResponse = z.infer<
  typeof customerShipmentTrackingResponseSchema
>;

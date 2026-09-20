import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import {
  isoDateTimeSchema,
  nonNegativeDecimalStringSchema,
  uuidSchema,
} from "../../common/schemas/primitives.schema.js";
import {
  ORDER_FULFILLMENT_STATUS_VALUES,
  ORDER_ITEM_STATUS_VALUES,
  ORDER_LIST_SORT_VALUES,
  ORDER_PAYMENT_STATUS_VALUES,
  ORDER_SORT_DIRECTION_VALUES,
  ORDER_STATUS_VALUES,
  ORDERS_LIMITS,
  SELLER_ORDER_LIST_SORT_VALUES,
  SELLER_ORDER_STATUS_VALUES,
} from "./orders.constants.js";

/** Returns true when one canonical decimal string fits a PostgreSQL NUMERIC precision/scale pair. */
function decimalFitsNumeric(value: string, precision: number, scale: number): boolean {
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  return integerPart.length <= precision - scale && fractionPart.length <= scale;
}

/** Creates one trimmed non-blank string bounded by a persisted/API maximum length. */
function nonBlankString(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/** Exact non-negative NUMERIC(18,4) Order money transported as a decimal string. */
export const orderMoneySchema = nonNegativeDecimalStringSchema.refine(
  (value) =>
    decimalFitsNumeric(value, ORDERS_LIMITS.MONEY_PRECISION, ORDERS_LIMITS.MONEY_SCALE),
  `Order money must fit NUMERIC(${ORDERS_LIMITS.MONEY_PRECISION},${ORDERS_LIMITS.MONEY_SCALE}) without rounding.`,
);

/** ISO-4217-shaped Order currency code; supported-currency membership remains server-owned. */
export const orderCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code");

/** Immutable human-readable Customer Order number derived from its UUID. */
export const orderNumberSchema = z
  .string()
  .regex(/^ORD-[0-9A-F]{32}$/, "Invalid Order number format");

/** Immutable human-readable Seller Order number derived from its UUID. */
export const sellerOrderNumberSchema = z
  .string()
  .regex(/^SOR-[0-9A-F]{32}$/, "Invalid Seller Order number format");

/** Parent Customer Order payment state currently understood by Module 11. */
export const orderPaymentStatusSchema = z.enum(ORDER_PAYMENT_STATUS_VALUES);

/** Parent Customer Order fulfillment state completed by Stage 16 Module 13 Shipping. */
export const orderFulfillmentStatusSchema = z.enum(ORDER_FULFILLMENT_STATUS_VALUES);

/** Parent Customer Order lifecycle state derived by Module 11. */
export const orderStatusSchema = z.enum(ORDER_STATUS_VALUES);

/** Seller Order lifecycle state owned by Module 11. */
export const sellerOrderStatusSchema = z.enum(SELLER_ORDER_STATUS_VALUES);

/** Order Item cancellation state owned by Module 11. */
export const orderItemStatusSchema = z.enum(ORDER_ITEM_STATUS_VALUES);

/** Shared Order path parameter for customer/admin/internal commands. */
export const orderIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Shared Seller Order path parameter for seller detail/accept commands. */
export const sellerOrderIdParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

/** Customer-owned Order list query; customer identity is never accepted from query input. */
export const customerOrderListQuerySchema = paginationQuerySchema
  .extend({
    orderStatus: orderStatusSchema.optional(),
    sort: z.enum(ORDER_LIST_SORT_VALUES).default("createdAt"),
    order: z.enum(ORDER_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Seller Order queue query; seller identity is derived from authenticated seller/store scope. */
export const sellerOrderListQuerySchema = paginationQuerySchema
  .extend({
    storeId: uuidSchema.optional(),
    status: sellerOrderStatusSchema.optional(),
    sort: z.enum(SELLER_ORDER_LIST_SORT_VALUES).default("createdAt"),
    order: z.enum(ORDER_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict();

/** Privileged admin Order search query with allow-listed filters and normalized dates. */
export const adminOrderListQuerySchema = paginationQuerySchema
  .extend({
    orderNo: orderNumberSchema.optional(),
    customerUserId: uuidSchema.optional(),
    sellerId: uuidSchema.optional(),
    storeId: uuidSchema.optional(),
    orderStatus: orderStatusSchema.optional(),
    paymentStatus: orderPaymentStatusSchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    sort: z.enum(ORDER_LIST_SORT_VALUES).default("createdAt"),
    order: z.enum(ORDER_SORT_DIRECTION_VALUES).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      new Date(value.createdFrom).getTime() > new Date(value.createdTo).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["createdTo"],
        message: "createdTo must be on or after createdFrom.",
      });
    }
  });

/** Strict body for the trusted provider-authoritative Payment-confirmed internal command. */
export const paymentConfirmedBodySchema = z
  .object({
    paymentId: uuidSchema,
    paymentTransactionId: uuidSchema,
    sourceKey: nonBlankString(ORDERS_LIMITS.PAYMENT_SOURCE_KEY_MAX_LENGTH),
    currency: orderCurrencySchema,
    capturedAmount: orderMoneySchema,
    capturedAt: isoDateTimeSchema,
  })
  .strict();

/** One incremental Order Item cancellation quantity requested by customer/admin cancellation. */
export const orderCancellationItemInputSchema = z
  .object({
    orderItemId: uuidSchema,
    quantity: z.number().int().positive(),
  })
  .strict();

/** Strict body for customer/admin Order cancellation. Omitted items means cancel all remaining eligible quantity. */
export const cancelOrderBodySchema = z
  .object({
    items: z.array(orderCancellationItemInputSchema).min(1).optional(),
    reason: nonBlankString(ORDERS_LIMITS.CANCELLATION_REASON_MAX_LENGTH).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.items) return;

    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      if (seen.has(item.orderItemId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "orderItemId"],
          message: "Each Order Item may be cancelled only once per request.",
        });
      }
      seen.add(item.orderItemId);
    });
  });

/** Required Idempotency-Key header contract for customer/admin cancellation. */
export const orderCancelHeadersSchema = z.object({
  "idempotency-key": nonBlankString(ORDERS_LIMITS.IDEMPOTENCY_KEY_MAX_LENGTH),
});

/** Strict empty body accepted by Seller Order acceptance. */
export const acceptSellerOrderBodySchema = z.object({}).strict();

/** Immutable Customer address snapshot trusted from final Checkout revalidation. */
export const createOrderAddressSnapshotInputSchema = z
  .object({
    sourceAddressId: uuidSchema,
    recipientName: nonBlankString(ORDERS_LIMITS.RECIPIENT_NAME_MAX_LENGTH),
    phone: nonBlankString(ORDERS_LIMITS.PHONE_MAX_LENGTH),
    line1: nonBlankString(ORDERS_LIMITS.ADDRESS_LINE_MAX_LENGTH),
    line2: nonBlankString(ORDERS_LIMITS.ADDRESS_LINE_MAX_LENGTH).nullable(),
    city: nonBlankString(ORDERS_LIMITS.CITY_MAX_LENGTH),
    region: nonBlankString(ORDERS_LIMITS.REGION_MAX_LENGTH),
    postalCode: nonBlankString(ORDERS_LIMITS.POSTAL_CODE_MAX_LENGTH).nullable(),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(ORDERS_LIMITS.COUNTRY_CODE_LENGTH)
      .regex(/^[A-Z]{2}$/, "Country code must contain two uppercase letters"),
  })
  .strict();

/** One immutable Product/price line passed from authoritative Checkout into Orders. */
export const createOrderFromCheckoutLineInputSchema = z
  .object({
    productId: uuidSchema,
    variantId: uuidSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    inventoryReservationId: uuidSchema,
    skuSnapshot: nonBlankString(ORDERS_LIMITS.SKU_MAX_LENGTH),
    nameSnapshot: nonBlankString(ORDERS_LIMITS.PRODUCT_NAME_MAX_LENGTH),
    variantTitleSnapshot: nonBlankString(ORDERS_LIMITS.VARIANT_TITLE_MAX_LENGTH).nullable(),
    quantity: z.number().int().positive(),
    unitPrice: orderMoneySchema,
    discountAllocated: orderMoneySchema,
    taxAllocated: orderMoneySchema,
    lineTotal: orderMoneySchema,
  })
  .strict();

/** One immutable Shipping selection snapshot passed from authoritative Checkout into Orders. */
export const createOrderFromCheckoutShippingSelectionInputSchema = z
  .object({
    sellerId: uuidSchema,
    storeId: uuidSchema,
    shippingMethodId: uuidSchema,
    shippingMethodCodeSnapshot: nonBlankString(ORDERS_LIMITS.SHIPPING_METHOD_CODE_MAX_LENGTH),
    shippingMethodNameSnapshot: nonBlankString(ORDERS_LIMITS.SHIPPING_METHOD_NAME_MAX_LENGTH),
    amount: orderMoneySchema,
    currency: orderCurrencySchema,
  })
  .strict();

/** Trusted same-transaction DTO passed by Checkout to Orders; controllers never construct this input. */
export const createOrderFromCheckoutInputSchema = z
  .object({
    checkoutAttemptId: uuidSchema,
    customerUserId: uuidSchema,
    currency: orderCurrencySchema,
    subtotal: orderMoneySchema,
    discountTotal: orderMoneySchema,
    taxTotal: orderMoneySchema,
    shippingTotal: orderMoneySchema,
    grandTotal: orderMoneySchema,
    shippingAddress: createOrderAddressSnapshotInputSchema,
    billingAddress: createOrderAddressSnapshotInputSchema,
    lines: z.array(createOrderFromCheckoutLineInputSchema).min(1),
    shippingSelections: z.array(createOrderFromCheckoutShippingSelectionInputSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const reservationIds = new Set<string>();
    const lineStoreKeys = new Set<string>();

    value.lines.forEach((line, index) => {
      if (reservationIds.has(line.inventoryReservationId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "inventoryReservationId"],
          message: "Each Inventory reservation may back only one Order Item.",
        });
      }
      reservationIds.add(line.inventoryReservationId);
      lineStoreKeys.add(`${line.sellerId}:${line.storeId}`);
    });

    const shippingStoreKeys = new Set<string>();
    value.shippingSelections.forEach((selection, index) => {
      const key = `${selection.sellerId}:${selection.storeId}`;
      if (shippingStoreKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["shippingSelections", index, "storeId"],
          message: "Each Seller Order group must have exactly one Shipping selection.",
        });
      }
      shippingStoreKeys.add(key);

      if (selection.currency !== value.currency) {
        context.addIssue({
          code: "custom",
          path: ["shippingSelections", index, "currency"],
          message: "Shipping selection currency must match the Customer Order currency.",
        });
      }
    });

    for (const key of lineStoreKeys) {
      if (!shippingStoreKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["shippingSelections"],
          message: "Every Seller Order group requires one Shipping selection.",
        });
      }
    }

    for (const key of shippingStoreKeys) {
      if (!lineStoreKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["shippingSelections"],
          message: "Shipping selections may reference only Seller Order groups present in lines.",
        });
      }
    }
  });

/** Safe immutable address snapshot returned from Order reads. */
export const orderAddressResponseSchema = z
  .object({
    recipientName: nonBlankString(ORDERS_LIMITS.RECIPIENT_NAME_MAX_LENGTH),
    phone: nonBlankString(ORDERS_LIMITS.PHONE_MAX_LENGTH),
    line1: nonBlankString(ORDERS_LIMITS.ADDRESS_LINE_MAX_LENGTH),
    line2: z.string().max(ORDERS_LIMITS.ADDRESS_LINE_MAX_LENGTH).nullable(),
    city: nonBlankString(ORDERS_LIMITS.CITY_MAX_LENGTH),
    region: nonBlankString(ORDERS_LIMITS.REGION_MAX_LENGTH),
    postalCode: z.string().max(ORDERS_LIMITS.POSTAL_CODE_MAX_LENGTH).nullable(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();

/** Immutable Shipping method snapshot returned with one Seller Order. */
export const orderShippingMethodResponseSchema = z
  .object({
    id: uuidSchema,
    code: nonBlankString(ORDERS_LIMITS.SHIPPING_METHOD_CODE_MAX_LENGTH),
    name: nonBlankString(ORDERS_LIMITS.SHIPPING_METHOD_NAME_MAX_LENGTH),
    amount: orderMoneySchema,
    currency: orderCurrencySchema,
  })
  .strict();

/** Customer/seller-safe immutable Order Item snapshot; Inventory reservation IDs stay private. */
export const orderItemResponseSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    variantId: uuidSchema,
    sku: nonBlankString(ORDERS_LIMITS.SKU_MAX_LENGTH),
    name: nonBlankString(ORDERS_LIMITS.PRODUCT_NAME_MAX_LENGTH),
    variantTitle: z.string().max(ORDERS_LIMITS.VARIANT_TITLE_MAX_LENGTH).nullable(),
    quantity: z.number().int().positive(),
    cancelledQuantity: z.number().int().nonnegative(),
    remainingQuantity: z.number().int().nonnegative(),
    unitPrice: orderMoneySchema,
    discountAllocated: orderMoneySchema,
    taxAllocated: orderMoneySchema,
    lineTotal: orderMoneySchema,
    status: orderItemStatusSchema,
  })
  .strict();

/** Seller Order summary nested inside the customer-facing parent Order detail. */
export const customerSellerOrderResponseSchema = z
  .object({
    id: uuidSchema,
    sellerOrderNo: sellerOrderNumberSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    subtotal: orderMoneySchema,
    discountTotal: orderMoneySchema,
    taxTotal: orderMoneySchema,
    shippingTotal: orderMoneySchema,
    grandTotal: orderMoneySchema,
    status: sellerOrderStatusSchema,
    shippingMethod: orderShippingMethodResponseSchema,
    items: z.array(orderItemResponseSchema),
  })
  .strict();

/** Safe status-history row; replay source keys and internal metadata are deliberately excluded. */
export const orderStatusHistoryResponseSchema = z
  .object({
    id: uuidSchema,
    orderId: uuidSchema.nullable(),
    sellerOrderId: uuidSchema.nullable(),
    fromStatus: z.string().trim().min(1).max(ORDERS_LIMITS.STATUS_MAX_LENGTH).nullable(),
    toStatus: z.string().trim().min(1).max(ORDERS_LIMITS.STATUS_MAX_LENGTH),
    reason: z.string().max(ORDERS_LIMITS.CANCELLATION_REASON_MAX_LENGTH).nullable(),
    changedAt: isoDateTimeSchema,
  })
  .strict();

/** Customer/admin-safe parent Order list row. */
export const customerOrderSummarySchema = z
  .object({
    id: uuidSchema,
    orderNo: orderNumberSchema,
    currency: orderCurrencySchema,
    subtotal: orderMoneySchema,
    discountTotal: orderMoneySchema,
    taxTotal: orderMoneySchema,
    shippingTotal: orderMoneySchema,
    grandTotal: orderMoneySchema,
    paymentStatus: orderPaymentStatusSchema,
    fulfillmentStatus: orderFulfillmentStatusSchema,
    orderStatus: orderStatusSchema,
    placedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Customer-owned parent Order detail with only safe Seller Order, address, and timeline data. */
export const customerOrderDetailSchema = customerOrderSummarySchema.extend({
  shippingAddress: orderAddressResponseSchema,
  billingAddress: orderAddressResponseSchema,
  sellerOrders: z.array(customerSellerOrderResponseSchema),
  statusHistory: z.array(orderStatusHistoryResponseSchema),
});

/** Seller queue row containing only the seller's own fulfillment unit plus safe parent status. */
export const sellerOrderListItemSchema = z
  .object({
    id: uuidSchema,
    sellerOrderNo: sellerOrderNumberSchema,
    sellerId: uuidSchema,
    storeId: uuidSchema,
    orderId: uuidSchema,
    orderNo: orderNumberSchema,
    currency: orderCurrencySchema,
    subtotal: orderMoneySchema,
    discountTotal: orderMoneySchema,
    taxTotal: orderMoneySchema,
    shippingTotal: orderMoneySchema,
    grandTotal: orderMoneySchema,
    status: sellerOrderStatusSchema,
    paymentStatus: orderPaymentStatusSchema,
    fulfillmentStatus: orderFulfillmentStatusSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

/** Seller-scoped detail containing only that Seller Order's items and the shipping address snapshot. */
export const sellerOrderDetailSchema = sellerOrderListItemSchema.extend({
  shippingMethod: orderShippingMethodResponseSchema,
  items: z.array(orderItemResponseSchema),
  shippingAddress: orderAddressResponseSchema,
  statusHistory: z.array(orderStatusHistoryResponseSchema),
});

/** Paginated list data payloads; pagination metadata belongs in the standard envelope meta field. */
export const customerOrderListDataSchema = z.array(customerOrderSummarySchema);
export const sellerOrderListDataSchema = z.array(sellerOrderListItemSchema);
export const adminOrderListDataSchema = z.array(customerOrderSummarySchema);

export type CustomerOrderListQuery = z.infer<typeof customerOrderListQuerySchema>;
export type SellerOrderListQuery = z.infer<typeof sellerOrderListQuerySchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type PaymentConfirmedInput = z.infer<typeof paymentConfirmedBodySchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderBodySchema>;
export type CreateOrderFromCheckoutInput = z.infer<typeof createOrderFromCheckoutInputSchema>;
export type OrderItemResponse = z.infer<typeof orderItemResponseSchema>;
export type CustomerOrderSummary = z.infer<typeof customerOrderSummarySchema>;
export type CustomerOrderDetail = z.infer<typeof customerOrderDetailSchema>;
export type SellerOrderListItem = z.infer<typeof sellerOrderListItemSchema>;
export type SellerOrderDetail = z.infer<typeof sellerOrderDetailSchema>;

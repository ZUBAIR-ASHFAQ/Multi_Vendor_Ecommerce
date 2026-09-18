import { z } from "zod";
import { ORDER_STATUS, SELLER_ORDER_STATUS } from "../orders.constants";

const uuid = z.string().uuid();
const money = z.string().regex(/^\d+(?:\.\d{1,4})?$/);
const isoDateTime = z.string().datetime({ offset: true });
const orderNo = z.string().regex(/^ORD-[0-9A-F]{32}$/);
const sellerOrderNo = z.string().regex(/^SOR-[0-9A-F]{32}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

/** Safe immutable Order Item snapshot returned by customer/seller Order APIs. */
export const orderItemSchema = z.object({
  id: uuid,
  productId: uuid,
  variantId: uuid,
  sku: z.string().min(1),
  name: z.string().min(1),
  variantTitle: z.string().nullable(),
  quantity: z.number().int().positive(),
  cancelledQuantity: z.number().int().nonnegative(),
  remainingQuantity: z.number().int().nonnegative(),
  unitPrice: money,
  discountAllocated: money,
  taxAllocated: money,
  lineTotal: money,
  status: z.enum(["active", "partially_cancelled", "cancelled"]),
});

/** Safe immutable delivery/billing address snapshot returned by Order detail APIs. */
export const orderAddressSchema = z.object({
  recipientName: z.string().min(1),
  phone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().min(1),
  region: z.string().min(1),
  postalCode: z.string().nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});

/** Safe Order status-history row without internal source keys. */
export const orderStatusHistorySchema = z.object({
  id: uuid,
  orderId: uuid.nullable(),
  sellerOrderId: uuid.nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().min(1),
  reason: z.string().nullable(),
  changedAt: isoDateTime,
});

/** Immutable Shipping method snapshot nested in one Seller Order. */
export const orderShippingMethodSchema = z.object({
  id: uuid,
  code: z.string().min(1),
  name: z.string().min(1),
  amount: money,
  currency,
});

/** Customer/admin parent Order list row. */
export const customerOrderSummarySchema = z.object({
  id: uuid,
  orderNo,
  currency,
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  shippingTotal: money,
  grandTotal: money,
  paymentStatus: z.enum(["pending", "captured"]),
  fulfillmentStatus: z.enum(["unfulfilled", "partially_fulfilled", "fulfilled"]),
  orderStatus: z.enum(ORDER_STATUS),
  placedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

/** Seller Order summary nested in a customer-facing parent Order. */
export const customerSellerOrderSchema = z.object({
  id: uuid,
  sellerOrderNo,
  sellerId: uuid,
  storeId: uuid,
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  shippingTotal: money,
  grandTotal: money,
  status: z.enum(SELLER_ORDER_STATUS),
  shippingMethod: orderShippingMethodSchema,
  items: z.array(orderItemSchema),
});

/** Customer-owned Order detail with immutable seller groups, addresses, and status history. */
export const customerOrderDetailSchema = customerOrderSummarySchema.extend({
  shippingAddress: orderAddressSchema,
  billingAddress: orderAddressSchema,
  sellerOrders: z.array(customerSellerOrderSchema),
  statusHistory: z.array(orderStatusHistorySchema),
});

/** Seller queue row containing only the authenticated seller's fulfillment unit. */
export const sellerOrderListItemSchema = z.object({
  id: uuid,
  sellerOrderNo,
  sellerId: uuid,
  storeId: uuid,
  orderId: uuid,
  orderNo,
  subtotal: money,
  discountTotal: money,
  taxTotal: money,
  shippingTotal: money,
  grandTotal: money,
  status: z.enum(SELLER_ORDER_STATUS),
  paymentStatus: z.enum(["pending", "captured"]),
  fulfillmentStatus: z.enum(["unfulfilled", "partially_fulfilled", "fulfilled"]),
  createdAt: isoDateTime,
});

/** Seller-scoped detail with only that Seller Order's items and delivery snapshot. */
export const sellerOrderDetailSchema = sellerOrderListItemSchema.extend({
  shippingMethod: orderShippingMethodSchema,
  items: z.array(orderItemSchema),
  shippingAddress: orderAddressSchema,
  statusHistory: z.array(orderStatusHistorySchema),
});

/** Admin search filters mirror only the documented Module 11 search fields used by the UI. */
export const adminOrdersFilterSchema = z.object({
  orderNo: z.string().trim(),
  customerUserId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || z.string().uuid().safeParse(value).success,
      "Customer ID must be a UUID.",
    ),
  orderStatus: z.enum(ORDER_STATUS).or(z.literal("")),
  paymentStatus: z.enum(["pending", "captured"]).or(z.literal("")),
});

/** One optional partial-cancellation target plus reason; blank target means cancel all eligible remaining quantity. */
export const orderCancellationFormSchema = z.object({
  orderItemId: z.string(),
  quantity: z.string(),
  reason: z.string().trim().max(500),
}).superRefine((value, context) => {
  if (!value.orderItemId && value.quantity) {
    context.addIssue({ code: "custom", path: ["quantity"], message: "Choose an Order Item before entering a quantity." });
  }
  if (value.orderItemId && (!/^\d+$/.test(value.quantity) || Number(value.quantity) < 1)) {
    context.addIssue({ code: "custom", path: ["quantity"], message: "Cancellation quantity must be a positive whole number." });
  }
});

export type CustomerOrderSummary = z.infer<typeof customerOrderSummarySchema>;
export type CustomerOrderDetail = z.infer<typeof customerOrderDetailSchema>;
export type SellerOrderListItem = z.infer<typeof sellerOrderListItemSchema>;
export type SellerOrderDetail = z.infer<typeof sellerOrderDetailSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;

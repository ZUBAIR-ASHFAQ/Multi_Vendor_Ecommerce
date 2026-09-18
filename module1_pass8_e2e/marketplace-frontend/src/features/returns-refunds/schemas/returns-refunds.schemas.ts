import { z } from "zod";
import {
  RETURN_ITEM_CONDITION_VALUES,
  RETURN_ITEM_RESOLUTION_VALUES,
  RETURN_REASON_VALUES,
  RETURN_STATUS_VALUES,
} from "../returns-refunds.constants";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

/** Server-owned Return lifecycle values. */
export const returnStatusSchema = z.enum(RETURN_STATUS_VALUES);

/** Customer-selectable Return reason values. */
export const returnReasonSchema = z.enum(RETURN_REASON_VALUES);

/** Seller/support physical inspection values. */
export const returnItemConditionSchema = z.enum(RETURN_ITEM_CONDITION_VALUES);

/** Server-approved item resolution values. */
export const returnItemResolutionSchema = z.enum(RETURN_ITEM_RESOLUTION_VALUES);

/** Canonical scale-4 money returned by Module 14 APIs. */
export const returnMoneySchema = z.string().regex(/^(?:0|[1-9]\d*)\.\d{4}$/);

/** One persisted Return Item safe for customer/seller/admin views. */
export const returnItemSchema = z.object({
  id: uuid,
  orderItemId: uuid,
  quantity: z.number().int().positive(),
  itemCondition: returnItemConditionSchema.nullable(),
  resolution: returnItemResolutionSchema.nullable(),
  refundAmount: returnMoneySchema,
  restockQty: z.number().int().nonnegative(),
});

/** Append-only Return lifecycle row exposed by the existing Return read responses. */
export const returnStatusHistorySchema = z.object({
  id: uuid,
  fromStatus: returnStatusSchema.nullable(),
  toStatus: returnStatusSchema,
  changedBy: uuid.nullable(),
  reason: z.string().trim().min(1).max(1000).nullable(),
  changedAt: isoDateTime,
});

/** Safe Return Request projection shared by all three list APIs. */
export const returnRequestSchema = z.object({
  id: uuid,
  returnNo: z.string().trim().min(1).max(40),
  orderId: uuid,
  sellerOrderId: uuid,
  customerUserId: uuid,
  status: returnStatusSchema,
  reasonCode: returnReasonSchema,
  requestedAt: isoDateTime,
  approvedAt: isoDateTime.nullable(),
  items: z.array(returnItemSchema),
  history: z.array(returnStatusHistorySchema).optional(),
});

/** Provider-authoritative refund result returned by the privileged refund command. */
export const returnRefundResultSchema = z.object({
  refundId: uuid,
  returnRequestId: uuid,
  orderId: uuid,
  paymentId: uuid,
  amount: returnMoneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  providerRef: z.string().trim().min(1).max(255).nullable(),
});

/** Client-only Return Request form state with per-item maximums derived from delivered quantities. */
export const returnRequestFormSchema = z.object({
  reasonCode: returnReasonSchema.or(z.literal("")),
  items: z.array(z.object({
    orderItemId: uuid,
    label: z.string().min(1),
    maxQuantity: z.number().int().positive(),
    quantity: z.string(),
  })),
}).superRefine((value, context) => {
  if (!value.reasonCode) {
    context.addIssue({ code: "custom", path: ["reasonCode"], message: "Choose a Return reason." });
  }

  let selected = 0;
  value.items.forEach((item, index) => {
    if (!item.quantity.trim()) return;
    selected += 1;
    if (!/^\d+$/.test(item.quantity) || Number(item.quantity) < 1) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "quantity"],
        message: "Return quantity must be a positive whole number.",
      });
      return;
    }
    if (Number(item.quantity) > item.maxQuantity) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "quantity"],
        message: `Return quantity cannot exceed ${item.maxQuantity}.`,
      });
    }
  });

  if (selected === 0) {
    context.addIssue({ code: "custom", path: ["items"], message: "Enter a quantity for at least one delivered item." });
  }
});

/** Optional seller approval note. */
export const approveReturnFormSchema = z.object({
  note: z.string().trim().max(1000),
});

/** Seller rejection requires an explicit reason. */
export const rejectReturnFormSchema = z.object({
  reason: z.string().trim().min(1, "Enter a rejection reason.").max(1000),
});

/** Client-only inspection form requires a condition and resolution for every Return Item. */
export const receiveReturnFormSchema = z.object({
  items: z.array(z.object({
    returnItemId: uuid,
    label: z.string().min(1),
    itemCondition: returnItemConditionSchema.or(z.literal("")),
    resolution: returnItemResolutionSchema.or(z.literal("")),
  })).min(1),
  note: z.string().trim().max(1000),
}).superRefine((value, context) => {
  value.items.forEach((item, index) => {
    if (!item.itemCondition) {
      context.addIssue({ code: "custom", path: ["items", index, "itemCondition"], message: "Choose an item condition." });
    }
    if (!item.resolution) {
      context.addIssue({ code: "custom", path: ["items", index, "resolution"], message: "Choose a resolution." });
    }
  });
});

/** Optional admin/support note for the idempotent provider refund command. */
export const returnRefundFormSchema = z.object({
  note: z.string().trim().max(1000),
});

export type ReturnRequest = z.infer<typeof returnRequestSchema>;
export type ReturnStatusHistory = z.infer<typeof returnStatusHistorySchema>;
export type ReturnRefundResult = z.infer<typeof returnRefundResultSchema>;

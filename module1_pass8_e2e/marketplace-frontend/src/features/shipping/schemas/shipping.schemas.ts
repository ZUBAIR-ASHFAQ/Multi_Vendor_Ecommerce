import { z } from "zod";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

/** Server-owned Shipment lifecycle values. */
export const shipmentStatusSchema = z.enum(["created", "shipped", "delivered"]);

/** Customer-visible Shipment states intentionally exclude the internal created state. */
export const customerShipmentStatusSchema = z.enum(["shipped", "delivered"]);

/** Immutable Order Item quantity allocated to one Shipment. */
export const shipmentItemSchema = z.object({
  orderItemId: uuid,
  quantity: z.number().int().positive(),
});

/** Seller-safe append-only Shipment timeline entry. */
export const sellerShipmentTimelineEntrySchema = z.object({
  id: uuid,
  status: shipmentStatusSchema,
  source: z.string().min(1),
  occurredAt: isoDateTime,
});

/** Customer-safe timeline entry without internal event source metadata. */
export const customerShipmentTimelineEntrySchema = z.object({
  status: customerShipmentStatusSchema,
  occurredAt: isoDateTime,
});

/** Seller-facing Shipment projection returned by list and command endpoints. */
export const sellerShipmentSchema = z.object({
  id: uuid,
  sellerOrderId: uuid,
  shipmentNo: z.string().regex(/^SHP-[0-9A-F]{32}$/),
  carrier: z.string().min(1).nullable(),
  serviceLevel: z.string().min(1).nullable(),
  trackingNo: z.string().min(1).nullable(),
  status: shipmentStatusSchema,
  shippedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  items: z.array(shipmentItemSchema).min(1),
  timeline: z.array(sellerShipmentTimelineEntrySchema).min(1),
});

/** Customer/admin tracking projection returned only after a Shipment is shipped. */
export const customerShipmentTrackingSchema = z.object({
  id: uuid,
  shipmentNo: z.string().regex(/^SHP-[0-9A-F]{32}$/),
  carrier: z.string().min(1),
  serviceLevel: z.string().min(1).nullable(),
  trackingNo: z.string().min(1),
  status: customerShipmentStatusSchema,
  shippedAt: isoDateTime,
  deliveredAt: isoDateTime.nullable(),
  items: z.array(shipmentItemSchema).min(1),
  timeline: z.array(customerShipmentTimelineEntrySchema).min(1),
});

/** Frontend creation form keeps blank quantities editable but requires at least one positive allocation before submit. */
export const createShipmentFormSchema = z
  .object({
    items: z.array(
      z.object({
        orderItemId: uuid,
        label: z.string().min(1),
        maxQuantity: z.number().int().nonnegative(),
        quantity: z.string(),
      }),
    ),
  })
  .superRefine((value, context) => {
    let selectedCount = 0;

    value.items.forEach((item, index) => {
      if (!item.quantity.trim()) return;
      selectedCount += 1;

      if (!/^\d+$/.test(item.quantity)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "quantity"],
          message: "Quantity must be a positive whole number.",
        });
        return;
      }

      const quantity = Number(item.quantity);
      if (quantity < 1 || quantity > item.maxQuantity) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "quantity"],
          message: `Quantity must be between 1 and ${item.maxQuantity}.`,
        });
      }
    });

    if (selectedCount === 0) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Enter a quantity for at least one Order Item.",
      });
    }
  });

/** Tracking form mirrors the strict backend body and never accepts status or timestamps. */
export const shipmentTrackingFormSchema = z.object({
  carrier: z.string().trim().min(1, "Carrier is required.").max(120),
  trackingNo: z.string().trim().min(1, "Tracking number is required.").max(200),
  serviceLevel: z.string().trim().max(120),
});

export type SellerShipment = z.infer<typeof sellerShipmentSchema>;
export type CustomerShipmentTracking = z.infer<typeof customerShipmentTrackingSchema>;

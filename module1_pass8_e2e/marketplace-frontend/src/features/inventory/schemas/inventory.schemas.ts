import { z } from "zod";
import { isoDateTimeSchema, pageSchema, pageSizeSchema, uuidSchema } from "@/schemas/common.schema";

export const INVENTORY_MAX_QUANTITY = 2_147_483_647;

/** Validates a non-negative PostgreSQL INTEGER stock quantity. */
export const inventoryNonNegativeQuantitySchema = z
  .number()
  .int()
  .min(0)
  .max(INVENTORY_MAX_QUANTITY);

/** Mirrors the seller Inventory list query supported by Module 7. */
export const sellerInventoryListParamsSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  storeId: z.union([uuidSchema, z.literal("")]).optional(),
  lowStock: z.boolean().optional(),
});

/** Mirrors the bounded stock movement history query supported by Module 7. */
export const stockMovementListParamsSchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
});

/** Validates the seller stock-adjustment form before the API request is sent. */
export const inventoryAdjustmentFormSchema = z.object({
  quantityDelta: z
    .string()
    .trim()
    .regex(/^-?\d+$/, "Enter a whole number.")
    .refine((value) => {
      const number = Number(value);
      return number !== 0 && number >= -INVENTORY_MAX_QUANTITY && number <= INVENTORY_MAX_QUANTITY;
    }, "Quantity adjustment must be a non-zero PostgreSQL INTEGER."),
});

/** Validates the seller reorder-level form; blank disables the threshold. */
export const inventoryReorderLevelFormSchema = z.object({
  reorderLevel: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+$/.test(value), "Enter a whole number or leave blank.")
    .refine((value) => value === "" || Number(value) <= INVENTORY_MAX_QUANTITY, "Reorder level is too large."),
});

/** Seller-safe Inventory state returned by the backend. */
export const inventoryItemSchema = z.object({
  id: uuidSchema,
  sellerId: uuidSchema,
  storeId: uuidSchema,
  variantId: uuidSchema,
  onHandQty: inventoryNonNegativeQuantitySchema,
  reservedQty: inventoryNonNegativeQuantitySchema,
  availableQty: inventoryNonNegativeQuantitySchema,
  reorderLevel: inventoryNonNegativeQuantitySchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/** Immutable stock movement row returned by the backend. */
export const stockMovementSchema = z.object({
  id: uuidSchema,
  inventoryItemId: uuidSchema,
  movementType: z.enum(["adjustment", "reserve", "release", "ship", "restock"]),
  quantityDelta: z.number().int(),
  sourceType: z.string().trim().min(1),
  sourceId: uuidSchema.nullable(),
  occurredAt: isoDateTimeSchema,
  actorUserId: uuidSchema.nullable(),
});

export type SellerInventoryListParams = z.infer<typeof sellerInventoryListParamsSchema>;
export type StockMovementListParams = z.infer<typeof stockMovementListParamsSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type StockMovement = z.infer<typeof stockMovementSchema>;

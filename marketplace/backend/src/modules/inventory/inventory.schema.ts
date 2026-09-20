import { z } from "zod";
import { paginationQuerySchema } from "../../common/schemas/pagination.schema.js";
import { isoDateTimeSchema, uuidSchema } from "../../common/schemas/primitives.schema.js";
import {
  INVENTORY_LIMITS,
  STOCK_MOVEMENT_TYPE_VALUES,
  STOCK_RESERVATION_STATUS_VALUES,
} from "./inventory.constants.js";

/** Non-negative PostgreSQL INTEGER quantity used for stock balances and thresholds. */
export const inventoryNonNegativeQuantitySchema = z
  .number()
  .int()
  .min(0)
  .max(INVENTORY_LIMITS.MAX_QUANTITY);

/** Positive PostgreSQL INTEGER quantity used for reservations and shipment issues. */
export const inventoryPositiveQuantitySchema = z
  .number()
  .int()
  .min(1)
  .max(INVENTORY_LIMITS.MAX_QUANTITY);

/** Non-zero signed PostgreSQL INTEGER quantity used for controlled stock adjustments. */
export const inventoryQuantityDeltaSchema = z
  .number()
  .int()
  .min(-INVENTORY_LIMITS.MAX_QUANTITY)
  .max(INVENTORY_LIMITS.MAX_QUANTITY)
  .refine((value) => value !== 0, "Quantity delta must not be zero.");

/** Trimmed idempotency/source key persisted by stock commands. */
export const inventorySourceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(INVENTORY_LIMITS.SOURCE_KEY_MAX_LENGTH);

/** Inventory movement category returned by movement-history reads. */
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPE_VALUES);

/** Inventory reservation lifecycle state returned by internal stock commands. */
export const stockReservationStatusSchema = z.enum(STOCK_RESERVATION_STATUS_VALUES);

/** Variant path parameter shared by seller Inventory reads and writes. */
export const inventoryVariantParamsSchema = z
  .object({
    variantId: uuidSchema,
  })
  .strict();

/** Query-string boolean that treats only the literal value "true" as true and "false" as false. */
const inventoryBooleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Seller inventory-list query; seller/store ownership is still derived and enforced server-side. */
export const sellerInventoryListQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().min(1).max(200).optional(),
    storeId: uuidSchema.optional(),
    variantId: uuidSchema.optional(),
    lowStock: inventoryBooleanQuerySchema.optional(),
  })
  .strict();

/** Bounded seller movement-history query for one owned Product variant. */
export const stockMovementListQuerySchema = paginationQuerySchema.strict();

/** Controlled manual adjustment body; current stock and resulting balances are always server-derived. */
export const adjustStockBodySchema = z
  .object({
    quantityDelta: inventoryQuantityDeltaSchema,
  })
  .strict();

/** Reorder-threshold body; null explicitly disables the low-stock threshold. */
export const updateReorderLevelBodySchema = z
  .object({
    reorderLevel: inventoryNonNegativeQuantitySchema.nullable(),
  })
  .strict();

/** Internal reservation command used by Checkout/Order workflows, never by an ordinary seller/customer route. */
export const reserveStockBodySchema = z
  .object({
    variantId: uuidSchema,
    customerUserId: uuidSchema,
    orderAttemptId: uuidSchema.nullable().optional(),
    quantity: inventoryPositiveQuantitySchema,
    expiresAt: isoDateTimeSchema,
    sourceKey: inventorySourceKeySchema,
  })
  .strict();

/** Internal reservation-commit command used after an authoritative order/payment transition. */
export const commitStockReservationBodySchema = z
  .object({
    reservationId: uuidSchema,
  })
  .strict();

/** Internal idempotent release command for abandoned, failed, cancelled, or expired reservations. */
export const releaseStockBodySchema = z
  .object({
    reservationId: uuidSchema,
    sourceKey: inventorySourceKeySchema,
  })
  .strict();

/** Internal fulfillment command that consumes reserved quantity and attributes the issue to a shipment/source UUID. */
export const shipStockBodySchema = z
  .object({
    reservationId: uuidSchema,
    quantity: inventoryPositiveQuantitySchema,
    sourceId: uuidSchema,
    sourceKey: inventorySourceKeySchema,
  })
  .strict();

/** Seller/admin-safe Inventory state; availableQty is calculated as onHandQty - reservedQty. */
export const inventoryItemResponseSchema = z
  .object({
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
  })
  .strict();

/** Immutable seller/admin-safe stock movement history row. */
export const stockMovementResponseSchema = z
  .object({
    id: uuidSchema,
    inventoryItemId: uuidSchema,
    movementType: stockMovementTypeSchema,
    quantityDelta: inventoryQuantityDeltaSchema,
    sourceType: z.string().trim().min(1).max(INVENTORY_LIMITS.SOURCE_TYPE_MAX_LENGTH),
    sourceId: uuidSchema.nullable(),
    occurredAt: isoDateTimeSchema,
    actorUserId: uuidSchema.nullable(),
  })
  .strict();

/** Internal-safe reservation state returned to trusted commerce/fulfillment callers. */
export const stockReservationResponseSchema = z
  .object({
    id: uuidSchema,
    variantId: uuidSchema,
    customerUserId: uuidSchema,
    orderAttemptId: uuidSchema.nullable(),
    quantity: inventoryPositiveQuantitySchema,
    consumedQuantity: inventoryNonNegativeQuantitySchema,
    remainingQuantity: inventoryNonNegativeQuantitySchema,
    status: stockReservationStatusSchema,
    expiresAt: isoDateTimeSchema,
    sourceKey: inventorySourceKeySchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Seller Inventory-list row enriched with Product/variant/Store display context. */
export const sellerInventoryListItemResponseSchema = inventoryItemResponseSchema.extend({
  productId: uuidSchema,
  productName: z.string().trim().min(1),
  productSlug: z.string().trim().min(1),
  variantSku: z.string().trim().min(1),
  variantTitle: z.string().trim().min(1),
  variantStatus: z.enum(["active", "inactive"]),
  variantPrice: z.string().trim().regex(/^\d+(?:\.\d+)?$/),
  variantCurrency: z.string().trim().regex(/^[A-Z]{3}$/),
  storeName: z.string().trim().min(1),
});

/** Seller inventory-list response data; pagination metadata belongs in the standard envelope's meta field. */
export const sellerInventoryListDataSchema = z.array(sellerInventoryListItemResponseSchema);

/** Seller movement-history response data; pagination metadata belongs in the standard envelope's meta field. */
export const stockMovementListDataSchema = z.array(stockMovementResponseSchema);

export type SellerInventoryListQuery = z.infer<typeof sellerInventoryListQuerySchema>;
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;
export type AdjustStockInput = z.infer<typeof adjustStockBodySchema>;
export type UpdateReorderLevelInput = z.infer<typeof updateReorderLevelBodySchema>;
export type ReserveStockInput = z.infer<typeof reserveStockBodySchema>;
export type CommitStockReservationInput = z.infer<typeof commitStockReservationBodySchema>;
export type ReleaseStockInput = z.infer<typeof releaseStockBodySchema>;
export type ShipStockInput = z.infer<typeof shipStockBodySchema>;
export type InventoryItemResponse = z.infer<typeof inventoryItemResponseSchema>;
export type SellerInventoryListItemResponse = z.infer<typeof sellerInventoryListItemResponseSchema>;
export type StockMovementResponse = z.infer<typeof stockMovementResponseSchema>;
export type StockReservationResponse = z.infer<typeof stockReservationResponseSchema>;

/** Inventory movement categories persisted by the immutable stock ledger. */
export const STOCK_MOVEMENT_TYPE = {
  ADJUSTMENT: "adjustment",
  RESERVE: "reserve",
  RELEASE: "release",
  SHIP: "ship",
  RESTOCK: "restock",
} as const;

export const STOCK_MOVEMENT_TYPE_VALUES = [
  STOCK_MOVEMENT_TYPE.ADJUSTMENT,
  STOCK_MOVEMENT_TYPE.RESERVE,
  STOCK_MOVEMENT_TYPE.RELEASE,
  STOCK_MOVEMENT_TYPE.SHIP,
  STOCK_MOVEMENT_TYPE.RESTOCK,
] as const;

/** Reservation lifecycle states persisted by Module 7. */
export const STOCK_RESERVATION_STATUS = {
  RESERVED: "reserved",
  COMMITTED: "committed",
  RELEASED: "released",
  CONSUMED: "consumed",
  EXPIRED: "expired",
} as const;

export const STOCK_RESERVATION_STATUS_VALUES = [
  STOCK_RESERVATION_STATUS.RESERVED,
  STOCK_RESERVATION_STATUS.COMMITTED,
  STOCK_RESERVATION_STATUS.RELEASED,
  STOCK_RESERVATION_STATUS.CONSUMED,
  STOCK_RESERVATION_STATUS.EXPIRED,
] as const;

/** Stable permissions named by the controlling Module 7 requirements. */
export const INVENTORY_PERMISSION = {
  READ: "inventory.read",
  ADJUST: "inventory.adjust",
  REORDER_MANAGE: "inventory.reorder.manage",
  ADMIN_READ: "admin.inventory.read",
} as const;

/** Module-owned permission catalog composed into platform RBAC by the application seed. */
export const INVENTORY_PERMISSION_CATALOG = [
  {
    code: INVENTORY_PERMISSION.READ,
    domain: "inventory",
    description: "Read inventory quantities and movement history inside the authenticated seller scope.",
  },
  {
    code: INVENTORY_PERMISSION.ADJUST,
    domain: "inventory",
    description: "Apply controlled stock adjustments inside the authenticated seller scope.",
  },
  {
    code: INVENTORY_PERMISSION.REORDER_MANAGE,
    domain: "inventory",
    description: "Manage seller-scoped low-stock reorder thresholds.",
  },
  {
    code: INVENTORY_PERMISSION.ADMIN_READ,
    domain: "inventory",
    description: "Read marketplace inventory for authorized administration oversight.",
  },
] as const;

/** Stable Module 7 business error codes required by the controlling guide. */
export const INVENTORY_ERROR_CODE = {
  INVENTORY_NOT_FOUND: "INVENTORY_NOT_FOUND",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  STOCK_ADJUSTMENT_INVALID: "STOCK_ADJUSTMENT_INVALID",
  DUPLICATE_STOCK_SOURCE: "DUPLICATE_STOCK_SOURCE",
  STOCK_RESERVATION_NOT_FOUND: "STOCK_RESERVATION_NOT_FOUND",
  STOCK_RESERVATION_STATUS_INVALID: "STOCK_RESERVATION_STATUS_INVALID",
  STOCK_RESERVATION_EXPIRED: "STOCK_RESERVATION_EXPIRED",
} as const;

/** Durable Inventory events named by the controlling guide. */
export const INVENTORY_OUTBOX_EVENT = {
  ADJUSTED: "inventory.adjusted",
  RESERVED: "inventory.reserved",
  RESERVATION_RELEASED: "inventory.reservation_released",
  SHIPPED: "inventory.shipped",
  RESTOCKED: "inventory.restocked",
  LOW_STOCK: "inventory.low_stock",
} as const;


/** Stable source categories stored on immutable stock-movement rows. */
export const INVENTORY_SOURCE_TYPE = {
  SELLER_ADJUSTMENT: "seller_adjustment",
  RESERVATION: "reservation",
  RESERVATION_RELEASE: "reservation_release",
  SHIPMENT: "shipment",
  RETURN: "return",
} as const;

/** Stable resource names for Inventory audit/outbox metadata. */
export const INVENTORY_RESOURCE_TYPE = {
  INVENTORY_ITEM: "inventory.item",
  STOCK_MOVEMENT: "inventory.stock_movement",
  STOCK_RESERVATION: "inventory.stock_reservation",
} as const;

/** Concise audit actions for privileged or manual Inventory writes. */
export const INVENTORY_AUDIT_ACTION = {
  ADJUSTED: "inventory.adjusted",
  REORDER_LEVEL_UPDATED: "inventory.reorder_level_updated",
  RESERVED: "inventory.reserved",
  RESERVATION_RELEASED: "inventory.reservation_released",
  RESERVATION_COMMITTED: "inventory.reservation_committed",
  SHIPPED: "inventory.shipped",
  RESTOCKED: "inventory.restocked",
} as const;

/** Database-aligned text and integer limits shared by Module 7 contracts. */
export const INVENTORY_LIMITS = {
  SOURCE_KEY_MAX_LENGTH: 200,
  SOURCE_TYPE_MAX_LENGTH: 40,
  MAX_QUANTITY: 2_147_483_647,
} as const;

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";
import { customerProfiles } from "./customers.js";
import { orderItems, orders, sellerOrders } from "./orders.js";
import { payments } from "./payments.js";

/** Stores one customer Return Request scoped to one parent Order and Seller Order. */
export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnNo: varchar("return_no", { length: 40 }).notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    sellerOrderId: uuid("seller_order_id").notNull(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    status: varchar("status", { length: 40 }).notNull(),
    reasonCode: varchar("reason_code", { length: 80 }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [table.sellerOrderId, table.orderId],
      foreignColumns: [sellerOrders.id, sellerOrders.orderId],
      name: "return_requests_seller_order_parent_fk",
    }).onDelete("restrict"),
    uniqueIndex("return_requests_return_no_uq").on(table.returnNo),
    index("return_requests_customer_status_requested_idx").on(
      table.customerUserId,
      table.status,
      table.requestedAt,
    ),
    index("return_requests_seller_order_status_requested_idx").on(
      table.sellerOrderId,
      table.status,
      table.requestedAt,
    ),
    index("return_requests_order_requested_idx").on(table.orderId, table.requestedAt),
    check(
      "return_requests_return_no_not_blank_check",
      sql`length(btrim(${table.returnNo})) > 0`,
    ),
    check(
      "return_requests_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "return_requests_reason_code_normalized_check",
      sql`${table.reasonCode} = lower(btrim(${table.reasonCode})) and length(${table.reasonCode}) > 0`,
    ),
    check(
      "return_requests_approved_at_check",
      sql`${table.approvedAt} is null or ${table.approvedAt} >= ${table.requestedAt}`,
    ),
  ],
);

/** Stores one requested Order Item quantity plus its later inspection/refund/restock result. */
export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnRequestId: uuid("return_request_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    itemCondition: varchar("item_condition", { length: 40 }),
    resolution: varchar("resolution", { length: 60 }),
    refundAmount: numeric("refund_amount", { precision: 18, scale: 4 })
      .notNull()
      .default("0"),
    restockQty: integer("restock_qty").notNull().default(0),
  },
  (table) => [
    uniqueIndex("return_items_request_order_item_uq").on(
      table.returnRequestId,
      table.orderItemId,
    ),
    index("return_items_order_item_idx").on(table.orderItemId),
    check("return_items_quantity_positive_check", sql`${table.quantity} > 0`),
    check("return_items_refund_amount_nonnegative_check", sql`${table.refundAmount} >= 0`),
    check("return_items_restock_qty_nonnegative_check", sql`${table.restockQty} >= 0`),
    check(
      "return_items_restock_qty_not_over_quantity_check",
      sql`${table.restockQty} <= ${table.quantity}`,
    ),
    check(
      "return_items_condition_normalized_check",
      sql`
        ${table.itemCondition} is null
        or (
          ${table.itemCondition} = lower(btrim(${table.itemCondition}))
          and length(${table.itemCondition}) > 0
        )
      `,
    ),
    check(
      "return_items_resolution_normalized_check",
      sql`${table.resolution} is null or (${table.resolution} = lower(btrim(${table.resolution})) and length(${table.resolution}) > 0)`,
    ),
  ],
);

/** Stores one idempotent business Refund record while Module 12 owns provider money movement. */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnRequestId: uuid("return_request_id").references(() => returnRequests.id, {
      onDelete: "restrict",
    }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    providerRef: varchar("provider_ref", { length: 255 }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("refunds_idempotency_key_uq").on(table.idempotencyKey),
    index("refunds_return_request_created_idx").on(table.returnRequestId, table.createdAt),
    index("refunds_order_created_idx").on(table.orderId, table.createdAt),
    index("refunds_payment_status_created_idx").on(
      table.paymentId,
      table.status,
      table.createdAt,
    ),
    check("refunds_amount_positive_check", sql`${table.amount} > 0`),
    check(
      "refunds_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "refunds_status_normalized_check",
      sql`${table.status} = lower(btrim(${table.status})) and length(${table.status}) > 0`,
    ),
    check(
      "refunds_provider_ref_not_blank_check",
      sql`${table.providerRef} is null or length(btrim(${table.providerRef})) > 0`,
    ),
    check(
      "refunds_idempotency_key_not_blank_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`,
    ),
  ],
);

/** Stores append-only Return Request lifecycle changes for support and audit reconstruction. */
export const returnStatusHistory = pgTable(
  "return_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnRequestId: uuid("return_request_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "restrict" }),
    fromStatus: varchar("from_status", { length: 40 }),
    toStatus: varchar("to_status", { length: 40 }).notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("return_status_history_request_changed_idx").on(
      table.returnRequestId,
      table.changedAt,
    ),
    index("return_status_history_changed_by_idx").on(table.changedBy),
    check(
      "return_status_history_from_status_normalized_check",
      sql`${table.fromStatus} is null or (${table.fromStatus} = lower(btrim(${table.fromStatus})) and length(${table.fromStatus}) > 0)`,
    ),
    check(
      "return_status_history_to_status_normalized_check",
      sql`${table.toStatus} = lower(btrim(${table.toStatus})) and length(${table.toStatus}) > 0`,
    ),
    check(
      "return_status_history_reason_not_blank_check",
      sql`${table.reason} is null or length(btrim(${table.reason})) > 0`,
    ),
  ],
);

/** Stores support/customer/seller dispute notes without changing the original Order or Return history. */
export const disputeNotes = pgTable(
  "dispute_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnRequestId: uuid("return_request_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    visibility: varchar("visibility", { length: 40 }).notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("dispute_notes_request_created_idx").on(table.returnRequestId, table.createdAt),
    index("dispute_notes_actor_created_idx").on(table.actorUserId, table.createdAt),
    check(
      "dispute_notes_visibility_normalized_check",
      sql`${table.visibility} = lower(btrim(${table.visibility})) and length(${table.visibility}) > 0`,
    ),
    check("dispute_notes_note_not_blank_check", sql`length(btrim(${table.note})) > 0`),
  ],
);

export type ReturnRequestRow = typeof returnRequests.$inferSelect;
export type NewReturnRequestRow = typeof returnRequests.$inferInsert;
export type ReturnItemRow = typeof returnItems.$inferSelect;
export type NewReturnItemRow = typeof returnItems.$inferInsert;
export type RefundRow = typeof refunds.$inferSelect;
export type NewRefundRow = typeof refunds.$inferInsert;
export type ReturnStatusHistoryRow = typeof returnStatusHistory.$inferSelect;
export type NewReturnStatusHistoryRow = typeof returnStatusHistory.$inferInsert;

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./administration.js";
import { customerProfiles } from "./customers.js";
import { orderItems } from "./orders.js";
import { products } from "./products.js";
import { sellers, stores } from "./sellers.js";

/** Stores one verified customer Review for one purchased Order Item. */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").notNull(),
    rating: integer("rating").notNull(),
    title: varchar("title", { length: 200 }),
    body: text("body"),
    status: varchar("status", { length: 20 })
      .$type<"pending" | "published" | "hidden">()
      .notNull()
      .default("pending"),
    verifiedPurchase: boolean("verified_purchase").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.storeId, table.sellerId],
      foreignColumns: [stores.id, stores.sellerId],
      name: "reviews_store_seller_fk",
    }).onDelete("restrict"),
    uniqueIndex("reviews_order_item_uq").on(table.orderItemId),
    index("reviews_product_status_published_idx").on(
      table.productId,
      table.status,
      table.publishedAt,
      table.id,
    ),
    index("reviews_store_status_published_idx").on(
      table.storeId,
      table.status,
      table.publishedAt,
      table.id,
    ),
    index("reviews_seller_status_published_idx").on(
      table.sellerId,
      table.status,
      table.publishedAt,
      table.id,
    ),
    index("reviews_customer_created_idx").on(
      table.customerUserId,
      table.createdAt,
      table.id,
    ),
    index("reviews_status_created_idx").on(table.status, table.createdAt, table.id),
    check("reviews_rating_check", sql`${table.rating} between 1 and 5`),
    check(
      "reviews_status_check",
      sql`${table.status} in ('pending', 'published', 'hidden')`,
    ),
    check(
      "reviews_verified_purchase_check",
      sql`${table.verifiedPurchase} = true`,
    ),
    check(
      "reviews_title_not_blank_check",
      sql`${table.title} is null or length(btrim(${table.title})) > 0`,
    ),
    check(
      "reviews_body_not_blank_check",
      sql`${table.body} is null or length(btrim(${table.body})) > 0`,
    ),
    check(
      "reviews_published_at_state_check",
      sql`${table.status} <> 'published' or ${table.publishedAt} is not null`,
    ),
    check(
      "reviews_published_at_time_check",
      sql`${table.publishedAt} is null or ${table.publishedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Stores one replay-safe Helpful vote per authenticated user and Review. */
export const reviewHelpfulVotes = pgTable(
  "review_helpful_votes",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.reviewId, table.userId],
      name: "review_helpful_votes_pk",
    }),
    index("review_helpful_votes_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

/** Stores append-only administrator moderation decisions for a Review. */
export const reviewModerationHistory = pgTable(
  "review_moderation_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 20 }).notNull(),
    moderatorUserId: uuid("moderator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("review_moderation_history_review_created_idx").on(
      table.reviewId,
      table.createdAt,
    ),
    index("review_moderation_history_moderator_created_idx").on(
      table.moderatorUserId,
      table.createdAt,
    ),
    check(
      "review_moderation_history_action_check",
      sql`${table.action} in ('hide', 'publish')`,
    ),
    check(
      "review_moderation_history_reason_not_blank_check",
      sql`length(btrim(${table.reason})) > 0`,
    ),
  ],
);

/** Stores recalculable published rating summaries for Product and Seller entities. */
export const ratingAggregates = pgTable(
  "rating_aggregates",
  {
    entityType: varchar("entity_type", { length: 20 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    ratingAvg: numeric("rating_avg", { precision: 4, scale: 2 })
      .notNull()
      .default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.entityType, table.entityId],
      name: "rating_aggregates_pk",
    }),
    index("rating_aggregates_rating_idx").on(
      table.entityType,
      table.ratingAvg,
      table.ratingCount,
    ),
    check(
      "rating_aggregates_entity_type_check",
      sql`${table.entityType} in ('product', 'seller')`,
    ),
    check(
      "rating_aggregates_rating_count_check",
      sql`${table.ratingCount} >= 0`,
    ),
    check(
      "rating_aggregates_rating_avg_check",
      sql`${table.ratingAvg} >= 0 and ${table.ratingAvg} <= 5`,
    ),
    check(
      "rating_aggregates_empty_state_check",
      sql`
        (${table.ratingCount} = 0 and ${table.ratingAvg} = 0)
        or (${table.ratingCount} > 0 and ${table.ratingAvg} >= 1 and ${table.ratingAvg} <= 5)
      `,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type NewReviewRow = typeof reviews.$inferInsert;
export type NewReviewHelpfulVoteRow = typeof reviewHelpfulVotes.$inferInsert;
export type ReviewModerationHistoryRow = typeof reviewModerationHistory.$inferSelect;
export type NewReviewModerationHistoryRow = typeof reviewModerationHistory.$inferInsert;
export type RatingAggregateRow = typeof ratingAggregates.$inferSelect;
export type NewRatingAggregateRow = typeof ratingAggregates.$inferInsert;

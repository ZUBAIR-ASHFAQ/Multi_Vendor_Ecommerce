CREATE TABLE "reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "title" varchar(200),
  "body" text,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "verified_purchase" boolean NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviews_rating_check" CHECK ("rating" between 1 and 5),
  CONSTRAINT "reviews_status_check" CHECK ("status" in ('pending', 'published', 'hidden')),
  CONSTRAINT "reviews_verified_purchase_check" CHECK ("verified_purchase" = true),
  CONSTRAINT "reviews_title_not_blank_check" CHECK ("title" is null or length(btrim("title")) > 0),
  CONSTRAINT "reviews_body_not_blank_check" CHECK ("body" is null or length(btrim("body")) > 0),
  CONSTRAINT "reviews_published_at_state_check" CHECK ("status" <> 'published' or "published_at" is not null),
  CONSTRAINT "reviews_published_at_time_check" CHECK ("published_at" is null or "published_at" >= "created_at")
);
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_order_item_id_order_items_id_fk"
  FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_store_seller_fk"
  FOREIGN KEY ("store_id", "seller_id") REFERENCES "public"."stores"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_item_uq"
  ON "reviews" USING btree ("order_item_id");
--> statement-breakpoint
CREATE INDEX "reviews_product_status_published_idx"
  ON "reviews" USING btree ("product_id", "status", "published_at", "id");
--> statement-breakpoint
CREATE INDEX "reviews_store_status_published_idx"
  ON "reviews" USING btree ("store_id", "status", "published_at", "id");
--> statement-breakpoint
CREATE INDEX "reviews_seller_status_published_idx"
  ON "reviews" USING btree ("seller_id", "status", "published_at", "id");
--> statement-breakpoint
CREATE INDEX "reviews_customer_created_idx"
  ON "reviews" USING btree ("customer_user_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "reviews_status_created_idx"
  ON "reviews" USING btree ("status", "created_at", "id");
--> statement-breakpoint

CREATE TABLE "review_helpful_votes" (
  "review_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_helpful_votes_pk" PRIMARY KEY ("review_id", "user_id")
);
--> statement-breakpoint
ALTER TABLE "review_helpful_votes"
  ADD CONSTRAINT "review_helpful_votes_review_id_reviews_id_fk"
  FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_helpful_votes"
  ADD CONSTRAINT "review_helpful_votes_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "review_helpful_votes_user_created_idx"
  ON "review_helpful_votes" USING btree ("user_id", "created_at");
--> statement-breakpoint

CREATE TABLE "review_moderation_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL,
  "action" varchar(20) NOT NULL,
  "moderator_user_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_moderation_history_action_check" CHECK ("action" in ('hide', 'publish')),
  CONSTRAINT "review_moderation_history_reason_not_blank_check" CHECK (length(btrim("reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "review_moderation_history"
  ADD CONSTRAINT "review_moderation_history_review_id_reviews_id_fk"
  FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_moderation_history"
  ADD CONSTRAINT "review_moderation_history_moderator_user_id_users_id_fk"
  FOREIGN KEY ("moderator_user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "review_moderation_history_review_created_idx"
  ON "review_moderation_history" USING btree ("review_id", "created_at");
--> statement-breakpoint
CREATE INDEX "review_moderation_history_moderator_created_idx"
  ON "review_moderation_history" USING btree ("moderator_user_id", "created_at");
--> statement-breakpoint

CREATE TABLE "rating_aggregates" (
  "entity_type" varchar(20) NOT NULL,
  "entity_id" uuid NOT NULL,
  "rating_avg" numeric(4, 2) DEFAULT '0' NOT NULL,
  "rating_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rating_aggregates_pk" PRIMARY KEY ("entity_type", "entity_id"),
  CONSTRAINT "rating_aggregates_entity_type_check" CHECK ("entity_type" in ('product', 'seller')),
  CONSTRAINT "rating_aggregates_rating_count_check" CHECK ("rating_count" >= 0),
  CONSTRAINT "rating_aggregates_rating_avg_check" CHECK ("rating_avg" >= 0 and "rating_avg" <= 5),
  CONSTRAINT "rating_aggregates_empty_state_check" CHECK (
    ("rating_count" = 0 and "rating_avg" = 0)
    or ("rating_count" > 0 and "rating_avg" >= 1 and "rating_avg" <= 5)
  )
);
--> statement-breakpoint
CREATE INDEX "rating_aggregates_rating_idx"
  ON "rating_aggregates" USING btree ("entity_type", "rating_avg", "rating_count");

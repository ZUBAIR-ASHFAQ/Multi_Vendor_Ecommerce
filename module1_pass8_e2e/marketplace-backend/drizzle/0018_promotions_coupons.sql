CREATE TABLE "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" varchar(20) NOT NULL,
  "seller_id" uuid,
  "name" varchar(200) NOT NULL,
  "type" varchar(40) NOT NULL,
  "value" numeric(18, 4) NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "funding_type" varchar(20) NOT NULL,
  CONSTRAINT "promotions_owner_type_check" CHECK ("owner_type" in ('platform', 'seller')),
  CONSTRAINT "promotions_owner_seller_check" CHECK (("owner_type" = 'platform' and "seller_id" is null) or ("owner_type" = 'seller' and "seller_id" is not null)),
  CONSTRAINT "promotions_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "promotions_type_normalized_check" CHECK ("type" = lower(btrim("type")) and length("type") > 0),
  CONSTRAINT "promotions_value_positive_check" CHECK ("value" > 0),
  CONSTRAINT "promotions_percentage_bounded_check" CHECK (lower(btrim("type")) <> 'percentage' or "value" <= 100),
  CONSTRAINT "promotions_date_range_check" CHECK ("start_at" < "end_at"),
  CONSTRAINT "promotions_status_check" CHECK ("status" in ('draft', 'scheduled', 'active', 'inactive')),
  CONSTRAINT "promotions_funding_type_check" CHECK ("funding_type" in ('platform', 'seller')),
  CONSTRAINT "promotions_seller_funding_check" CHECK ("owner_type" <> 'seller' or "funding_type" = 'seller')
);
--> statement-breakpoint
CREATE TABLE "promotion_scopes" (
  "promotion_id" uuid NOT NULL,
  "scope_type" varchar(40) NOT NULL,
  "scope_id" uuid NOT NULL,
  CONSTRAINT "promotion_scopes_pk" PRIMARY KEY("promotion_id", "scope_type", "scope_id"),
  CONSTRAINT "promotion_scopes_type_normalized_check" CHECK ("scope_type" = lower(btrim("scope_type")) and length("scope_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promotion_id" uuid NOT NULL,
  "code" varchar(120) NOT NULL,
  "max_uses" integer,
  "max_uses_per_customer" integer,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  CONSTRAINT "coupons_code_normalized_check" CHECK ("code" = upper(btrim("code")) and length("code") > 0),
  CONSTRAINT "coupons_max_uses_check" CHECK ("max_uses" is null or "max_uses" > 0),
  CONSTRAINT "coupons_max_uses_per_customer_check" CHECK ("max_uses_per_customer" is null or "max_uses_per_customer" > 0),
  CONSTRAINT "coupons_status_check" CHECK ("status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coupon_id" uuid NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promotion_scopes"
  ADD CONSTRAINT "promotion_scopes_promotion_id_promotions_id_fk"
  FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_promotion_id_promotions_id_fk"
  FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk"
  FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_customer_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "promotions_seller_status_window_idx"
  ON "promotions" USING btree ("seller_id", "status", "start_at", "end_at");
--> statement-breakpoint
CREATE INDEX "promotions_owner_status_window_idx"
  ON "promotions" USING btree ("owner_type", "status", "start_at", "end_at");
--> statement-breakpoint
CREATE INDEX "promotion_scopes_target_idx"
  ON "promotion_scopes" USING btree ("scope_type", "scope_id", "promotion_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq"
  ON "coupons" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "coupons_promotion_status_idx"
  ON "coupons" USING btree ("promotion_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_coupon_order_uq"
  ON "coupon_redemptions" USING btree ("coupon_id", "order_id");
--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_customer_idx"
  ON "coupon_redemptions" USING btree ("coupon_id", "customer_user_id", "redeemed_at");
--> statement-breakpoint
CREATE INDEX "coupon_redemptions_order_idx"
  ON "coupon_redemptions" USING btree ("order_id");

-- Module 11 Pass 1: immutable Orders persistence plus the narrow Inventory
-- released-quantity accounting required for future partial Order cancellation.

ALTER TABLE "stock_reservations"
  ADD COLUMN "released_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_reservations"
  DROP CONSTRAINT "stock_reservations_consumed_qty_range_check";
--> statement-breakpoint
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_consumed_qty_nonnegative_check"
  CHECK ("consumed_qty" >= 0),
  ADD CONSTRAINT "stock_reservations_released_qty_nonnegative_check"
  CHECK ("released_qty" >= 0),
  ADD CONSTRAINT "stock_reservations_accounted_qty_range_check"
  CHECK ("consumed_qty" + "released_qty" <= "qty");
--> statement-breakpoint

CREATE TABLE "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_no" varchar(40) NOT NULL,
  "checkout_attempt_id" uuid NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "subtotal" numeric(18, 4) NOT NULL,
  "discount_total" numeric(18, 4) NOT NULL,
  "tax_total" numeric(18, 4) NOT NULL,
  "shipping_total" numeric(18, 4) NOT NULL,
  "grand_total" numeric(18, 4) NOT NULL,
  "payment_status" varchar(40) DEFAULT 'pending' NOT NULL,
  "fulfillment_status" varchar(40) DEFAULT 'unfulfilled' NOT NULL,
  "order_status" varchar(40) DEFAULT 'pending_payment' NOT NULL,
  "placed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "orders_order_no_matches_id_check"
    CHECK ("order_no" = 'ORD-' || upper(replace("id"::text, '-', ''))),
  CONSTRAINT "orders_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "orders_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  CONSTRAINT "orders_discount_total_nonnegative_check" CHECK ("discount_total" >= 0),
  CONSTRAINT "orders_discount_not_over_subtotal_check" CHECK ("discount_total" <= "subtotal"),
  CONSTRAINT "orders_tax_total_nonnegative_check" CHECK ("tax_total" >= 0),
  CONSTRAINT "orders_shipping_total_nonnegative_check" CHECK ("shipping_total" >= 0),
  CONSTRAINT "orders_grand_total_nonnegative_check" CHECK ("grand_total" >= 0),
  CONSTRAINT "orders_grand_total_formula_check"
    CHECK ("grand_total" = "subtotal" - "discount_total" + "tax_total" + "shipping_total"),
  CONSTRAINT "orders_payment_status_normalized_check"
    CHECK ("payment_status" = lower(btrim("payment_status")) and length("payment_status") > 0),
  CONSTRAINT "orders_fulfillment_status_normalized_check"
    CHECK ("fulfillment_status" = lower(btrim("fulfillment_status")) and length("fulfillment_status") > 0),
  CONSTRAINT "orders_order_status_normalized_check"
    CHECK ("order_status" = lower(btrim("order_status")) and length("order_status") > 0)
);
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_checkout_attempt_id_checkout_attempts_id_fk"
  FOREIGN KEY ("checkout_attempt_id") REFERENCES "public"."checkout_attempts"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_no_uq" ON "orders" USING btree ("order_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_attempt_uq" ON "orders" USING btree ("checkout_attempt_id");
--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" USING btree ("customer_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "orders_customer_status_created_idx" ON "orders" USING btree ("customer_user_id", "order_status", "created_at");
--> statement-breakpoint
CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status", "created_at");
--> statement-breakpoint

CREATE TABLE "seller_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "seller_order_no" varchar(40) NOT NULL,
  "subtotal" numeric(18, 4) NOT NULL,
  "discount_total" numeric(18, 4) NOT NULL,
  "tax_total" numeric(18, 4) NOT NULL,
  "shipping_total" numeric(18, 4) NOT NULL,
  "grand_total" numeric(18, 4) NOT NULL,
  "status" varchar(40) DEFAULT 'pending_payment' NOT NULL,
  "shipping_method_id" uuid NOT NULL,
  "shipping_method_code_snapshot" varchar(120) NOT NULL,
  "shipping_method_name_snapshot" varchar(200) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "seller_orders_number_matches_id_check"
    CHECK ("seller_order_no" = 'SOR-' || upper(replace("id"::text, '-', ''))),
  CONSTRAINT "seller_orders_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  CONSTRAINT "seller_orders_discount_total_nonnegative_check" CHECK ("discount_total" >= 0),
  CONSTRAINT "seller_orders_discount_not_over_subtotal_check" CHECK ("discount_total" <= "subtotal"),
  CONSTRAINT "seller_orders_tax_total_nonnegative_check" CHECK ("tax_total" >= 0),
  CONSTRAINT "seller_orders_shipping_total_nonnegative_check" CHECK ("shipping_total" >= 0),
  CONSTRAINT "seller_orders_grand_total_nonnegative_check" CHECK ("grand_total" >= 0),
  CONSTRAINT "seller_orders_grand_total_formula_check"
    CHECK ("grand_total" = "subtotal" - "discount_total" + "tax_total" + "shipping_total"),
  CONSTRAINT "seller_orders_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0),
  CONSTRAINT "seller_orders_shipping_code_not_blank_check"
    CHECK (length(btrim("shipping_method_code_snapshot")) > 0),
  CONSTRAINT "seller_orders_shipping_name_not_blank_check"
    CHECK (length(btrim("shipping_method_name_snapshot")) > 0)
);
--> statement-breakpoint
ALTER TABLE "seller_orders"
  ADD CONSTRAINT "seller_orders_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_orders"
  ADD CONSTRAINT "seller_orders_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_orders"
  ADD CONSTRAINT "seller_orders_store_seller_fk"
  FOREIGN KEY ("store_id", "seller_id") REFERENCES "public"."stores"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seller_orders"
  ADD CONSTRAINT "seller_orders_shipping_method_id_shipping_methods_id_fk"
  FOREIGN KEY ("shipping_method_id") REFERENCES "public"."shipping_methods"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_seller_order_no_uq" ON "seller_orders" USING btree ("seller_order_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_order_seller_store_uq" ON "seller_orders" USING btree ("order_id", "seller_id", "store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_id_order_uq" ON "seller_orders" USING btree ("id", "order_id");
--> statement-breakpoint
CREATE INDEX "seller_orders_seller_status_created_idx" ON "seller_orders" USING btree ("seller_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "seller_orders_store_status_created_idx" ON "seller_orders" USING btree ("store_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "seller_orders_order_idx" ON "seller_orders" USING btree ("order_id");
--> statement-breakpoint

CREATE TABLE "order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "seller_order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "inventory_reservation_id" uuid NOT NULL,
  "sku_snapshot" varchar(120) NOT NULL,
  "name_snapshot" varchar(240) NOT NULL,
  "variant_title_snapshot" varchar(200),
  "qty" integer NOT NULL,
  "unit_price" numeric(18, 4) NOT NULL,
  "discount_allocated" numeric(18, 4) NOT NULL,
  "tax_allocated" numeric(18, 4) NOT NULL,
  "line_total" numeric(18, 4) NOT NULL,
  "commission_rule_snapshot_json" jsonb,
  "status" varchar(40) DEFAULT 'active' NOT NULL,
  "cancelled_qty" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_items_qty_positive_check" CHECK ("qty" > 0),
  CONSTRAINT "order_items_cancelled_qty_nonnegative_check" CHECK ("cancelled_qty" >= 0),
  CONSTRAINT "order_items_cancelled_qty_not_over_qty_check" CHECK ("cancelled_qty" <= "qty"),
  CONSTRAINT "order_items_unit_price_nonnegative_check" CHECK ("unit_price" >= 0),
  CONSTRAINT "order_items_discount_allocated_nonnegative_check" CHECK ("discount_allocated" >= 0),
  CONSTRAINT "order_items_discount_not_over_subtotal_check" CHECK ("discount_allocated" <= ("unit_price" * "qty")),
  CONSTRAINT "order_items_tax_allocated_nonnegative_check" CHECK ("tax_allocated" >= 0),
  CONSTRAINT "order_items_line_total_nonnegative_check" CHECK ("line_total" >= 0),
  CONSTRAINT "order_items_line_total_formula_check"
    CHECK ("line_total" = ("unit_price" * "qty") - "discount_allocated" + "tax_allocated"),
  CONSTRAINT "order_items_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0),
  CONSTRAINT "order_items_sku_snapshot_not_blank_check" CHECK (length(btrim("sku_snapshot")) > 0),
  CONSTRAINT "order_items_name_snapshot_not_blank_check" CHECK (length(btrim("name_snapshot")) > 0),
  CONSTRAINT "order_items_variant_title_snapshot_not_blank_check"
    CHECK ("variant_title_snapshot" is null or length(btrim("variant_title_snapshot")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_seller_order_parent_fk"
  FOREIGN KEY ("seller_order_id", "order_id") REFERENCES "public"."seller_orders"("id", "order_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_variant_product_fk"
  FOREIGN KEY ("variant_id", "product_id") REFERENCES "public"."product_variants"("id", "product_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_inventory_reservation_id_stock_reservations_id_fk"
  FOREIGN KEY ("inventory_reservation_id") REFERENCES "public"."stock_reservations"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_inventory_reservation_uq" ON "order_items" USING btree ("inventory_reservation_id");
--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "order_items_seller_order_idx" ON "order_items" USING btree ("seller_order_id");
--> statement-breakpoint
CREATE INDEX "order_items_product_variant_idx" ON "order_items" USING btree ("product_id", "variant_id");
--> statement-breakpoint
CREATE INDEX "order_items_status_idx" ON "order_items" USING btree ("status");
--> statement-breakpoint

CREATE TABLE "order_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "type" varchar(20) NOT NULL,
  "source_address_id" uuid,
  "recipient_name" varchar(200) NOT NULL,
  "phone" varchar(32) NOT NULL,
  "line1" varchar(255) NOT NULL,
  "line2" varchar(255),
  "city" varchar(120) NOT NULL,
  "region" varchar(120) NOT NULL,
  "postal_code" varchar(32),
  "country_code" varchar(2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_addresses_type_check" CHECK ("type" in ('shipping', 'billing')),
  CONSTRAINT "order_addresses_recipient_name_not_blank_check" CHECK (length(btrim("recipient_name")) > 0),
  CONSTRAINT "order_addresses_phone_not_blank_check" CHECK (length(btrim("phone")) > 0),
  CONSTRAINT "order_addresses_line1_not_blank_check" CHECK (length(btrim("line1")) > 0),
  CONSTRAINT "order_addresses_city_not_blank_check" CHECK (length(btrim("city")) > 0),
  CONSTRAINT "order_addresses_region_not_blank_check" CHECK (length(btrim("region")) > 0),
  CONSTRAINT "order_addresses_line2_not_blank_check" CHECK ("line2" is null or length(btrim("line2")) > 0),
  CONSTRAINT "order_addresses_postal_code_not_blank_check" CHECK ("postal_code" is null or length(btrim("postal_code")) > 0),
  CONSTRAINT "order_addresses_country_code_check"
    CHECK ("country_code" = upper(btrim("country_code")) and "country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "order_addresses"
  ADD CONSTRAINT "order_addresses_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_addresses"
  ADD CONSTRAINT "order_addresses_source_address_id_customer_addresses_id_fk"
  FOREIGN KEY ("source_address_id") REFERENCES "public"."customer_addresses"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_addresses_order_type_uq" ON "order_addresses" USING btree ("order_id", "type");
--> statement-breakpoint
CREATE INDEX "order_addresses_source_address_idx" ON "order_addresses" USING btree ("source_address_id");
--> statement-breakpoint

CREATE TABLE "order_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid,
  "seller_order_id" uuid,
  "from_status" varchar(40),
  "to_status" varchar(40) NOT NULL,
  "reason" varchar(500),
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_type" varchar(80),
  "source_key" varchar(200),
  "metadata_json" jsonb,
  CONSTRAINT "order_status_history_one_target_check"
    CHECK (num_nonnulls("order_id", "seller_order_id") = 1),
  CONSTRAINT "order_status_history_from_status_normalized_check"
    CHECK ("from_status" is null or ("from_status" = lower(btrim("from_status")) and length("from_status") > 0)),
  CONSTRAINT "order_status_history_to_status_normalized_check"
    CHECK ("to_status" = lower(btrim("to_status")) and length("to_status") > 0),
  CONSTRAINT "order_status_history_reason_not_blank_check"
    CHECK ("reason" is null or length(btrim("reason")) > 0),
  CONSTRAINT "order_status_history_source_pair_check"
    CHECK (("source_type" is null and "source_key" is null) or ("source_type" is not null and "source_key" is not null)),
  CONSTRAINT "order_status_history_source_type_normalized_check"
    CHECK ("source_type" is null or ("source_type" = lower(btrim("source_type")) and length("source_type") > 0)),
  CONSTRAINT "order_status_history_source_key_normalized_check"
    CHECK ("source_key" is null or ("source_key" = btrim("source_key") and length("source_key") > 0))
);
--> statement-breakpoint
ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_seller_order_id_seller_orders_id_fk"
  FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_changed_by_users_id_fk"
  FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "order_status_history_order_changed_idx" ON "order_status_history" USING btree ("order_id", "changed_at");
--> statement-breakpoint
CREATE INDEX "order_status_history_seller_order_changed_idx" ON "order_status_history" USING btree ("seller_order_id", "changed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_status_history_source_uq"
  ON "order_status_history" USING btree ("source_type", "source_key")
  WHERE "source_type" is not null and "source_key" is not null;
--> statement-breakpoint

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action NOT VALID;
--> statement-breakpoint

ALTER TABLE "checkout_attempts"
  ADD CONSTRAINT "checkout_attempts_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;

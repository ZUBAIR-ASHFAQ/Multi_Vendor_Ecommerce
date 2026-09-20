CREATE TABLE "checkout_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "subtotal" numeric(18, 4) NOT NULL,
  "discount_total" numeric(18, 4) NOT NULL,
  "tax_total" numeric(18, 4) NOT NULL,
  "shipping_total" numeric(18, 4) NOT NULL,
  "grand_total" numeric(18, 4) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "state_hash" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checkout_quotes_currency_check" CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "checkout_quotes_subtotal_nonnegative_check" CHECK ("subtotal" >= 0),
  CONSTRAINT "checkout_quotes_discount_total_nonnegative_check" CHECK ("discount_total" >= 0),
  CONSTRAINT "checkout_quotes_discount_not_over_subtotal_check" CHECK ("discount_total" <= "subtotal"),
  CONSTRAINT "checkout_quotes_tax_total_nonnegative_check" CHECK ("tax_total" >= 0),
  CONSTRAINT "checkout_quotes_shipping_total_nonnegative_check" CHECK ("shipping_total" >= 0),
  CONSTRAINT "checkout_quotes_grand_total_nonnegative_check" CHECK ("grand_total" >= 0),
  CONSTRAINT "checkout_quotes_grand_total_formula_check" CHECK ("grand_total" = "subtotal" - "discount_total" + "tax_total" + "shipping_total"),
  CONSTRAINT "checkout_quotes_state_hash_not_blank_check" CHECK (length(btrim("state_hash")) > 0),
  CONSTRAINT "checkout_quotes_expiry_after_creation_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "checkout_quote_lines" (
  "quote_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "qty" integer NOT NULL,
  "unit_price" numeric(18, 4) NOT NULL,
  "discount" numeric(18, 4) NOT NULL,
  "tax" numeric(18, 4) NOT NULL,
  "line_total" numeric(18, 4) NOT NULL,
  CONSTRAINT "checkout_quote_lines_pk" PRIMARY KEY("quote_id", "variant_id"),
  CONSTRAINT "checkout_quote_lines_qty_positive_check" CHECK ("qty" > 0),
  CONSTRAINT "checkout_quote_lines_unit_price_nonnegative_check" CHECK ("unit_price" >= 0),
  CONSTRAINT "checkout_quote_lines_discount_nonnegative_check" CHECK ("discount" >= 0),
  CONSTRAINT "checkout_quote_lines_tax_nonnegative_check" CHECK ("tax" >= 0),
  CONSTRAINT "checkout_quote_lines_line_total_nonnegative_check" CHECK ("line_total" >= 0),
  CONSTRAINT "checkout_quote_lines_discount_not_over_subtotal_check" CHECK ("discount" <= ("unit_price" * "qty")),
  CONSTRAINT "checkout_quote_lines_total_formula_check" CHECK ("line_total" = ("unit_price" * "qty") - "discount" + "tax")
);
--> statement-breakpoint
CREATE TABLE "checkout_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "order_id" uuid,
  "status" varchar(40) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "checkout_attempts_status_not_blank_check" CHECK (length(btrim("status")) > 0),
  CONSTRAINT "checkout_attempts_idempotency_key_normalized_check" CHECK ("idempotency_key" = btrim("idempotency_key") and length("idempotency_key") > 0),
  CONSTRAINT "checkout_attempts_expiry_after_creation_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD CONSTRAINT "checkout_quote_lines_quote_id_checkout_quotes_id_fk"
  FOREIGN KEY ("quote_id") REFERENCES "public"."checkout_quotes"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD CONSTRAINT "checkout_quote_lines_variant_id_product_variants_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD CONSTRAINT "checkout_quote_lines_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_attempts"
  ADD CONSTRAINT "checkout_attempts_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_quotes_id_customer_uq"
  ON "checkout_quotes" USING btree ("id", "customer_user_id");
--> statement-breakpoint
ALTER TABLE "checkout_attempts"
  ADD CONSTRAINT "checkout_attempts_quote_customer_fk"
  FOREIGN KEY ("quote_id", "customer_user_id") REFERENCES "public"."checkout_quotes"("id", "customer_user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "checkout_quotes_customer_expiry_idx"
  ON "checkout_quotes" USING btree ("customer_user_id", "expires_at");
--> statement-breakpoint
CREATE INDEX "checkout_quote_lines_seller_idx"
  ON "checkout_quote_lines" USING btree ("seller_id", "quote_id");
--> statement-breakpoint
CREATE INDEX "checkout_quote_lines_variant_idx"
  ON "checkout_quote_lines" USING btree ("variant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempts_customer_idempotency_uq"
  ON "checkout_attempts" USING btree ("customer_user_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempts_id_customer_uq"
  ON "checkout_attempts" USING btree ("id", "customer_user_id");
--> statement-breakpoint
CREATE INDEX "checkout_attempts_quote_idx"
  ON "checkout_attempts" USING btree ("quote_id");
--> statement-breakpoint
CREATE INDEX "checkout_attempts_customer_status_idx"
  ON "checkout_attempts" USING btree ("customer_user_id", "status");
--> statement-breakpoint
CREATE INDEX "checkout_attempts_order_idx"
  ON "checkout_attempts" USING btree ("order_id") WHERE "order_id" is not null;

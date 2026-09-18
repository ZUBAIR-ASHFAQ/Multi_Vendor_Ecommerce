CREATE UNIQUE INDEX "customer_addresses_id_customer_uq"
  ON "customer_addresses" USING btree ("id", "customer_user_id");
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD COLUMN "shipping_address_id" uuid,
  ADD COLUMN "billing_address_id" uuid,
  ADD COLUMN "coupon_code" varchar(120);
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD COLUMN "store_id" uuid;
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_shipping_address_customer_fk"
  FOREIGN KEY ("shipping_address_id", "customer_user_id")
  REFERENCES "public"."customer_addresses"("id", "customer_user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_billing_address_customer_fk"
  FOREIGN KEY ("billing_address_id", "customer_user_id")
  REFERENCES "public"."customer_addresses"("id", "customer_user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_addresses_present_check"
  CHECK ("shipping_address_id" is not null and "billing_address_id" is not null) NOT VALID;
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_coupon_code_normalized_check"
  CHECK ("coupon_code" is null or ("coupon_code" = upper(btrim("coupon_code")) and length("coupon_code") > 0));
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  DROP CONSTRAINT "checkout_quotes_state_hash_not_blank_check";
--> statement-breakpoint
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_state_hash_sha256_check"
  CHECK ("state_hash" ~ '^[0-9a-f]{64}$') NOT VALID;
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD CONSTRAINT "checkout_quote_lines_store_seller_fk"
  FOREIGN KEY ("store_id", "seller_id")
  REFERENCES "public"."stores"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_lines"
  ADD CONSTRAINT "checkout_quote_lines_store_present_check"
  CHECK ("store_id" is not null) NOT VALID;
--> statement-breakpoint
CREATE INDEX "checkout_quote_lines_store_idx"
  ON "checkout_quote_lines" USING btree ("store_id", "quote_id");
--> statement-breakpoint
CREATE TABLE "checkout_quote_shipping_selections" (
  "quote_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "shipping_method_id" uuid NOT NULL,
  "shipping_method_code_snapshot" varchar(120) NOT NULL,
  "shipping_method_name_snapshot" varchar(200) NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  CONSTRAINT "checkout_quote_shipping_selections_pk" PRIMARY KEY("quote_id", "store_id"),
  CONSTRAINT "checkout_quote_shipping_selections_code_not_blank_check"
    CHECK (length(btrim("shipping_method_code_snapshot")) > 0),
  CONSTRAINT "checkout_quote_shipping_selections_name_not_blank_check"
    CHECK (length(btrim("shipping_method_name_snapshot")) > 0),
  CONSTRAINT "checkout_quote_shipping_selections_amount_nonnegative_check"
    CHECK ("amount" >= 0),
  CONSTRAINT "checkout_quote_shipping_selections_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "checkout_quote_shipping_selections"
  ADD CONSTRAINT "checkout_quote_shipping_selections_quote_id_checkout_quotes_id_fk"
  FOREIGN KEY ("quote_id") REFERENCES "public"."checkout_quotes"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_shipping_selections"
  ADD CONSTRAINT "checkout_quote_shipping_selections_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_shipping_selections"
  ADD CONSTRAINT "checkout_quote_shipping_selections_store_seller_fk"
  FOREIGN KEY ("store_id", "seller_id") REFERENCES "public"."stores"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkout_quote_shipping_selections"
  ADD CONSTRAINT "checkout_quote_shipping_selections_shipping_method_id_shipping_methods_id_fk"
  FOREIGN KEY ("shipping_method_id") REFERENCES "public"."shipping_methods"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "checkout_quote_shipping_selections_seller_idx"
  ON "checkout_quote_shipping_selections" USING btree ("seller_id", "quote_id");
--> statement-breakpoint
CREATE INDEX "checkout_quote_shipping_selections_method_idx"
  ON "checkout_quote_shipping_selections" USING btree ("shipping_method_id");
--> statement-breakpoint
DROP INDEX "checkout_attempts_quote_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempts_quote_uq"
  ON "checkout_attempts" USING btree ("quote_id");
--> statement-breakpoint
DROP INDEX "checkout_attempts_id_customer_uq";

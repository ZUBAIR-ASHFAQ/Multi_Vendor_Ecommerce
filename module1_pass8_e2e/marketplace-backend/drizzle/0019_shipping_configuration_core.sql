CREATE TABLE "shipping_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" varchar(20) NOT NULL,
  "seller_id" uuid,
  "code" varchar(120) NOT NULL,
  "name" varchar(200) NOT NULL,
  "pricing_type" varchar(40) NOT NULL,
  "base_rate" numeric(18, 4) NOT NULL,
  "status" varchar(20) NOT NULL,
  CONSTRAINT "shipping_methods_owner_type_check" CHECK ("owner_type" in ('platform', 'seller')),
  CONSTRAINT "shipping_methods_owner_seller_check" CHECK (("owner_type" = 'platform' and "seller_id" is null) or ("owner_type" = 'seller' and "seller_id" is not null)),
  CONSTRAINT "shipping_methods_code_not_blank_check" CHECK (length(btrim("code")) > 0),
  CONSTRAINT "shipping_methods_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "shipping_methods_pricing_type_not_blank_check" CHECK (length(btrim("pricing_type")) > 0),
  CONSTRAINT "shipping_methods_base_rate_nonnegative_check" CHECK ("base_rate" >= 0),
  CONSTRAINT "shipping_methods_status_not_blank_check" CHECK (length(btrim("status")) > 0)
);
--> statement-breakpoint
ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipping_methods_owner_status_idx"
  ON "shipping_methods" USING btree ("owner_type", "status");
--> statement-breakpoint
CREATE INDEX "shipping_methods_seller_status_idx"
  ON "shipping_methods" USING btree ("seller_id", "status");

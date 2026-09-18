CREATE TABLE "carts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "carts_currency_check" CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cart_items_quantity_positive_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wishlists_name_not_blank_check" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wishlist_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_cart_id_carts_id_fk"
  FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk"
  FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wishlists"
  ADD CONSTRAINT "wishlists_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk"
  FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wishlist_items"
  ADD CONSTRAINT "wishlist_items_variant_product_fk"
  FOREIGN KEY ("variant_id", "product_id")
  REFERENCES "public"."product_variants"("id", "product_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_user_id_uq"
  ON "carts" USING btree ("customer_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_variant_uq"
  ON "cart_items" USING btree ("cart_id", "variant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_customer_default_uq"
  ON "wishlists" USING btree ("customer_user_id") WHERE "is_default" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_product_only_uq"
  ON "wishlist_items" USING btree ("wishlist_id", "product_id") WHERE "variant_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_variant_uq"
  ON "wishlist_items" USING btree ("wishlist_id", "product_id", "variant_id") WHERE "variant_id" is not null;

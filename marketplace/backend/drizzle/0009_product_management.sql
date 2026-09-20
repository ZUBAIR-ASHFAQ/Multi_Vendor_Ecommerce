CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "brand_id" uuid,
  "slug" varchar(160) NOT NULL,
  "name" varchar(240) NOT NULL,
  "description" text NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "publication_status" varchar(30) DEFAULT 'draft' NOT NULL,
  "created_by" uuid NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "products_status_check" CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "products_publication_status_check" CHECK ("publication_status" in ('draft', 'pending_approval', 'published', 'unpublished')),
  CONSTRAINT "products_slug_normalized_check" CHECK ("slug" = lower(btrim("slug")) and length("slug") > 0),
  CONSTRAINT "products_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "products_description_not_blank_check" CHECK (length(btrim("description")) > 0),
  CONSTRAINT "products_published_at_state_check" CHECK (("publication_status" = 'published' and "published_at" is not null) or ("publication_status" <> 'published'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "sku" varchar(120) NOT NULL,
  "title" varchar(200) NOT NULL,
  "price" numeric(18, 2) NOT NULL,
  "compare_at_price" numeric(18, 2),
  "currency" varchar(3) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "weight" numeric(12, 3),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_variants_status_check" CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "product_variants_sku_not_blank_check" CHECK (length(btrim("sku")) > 0),
  CONSTRAINT "product_variants_title_not_blank_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "product_variants_price_check" CHECK ("price" >= 0),
  CONSTRAINT "product_variants_compare_price_check" CHECK ("compare_at_price" is null or "compare_at_price" >= 0),
  CONSTRAINT "product_variants_currency_check" CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "product_variants_weight_check" CHECK ("weight" is null or "weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "attribute_id" uuid NOT NULL,
  "value_text" text,
  "value_number" numeric(24, 6),
  "value_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_attribute_values_one_value_check" CHECK (num_nonnulls("value_text", "value_number", "value_id") = 1),
  CONSTRAINT "product_attribute_values_text_not_blank_check" CHECK ("value_text" is null or length(btrim("value_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "product_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "variant_id" uuid,
  "file_id" uuid NOT NULL,
  "media_type" varchar(40) NOT NULL,
  "alt_text" varchar(500),
  "sort_order" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_media_status_check" CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "product_media_type_not_blank_check" CHECK (length(btrim("media_type")) > 0),
  CONSTRAINT "product_media_alt_text_not_blank_check" CHECK ("alt_text" is null or length(btrim("alt_text")) > 0),
  CONSTRAINT "product_media_sort_order_check" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_price_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "variant_id" uuid NOT NULL,
  "old_price" numeric(18, 2) NOT NULL,
  "new_price" numeric(18, 2) NOT NULL,
  "changed_by" uuid NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_price_history_old_price_check" CHECK ("old_price" >= 0),
  CONSTRAINT "product_price_history_new_price_check" CHECK ("new_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_value_id_attribute_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."attribute_values"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_slug_uq" ON "products" USING btree ("store_id","slug");
--> statement-breakpoint
CREATE INDEX "products_seller_store_status_idx" ON "products" USING btree ("seller_id","store_id","publication_status","status");
--> statement-breakpoint
CREATE INDEX "products_public_catalog_idx" ON "products" USING btree ("publication_status","status","category_id","brand_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_sku_uq" ON "product_variants" USING btree ("product_id","sku");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_id_product_uq" ON "product_variants" USING btree ("id","product_id");
--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");
--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_variant_product_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_attribute_values_product_attribute_uq" ON "product_attribute_values" USING btree ("product_id","attribute_id") WHERE "variant_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_attribute_values_variant_attribute_uq" ON "product_attribute_values" USING btree ("variant_id","attribute_id") WHERE "variant_id" is not null;
--> statement-breakpoint
CREATE INDEX "product_attribute_values_attribute_idx" ON "product_attribute_values" USING btree ("attribute_id");
--> statement-breakpoint
CREATE INDEX "product_attribute_values_value_id_idx" ON "product_attribute_values" USING btree ("value_id");
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_product_fk" FOREIGN KEY ("variant_id","product_id") REFERENCES "public"."product_variants"("id","product_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_media_product_status_sort_idx" ON "product_media" USING btree ("product_id","status","sort_order");
--> statement-breakpoint
CREATE INDEX "product_media_variant_idx" ON "product_media" USING btree ("variant_id");
--> statement-breakpoint
CREATE INDEX "product_media_file_idx" ON "product_media" USING btree ("file_id");
--> statement-breakpoint
CREATE INDEX "product_price_history_variant_changed_idx" ON "product_price_history" USING btree ("variant_id","changed_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_product_price_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'product_price_history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "product_price_history_append_only_trigger"
BEFORE UPDATE OR DELETE ON "product_price_history"
FOR EACH ROW EXECUTE FUNCTION prevent_product_price_history_mutation();

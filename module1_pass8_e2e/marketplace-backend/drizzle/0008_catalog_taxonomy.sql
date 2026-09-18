-- Module 5 Catalog Taxonomy database foundation.
-- This migration is append-only and upgrades the supported Module 4 schema.

CREATE TABLE "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "parent_id" uuid,
  "slug" varchar(160) NOT NULL,
  "name" varchar(200) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "categories_parent_id_categories_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT,
  CONSTRAINT "categories_status_check"
    CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "categories_slug_normalized_check"
    CHECK ("slug" = lower(btrim("slug")) AND length("slug") > 0),
  CONSTRAINT "categories_name_not_blank_check"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "categories_not_own_parent_check"
    CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  CONSTRAINT "categories_sort_order_check"
    CHECK ("sort_order" >= 0)
);

CREATE UNIQUE INDEX "categories_slug_uq"
  ON "categories" USING btree ("slug");

CREATE INDEX "categories_parent_status_sort_idx"
  ON "categories" USING btree ("parent_id", "status", "sort_order");

CREATE TABLE "brands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" varchar(160) NOT NULL,
  "name" varchar(200) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  CONSTRAINT "brands_status_check"
    CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "brands_slug_normalized_check"
    CHECK ("slug" = lower(btrim("slug")) AND length("slug") > 0),
  CONSTRAINT "brands_name_not_blank_check"
    CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "brands_slug_uq"
  ON "brands" USING btree ("slug");

CREATE INDEX "brands_status_name_idx"
  ON "brands" USING btree ("status", "name");

CREATE TABLE "attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(120) NOT NULL,
  "name" varchar(200) NOT NULL,
  "data_type" varchar(40) NOT NULL,
  "is_variant_axis" boolean DEFAULT false NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  CONSTRAINT "attributes_status_check"
    CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "attributes_code_normalized_check"
    CHECK ("code" = lower(btrim("code")) AND length("code") > 0),
  CONSTRAINT "attributes_name_not_blank_check"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "attributes_data_type_not_blank_check"
    CHECK (length(btrim("data_type")) > 0)
);

CREATE UNIQUE INDEX "attributes_code_uq"
  ON "attributes" USING btree ("code");

CREATE INDEX "attributes_status_name_idx"
  ON "attributes" USING btree ("status", "name");

CREATE TABLE "attribute_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attribute_id" uuid NOT NULL,
  "value" varchar(240) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  CONSTRAINT "attribute_values_attribute_id_attributes_id_fk"
    FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT,
  CONSTRAINT "attribute_values_status_check"
    CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "attribute_values_value_not_blank_check"
    CHECK (length(btrim("value")) > 0),
  CONSTRAINT "attribute_values_sort_order_check"
    CHECK ("sort_order" >= 0)
);

CREATE INDEX "attribute_values_attribute_status_sort_idx"
  ON "attribute_values" USING btree ("attribute_id", "status", "sort_order");

CREATE TABLE "category_attributes" (
  "category_id" uuid NOT NULL,
  "attribute_id" uuid NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_filterable" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "category_attributes_pk"
    PRIMARY KEY ("category_id", "attribute_id"),
  CONSTRAINT "category_attributes_category_id_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT,
  CONSTRAINT "category_attributes_attribute_id_attributes_id_fk"
    FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE RESTRICT,
  CONSTRAINT "category_attributes_sort_order_check"
    CHECK ("sort_order" >= 0)
);

CREATE INDEX "category_attributes_attribute_idx"
  ON "category_attributes" USING btree ("attribute_id");

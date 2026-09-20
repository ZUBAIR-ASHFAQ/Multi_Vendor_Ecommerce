-- Module 19 Pass 1: PostgreSQL-backed Search & Discovery read model.
-- Search is eventually consistent; Product, Catalog, Inventory, and later Ratings remain authoritative.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "product_search_documents" (
  "product_id" uuid PRIMARY KEY NOT NULL,
  "searchable_text" text NOT NULL,
  "category_id" uuid NOT NULL,
  "category_path" text NOT NULL,
  "brand_id" uuid,
  "brand" varchar(200),
  "min_price" numeric(18, 2) NOT NULL,
  "max_price" numeric(18, 2) NOT NULL,
  "rating_avg" numeric(4, 2) DEFAULT '0' NOT NULL,
  "rating_count" integer DEFAULT 0 NOT NULL,
  "in_stock" boolean DEFAULT false NOT NULL,
  "filterable_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_search_documents_searchable_text_not_blank_check" CHECK (length(btrim("searchable_text")) > 0),
  CONSTRAINT "product_search_documents_category_path_not_blank_check" CHECK (length(btrim("category_path")) > 0),
  CONSTRAINT "product_search_documents_brand_not_blank_check" CHECK ("brand" is null or length(btrim("brand")) > 0),
  CONSTRAINT "product_search_documents_min_price_check" CHECK ("min_price" >= 0),
  CONSTRAINT "product_search_documents_max_price_check" CHECK ("max_price" >= 0),
  CONSTRAINT "product_search_documents_price_range_check" CHECK ("min_price" <= "max_price"),
  CONSTRAINT "product_search_documents_rating_avg_check" CHECK ("rating_avg" >= 0 and "rating_avg" <= 5),
  CONSTRAINT "product_search_documents_rating_count_check" CHECK ("rating_count" >= 0),
  CONSTRAINT "product_search_documents_attributes_object_check" CHECK (jsonb_typeof("filterable_attributes") = 'object')
);
--> statement-breakpoint
CREATE TABLE "search_synonyms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "term" varchar(160) NOT NULL,
  "synonyms" jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_synonyms_term_normalized_check" CHECK ("term" = lower(btrim("term")) and length("term") > 0),
  CONSTRAINT "search_synonyms_values_array_check" CHECK (jsonb_typeof("synonyms") = 'array' and jsonb_array_length("synonyms") > 0),
  CONSTRAINT "search_synonyms_status_check" CHECK ("status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "search_reindex_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(40) DEFAULT 'full_catalog' NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "error_message" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_reindex_runs_scope_check" CHECK ("scope" = 'full_catalog'),
  CONSTRAINT "search_reindex_runs_status_check" CHECK ("status" in ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT "search_reindex_runs_state_check" CHECK (
    ("status" = 'queued' and "started_at" is null and "completed_at" is null and "error_message" is null)
    or ("status" = 'running' and "started_at" is not null and "completed_at" is null and "error_message" is null)
    or ("status" = 'completed' and "started_at" is not null and "completed_at" is not null and "error_message" is null)
    or ("status" = 'failed' and "started_at" is not null and "completed_at" is not null and "error_message" is not null and length(btrim("error_message")) > 0)
  ),
  CONSTRAINT "search_reindex_runs_started_after_requested_check" CHECK ("started_at" is null or "started_at" >= "requested_at"),
  CONSTRAINT "search_reindex_runs_completed_after_started_check" CHECK ("completed_at" is null or ("started_at" is not null and "completed_at" >= "started_at"))
);
--> statement-breakpoint
ALTER TABLE "product_search_documents"
  ADD CONSTRAINT "product_search_documents_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_search_documents"
  ADD CONSTRAINT "product_search_documents_category_id_categories_id_fk"
  FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_search_documents"
  ADD CONSTRAINT "product_search_documents_brand_id_brands_id_fk"
  FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_search_documents_fts_idx"
  ON "product_search_documents" USING gin (to_tsvector('simple', "searchable_text"));
--> statement-breakpoint
CREATE INDEX "product_search_documents_trgm_idx"
  ON "product_search_documents" USING gin ("searchable_text" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "product_search_documents_category_idx"
  ON "product_search_documents" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "product_search_documents_brand_idx"
  ON "product_search_documents" USING btree ("brand_id");
--> statement-breakpoint
CREATE INDEX "product_search_documents_price_idx"
  ON "product_search_documents" USING btree ("min_price", "max_price");
--> statement-breakpoint
CREATE INDEX "product_search_documents_rating_idx"
  ON "product_search_documents" USING btree ("rating_avg", "rating_count");
--> statement-breakpoint
CREATE INDEX "product_search_documents_in_stock_idx"
  ON "product_search_documents" USING btree ("in_stock") WHERE "in_stock" = true;
--> statement-breakpoint
CREATE INDEX "product_search_documents_attributes_idx"
  ON "product_search_documents" USING gin ("filterable_attributes" jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX "product_search_documents_updated_idx"
  ON "product_search_documents" USING btree ("updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "search_synonyms_term_uq"
  ON "search_synonyms" USING btree ("term");
--> statement-breakpoint
CREATE INDEX "search_synonyms_status_term_idx"
  ON "search_synonyms" USING btree ("status", "term");
--> statement-breakpoint
CREATE UNIQUE INDEX "search_reindex_runs_active_scope_uq"
  ON "search_reindex_runs" USING btree ("scope") WHERE "status" in ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "search_reindex_runs_status_requested_idx"
  ON "search_reindex_runs" USING btree ("status", "requested_at");

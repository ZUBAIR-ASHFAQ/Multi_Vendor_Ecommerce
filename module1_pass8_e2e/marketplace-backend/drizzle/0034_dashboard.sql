CREATE TABLE "dashboard_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "layout_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_date_range" varchar(40) NOT NULL,
  "default_store_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_preferences_layout_check" CHECK (jsonb_typeof("layout_json") = 'object'),
  CONSTRAINT "dashboard_preferences_default_date_range_not_blank_check" CHECK (length(btrim("default_date_range")) > 0)
);
--> statement-breakpoint
ALTER TABLE "dashboard_preferences"
  ADD CONSTRAINT "dashboard_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dashboard_preferences"
  ADD CONSTRAINT "dashboard_preferences_default_store_id_stores_id_fk"
  FOREIGN KEY ("default_store_id") REFERENCES "public"."stores"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_preferences_user_uq"
  ON "dashboard_preferences" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "dashboard_preferences_default_store_idx"
  ON "dashboard_preferences" USING btree ("default_store_id");
--> statement-breakpoint

CREATE TABLE "dashboard_saved_filters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "filter_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_saved_filters_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "dashboard_saved_filters_filter_check" CHECK (jsonb_typeof("filter_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "dashboard_saved_filters"
  ADD CONSTRAINT "dashboard_saved_filters_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dashboard_saved_filters_user_created_idx"
  ON "dashboard_saved_filters" USING btree ("user_id", "created_at", "id");

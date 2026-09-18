CREATE TABLE "report_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(120) NOT NULL,
  "domain" varchar(80) NOT NULL,
  "required_permissions" jsonb NOT NULL,
  "filter_schema_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_formats" jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_definitions_code_normalized_check" CHECK ("code" = lower(btrim("code")) and "code" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "report_definitions_domain_normalized_check" CHECK ("domain" = lower(btrim("domain")) and "domain" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "report_definitions_required_permissions_check" CHECK (jsonb_typeof("required_permissions") = 'array' and jsonb_array_length("required_permissions") > 0),
  CONSTRAINT "report_definitions_filter_schema_check" CHECK (jsonb_typeof("filter_schema_json") = 'object'),
  CONSTRAINT "report_definitions_output_formats_check" CHECK (jsonb_typeof("output_formats") = 'array' and jsonb_array_length("output_formats") > 0 and "output_formats" <@ '["csv", "pdf"]'::jsonb),
  CONSTRAINT "report_definitions_status_check" CHECK ("status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_code_uq"
  ON "report_definitions" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "report_definitions_domain_status_idx"
  ON "report_definitions" USING btree ("domain", "status", "code");
--> statement-breakpoint

CREATE TABLE "report_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "report_code" varchar(120) NOT NULL,
  "requested_by" uuid NOT NULL,
  "filters_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_format" varchar(10) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "file_id" uuid,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_runs_report_code_normalized_check" CHECK ("report_code" = lower(btrim("report_code")) and "report_code" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "report_runs_filters_check" CHECK (jsonb_typeof("filters_json") = 'object'),
  CONSTRAINT "report_runs_output_format_check" CHECK ("output_format" in ('csv', 'pdf')),
  CONSTRAINT "report_runs_status_check" CHECK ("status" in ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT "report_runs_started_at_check" CHECK ("started_at" is null or "started_at" >= "created_at"),
  CONSTRAINT "report_runs_finished_at_check" CHECK ("finished_at" is null or ("started_at" is not null and "finished_at" >= "started_at")),
  CONSTRAINT "report_runs_error_code_not_blank_check" CHECK ("error_code" is null or length(btrim("error_code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_report_code_report_definitions_code_fk"
  FOREIGN KEY ("report_code") REFERENCES "public"."report_definitions"("code")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_requested_by_users_id_fk"
  FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_file_id_files_id_fk"
  FOREIGN KEY ("file_id") REFERENCES "public"."files"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "report_runs_requester_created_idx"
  ON "report_runs" USING btree ("requested_by", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "report_runs_report_created_idx"
  ON "report_runs" USING btree ("report_code", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "report_runs_status_created_idx"
  ON "report_runs" USING btree ("status", "created_at", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_file_uq"
  ON "report_runs" USING btree ("file_id")
  WHERE "file_id" is not null;
--> statement-breakpoint

CREATE TABLE "saved_report_filters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "report_code" varchar(120) NOT NULL,
  "name" varchar(160) NOT NULL,
  "filters_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_report_filters_report_code_normalized_check" CHECK ("report_code" = lower(btrim("report_code")) and "report_code" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "saved_report_filters_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "saved_report_filters_filters_check" CHECK (jsonb_typeof("filters_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "saved_report_filters"
  ADD CONSTRAINT "saved_report_filters_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_report_filters"
  ADD CONSTRAINT "saved_report_filters_report_code_report_definitions_code_fk"
  FOREIGN KEY ("report_code") REFERENCES "public"."report_definitions"("code")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_report_filters_user_report_name_uq"
  ON "saved_report_filters" USING btree ("user_id", "report_code", "name");
--> statement-breakpoint
CREATE INDEX "saved_report_filters_user_report_created_idx"
  ON "saved_report_filters" USING btree ("user_id", "report_code", "created_at", "id");

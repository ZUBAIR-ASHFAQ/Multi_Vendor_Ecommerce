CREATE TABLE "notification_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(120) NOT NULL,
  "channel" varchar(20) NOT NULL,
  "subject_template" text,
  "body_template" text NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_templates_channel_check" CHECK ("channel" in ('in_app', 'email')),
  CONSTRAINT "notification_templates_status_check" CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "notification_templates_version_check" CHECK ("version" > 0),
  CONSTRAINT "notification_templates_code_normalized_check" CHECK ("code" = lower(btrim("code")) and "code" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "notification_templates_subject_not_blank_check" CHECK ("subject_template" is null or length(btrim("subject_template")) > 0),
  CONSTRAINT "notification_templates_body_not_blank_check" CHECK (length(btrim("body_template")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_code_channel_version_uq"
  ON "notification_templates" USING btree ("code", "channel", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_one_active_uq"
  ON "notification_templates" USING btree ("code", "channel")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "notification_templates_status_channel_idx"
  ON "notification_templates" USING btree ("status", "channel", "code");
--> statement-breakpoint

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" varchar(120) NOT NULL,
  "title" varchar(240) NOT NULL,
  "body" text NOT NULL,
  "data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_type_normalized_check" CHECK ("type" = lower(btrim("type")) and "type" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "notifications_title_not_blank_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "notifications_body_not_blank_check" CHECK (length(btrim("body")) > 0),
  CONSTRAINT "notifications_read_at_time_check" CHECK ("read_at" is null or "read_at" >= "created_at")
);
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx"
  ON "notifications" USING btree ("user_id", "read_at", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx"
  ON "notifications" USING btree ("user_id", "created_at", "id");
--> statement-breakpoint

CREATE TABLE "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid,
  "source_event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "channel" varchar(20) NOT NULL,
  "template_code" varchar(120) NOT NULL,
  "destination_masked" varchar(320) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "provider_ref" varchar(255),
  "last_error_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" in ('in_app', 'email')),
  CONSTRAINT "notification_deliveries_status_check" CHECK ("status" in ('queued', 'processing', 'sent', 'failed')),
  CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "notification_deliveries_template_code_normalized_check" CHECK ("template_code" = lower(btrim("template_code")) and "template_code" ~ '^[a-z][a-z0-9_.-]*$'),
  CONSTRAINT "notification_deliveries_destination_not_blank_check" CHECK (length(btrim("destination_masked")) > 0),
  CONSTRAINT "notification_deliveries_provider_ref_not_blank_check" CHECK ("provider_ref" is null or length(btrim("provider_ref")) > 0),
  CONSTRAINT "notification_deliveries_error_code_not_blank_check" CHECK ("last_error_code" is null or length(btrim("last_error_code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_source_event_id_outbox_events_id_fk"
  FOREIGN KEY ("source_event_id") REFERENCES "public"."outbox_events"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_event_user_channel_uq"
  ON "notification_deliveries" USING btree ("source_event_id", "user_id", "channel");
--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_created_idx"
  ON "notification_deliveries" USING btree ("user_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_created_idx"
  ON "notification_deliveries" USING btree ("status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx"
  ON "notification_deliveries" USING btree ("notification_id");
--> statement-breakpoint

CREATE TABLE "notification_preferences" (
  "user_id" uuid NOT NULL,
  "event_code" varchar(120) NOT NULL,
  "channel" varchar(20) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preferences_pk" PRIMARY KEY ("user_id", "event_code", "channel"),
  CONSTRAINT "notification_preferences_channel_check" CHECK ("channel" in ('in_app', 'email')),
  CONSTRAINT "notification_preferences_event_code_normalized_check" CHECK ("event_code" = lower(btrim("event_code")) and "event_code" ~ '^[a-z][a-z0-9_.-]*$')
);
--> statement-breakpoint
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notification_preferences_event_channel_idx"
  ON "notification_preferences" USING btree ("event_code", "channel", "enabled");

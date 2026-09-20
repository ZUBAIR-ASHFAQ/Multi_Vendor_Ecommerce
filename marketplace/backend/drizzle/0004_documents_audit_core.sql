-- Module 21 Documents & Audit Log persistence core.
-- This migration preserves the one existing Foundation audit ledger instead of creating duplicate history.

ALTER TABLE "audit_events" RENAME TO "audit_logs";
ALTER TABLE "audit_logs" RENAME COLUMN "actor_id" TO "actor_user_id";
ALTER TABLE "audit_logs" RENAME COLUMN "entity_type" TO "resource_type";
ALTER TABLE "audit_logs" RENAME COLUMN "entity_id" TO "resource_id";
ALTER TABLE "audit_logs" RENAME COLUMN "before" TO "before_json_redacted";
ALTER TABLE "audit_logs" RENAME COLUMN "after" TO "after_json_redacted";
ALTER TABLE "audit_logs" ADD COLUMN "seller_id" uuid;

ALTER INDEX "audit_events_entity_idx" RENAME TO "audit_logs_resource_idx";
ALTER INDEX "audit_events_actor_idx" RENAME TO "audit_logs_actor_idx";
ALTER INDEX "audit_events_request_idx" RENAME TO "audit_logs_request_idx";

CREATE INDEX "audit_logs_seller_idx"
  ON "audit_logs" USING btree ("seller_id", "created_at");
CREATE INDEX "audit_logs_action_idx"
  ON "audit_logs" USING btree ("action", "created_at");
CREATE INDEX "audit_logs_created_idx"
  ON "audit_logs" USING btree ("created_at");

-- Module 4 owns sellers, so audit_logs.seller_id intentionally has no seller foreign key yet.
-- Existing historical actor IDs also remain unfenced by a users FK to preserve Foundation audit history.

CREATE TABLE "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_provider" varchar(40) DEFAULT 's3_compatible' NOT NULL,
  "object_key" varchar(700) NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "checksum" varchar(128),
  "owner_user_id" uuid,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "files_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "files_storage_provider_check"
    CHECK ("storage_provider" in ('s3', 'r2', 's3_compatible')),
  CONSTRAINT "files_status_check"
    CHECK ("status" in ('pending', 'confirmed', 'failed')),
  CONSTRAINT "files_size_bytes_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "files_object_key_not_blank_check" CHECK (length(btrim("object_key")) > 0),
  CONSTRAINT "files_original_name_not_blank_check" CHECK (length(btrim("original_name")) > 0),
  CONSTRAINT "files_mime_type_not_blank_check" CHECK (length(btrim("mime_type")) > 0)
);

CREATE UNIQUE INDEX "files_object_key_uq"
  ON "files" USING btree ("object_key");
CREATE INDEX "files_owner_user_idx"
  ON "files" USING btree ("owner_user_id", "created_at");
CREATE INDEX "files_status_created_idx"
  ON "files" USING btree ("status", "created_at");

CREATE TABLE "file_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "file_id" uuid NOT NULL,
  "resource_type" varchar(100) NOT NULL,
  "resource_id" uuid NOT NULL,
  "purpose" varchar(100) NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "file_links_file_id_files_id_fk"
    FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE,
  CONSTRAINT "file_links_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "file_links_resource_type_not_blank_check"
    CHECK (length(btrim("resource_type")) > 0),
  CONSTRAINT "file_links_purpose_not_blank_check"
    CHECK (length(btrim("purpose")) > 0)
);

CREATE UNIQUE INDEX "file_links_resource_file_purpose_uq"
  ON "file_links" USING btree ("file_id", "resource_type", "resource_id", "purpose");
CREATE INDEX "file_links_file_idx"
  ON "file_links" USING btree ("file_id", "created_at");
CREATE INDEX "file_links_resource_idx"
  ON "file_links" USING btree ("resource_type", "resource_id", "created_at");
CREATE INDEX "file_links_created_by_idx"
  ON "file_links" USING btree ("created_by", "created_at");

-- Enforce the cross-module audit ledger as append-only at the database boundary.
CREATE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_prevent_update_delete
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

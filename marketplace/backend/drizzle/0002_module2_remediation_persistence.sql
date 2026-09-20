-- Module 2 persistence remediation.
-- This migration is append-only and upgrades the previously supported Module 2 schema.

ALTER TABLE "users"
  ADD COLUMN "account_type" varchar(30);

-- Existing Module 2 users were all treated as platform administrators by the old request context.
-- Preserve that historical behavior during upgrade, while new rows default safely to customer.
UPDATE "users"
SET "account_type" = 'platform_admin'
WHERE "account_type" IS NULL;

ALTER TABLE "users"
  ALTER COLUMN "account_type" SET DEFAULT 'customer',
  ALTER COLUMN "account_type" SET NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_account_type_check"
  CHECK ("account_type" in ('platform_admin', 'seller', 'customer'));

CREATE INDEX "users_account_type_status_idx"
  ON "users" USING btree ("account_type", "status");

ALTER TABLE "roles"
  ADD COLUMN "scope_type" varchar(30);

UPDATE "roles"
SET "scope_type" = 'platform'
WHERE "scope_type" IS NULL;

ALTER TABLE "roles"
  ALTER COLUMN "scope_type" SET DEFAULT 'platform',
  ALTER COLUMN "scope_type" SET NOT NULL;

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_scope_type_check"
  CHECK ("scope_type" in ('platform', 'seller', 'customer'));

CREATE INDEX "roles_scope_status_idx"
  ON "roles" USING btree ("scope_type", "status");

-- Module 4 owns the sellers table, so this UUID intentionally has no foreign key yet.
ALTER TABLE "user_roles"
  ADD COLUMN "seller_id" uuid;

CREATE INDEX "user_roles_seller_idx"
  ON "user_roles" USING btree ("seller_id", "user_id");

CREATE TABLE "platform_settings" (
  "key" varchar(120) PRIMARY KEY NOT NULL,
  "value_json" jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "platform_settings_key_normalized_check"
    CHECK ("key" = lower(btrim("key")) and "key" ~ '^[a-z][a-z0-9_.-]*$')
);

CREATE INDEX "platform_settings_updated_at_idx"
  ON "platform_settings" USING btree ("updated_at");

-- Replace raw browser metadata with a non-reversible fixed hash.
ALTER TABLE "auth_sessions"
  ADD COLUMN "user_agent_hash" varchar(64);

UPDATE "auth_sessions"
SET "user_agent_hash" = encode(digest("user_agent", 'sha256'), 'hex')
WHERE "user_agent" IS NOT NULL;

ALTER TABLE "auth_sessions"
  DROP COLUMN "user_agent";

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_agent_hash_check"
  CHECK (
    "user_agent_hash" IS NULL OR
    (length("user_agent_hash") = 64 AND "user_agent_hash" ~ '^[0-9a-f]{64}$')
  );

-- Repair Pass 2: align the persisted refresh-session contract with Module 2.
-- Historical migrations remain unchanged; this migration upgrades existing databases safely.

ALTER TABLE "auth_sessions" RENAME TO "refresh_sessions";

ALTER TABLE "refresh_sessions"
  ADD COLUMN "token_family_hash" varchar(64);

-- Legacy rows used a non-secret UUID family identifier. Hashing that identifier
-- preserves family grouping during upgrade without keeping the old raw family value.
UPDATE "refresh_sessions"
SET "token_family_hash" = encode(
  digest("family_id"::text, 'sha256'),
  'hex'
);

ALTER TABLE "refresh_sessions"
  ALTER COLUMN "token_family_hash" SET NOT NULL;

DROP INDEX IF EXISTS "auth_sessions_family_idx";

ALTER TABLE "refresh_sessions"
  DROP COLUMN "family_id";

ALTER INDEX IF EXISTS "auth_sessions_refresh_token_hash_uq"
  RENAME TO "refresh_sessions_refresh_token_hash_uq";
ALTER INDEX IF EXISTS "auth_sessions_user_active_idx"
  RENAME TO "refresh_sessions_user_active_idx";

ALTER TABLE "refresh_sessions"
  RENAME CONSTRAINT "auth_sessions_user_id_users_id_fk"
  TO "refresh_sessions_user_id_users_id_fk";
ALTER TABLE "refresh_sessions"
  RENAME CONSTRAINT "auth_sessions_refresh_hash_check"
  TO "refresh_sessions_refresh_hash_check";
ALTER TABLE "refresh_sessions"
  RENAME CONSTRAINT "auth_sessions_user_agent_hash_check"
  TO "refresh_sessions_user_agent_hash_check";
ALTER TABLE "refresh_sessions"
  RENAME CONSTRAINT "auth_sessions_expiry_check"
  TO "refresh_sessions_expiry_check";
ALTER TABLE "refresh_sessions"
  RENAME CONSTRAINT "auth_sessions_revoke_reason_check"
  TO "refresh_sessions_revoke_reason_check";

CREATE INDEX "refresh_sessions_token_family_hash_idx"
  ON "refresh_sessions" USING btree ("token_family_hash", "created_at");

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_token_family_hash_check"
  CHECK (
    length("token_family_hash") = 64
    AND "token_family_hash" ~ '^[0-9a-f]{64}$'
  );

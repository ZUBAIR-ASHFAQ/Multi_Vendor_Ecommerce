CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "password_hash" text NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "email_verified_at" timestamp with time zone,
  "password_changed_at" timestamp with time zone,
  "last_login_at" timestamp with time zone,
  "failed_login_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_status_check" CHECK ("status" in ('active', 'inactive', 'locked', 'pending')),
  CONSTRAINT "users_failed_login_attempts_check" CHECK ("failed_login_attempts" >= 0),
  CONSTRAINT "users_email_normalized_check" CHECK ("email" = lower(btrim("email")) and length("email") between 3 and 320),
  CONSTRAINT "users_display_name_not_blank_check" CHECK (length(btrim("display_name")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq"
  ON "users" USING btree ("email");
CREATE INDEX IF NOT EXISTS "users_status_locked_idx"
  ON "users" USING btree ("status", "locked_until");

CREATE TABLE IF NOT EXISTS "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "name" varchar(150) NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "roles_status_check" CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "roles_code_normalized_check" CHECK ("code" = lower(btrim("code")) and "code" ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT "roles_name_not_blank_check" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_uq"
  ON "roles" USING btree ("code");
CREATE INDEX IF NOT EXISTS "roles_status_system_idx"
  ON "roles" USING btree ("status", "is_system");

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(100) NOT NULL,
  "domain" varchar(50) NOT NULL,
  "description" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "permissions_code_normalized_check" CHECK ("code" = lower(btrim("code")) and "code" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  CONSTRAINT "permissions_domain_normalized_check" CHECK ("domain" = lower(btrim("domain")) and "domain" ~ '^[a-z][a-z0-9_]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_uq"
  ON "permissions" USING btree ("code");
CREATE INDEX IF NOT EXISTS "permissions_domain_idx"
  ON "permissions" USING btree ("domain", "code");

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  "assigned_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "role_permissions_pk" PRIMARY KEY ("role_id", "permission_id"),
  CONSTRAINT "role_permissions_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
  CONSTRAINT "role_permissions_permission_id_permissions_id_fk"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE,
  CONSTRAINT "role_permissions_assigned_by_users_id_fk"
    FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "role_permissions_permission_idx"
  ON "role_permissions" USING btree ("permission_id", "role_id");

CREATE TABLE IF NOT EXISTS "user_roles" (
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "assigned_by" uuid,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_roles_pk" PRIMARY KEY ("user_id", "role_id"),
  CONSTRAINT "user_roles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_roles_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT,
  CONSTRAINT "user_roles_assigned_by_users_id_fk"
    FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "user_roles_role_idx"
  ON "user_roles" USING btree ("role_id", "user_id");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "refresh_token_hash" varchar(64) NOT NULL,
  "family_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoke_reason" varchar(200),
  "ip_address" varchar(45),
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "auth_sessions_refresh_hash_check" CHECK (length("refresh_token_hash") = 64 and "refresh_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "auth_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "auth_sessions_revoke_reason_check" CHECK ("revoked_at" is not null or "revoke_reason" is null)
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_refresh_token_hash_uq"
  ON "auth_sessions" USING btree ("refresh_token_hash");
CREATE INDEX IF NOT EXISTS "auth_sessions_user_active_idx"
  ON "auth_sessions" USING btree ("user_id", "revoked_at", "expires_at");
CREATE INDEX IF NOT EXISTS "auth_sessions_family_idx"
  ON "auth_sessions" USING btree ("family_id", "created_at");

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "password_reset_tokens_hash_check" CHECK (length("token_hash") = 64 and "token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "password_reset_tokens_used_at_check" CHECK ("used_at" is null or "used_at" >= "created_at")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_uq"
  ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_expiry_idx"
  ON "password_reset_tokens" USING btree ("user_id", "expires_at", "used_at");

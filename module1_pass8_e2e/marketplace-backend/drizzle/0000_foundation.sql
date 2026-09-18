CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(100) NOT NULL,
  "key" varchar(200) NOT NULL,
  "request_hash" varchar(128) NOT NULL,
  "status" varchar(20) DEFAULT 'processing' NOT NULL,
  "response_status" integer,
  "response_body" jsonb,
  "locked_until" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idempotency_keys_status_check" CHECK ("status" in ('processing', 'completed', 'failed')),
  CONSTRAINT "idempotency_keys_response_status_check" CHECK ("response_status" is null or ("response_status" between 100 and 599))
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_scope_key_uq"
  ON "idempotency_keys" USING btree ("scope", "key");
CREATE INDEX IF NOT EXISTS "idempotency_keys_status_expires_idx"
  ON "idempotency_keys" USING btree ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(200) NOT NULL,
  "aggregate_type" varchar(100),
  "aggregate_id" varchar(200),
  "payload" jsonb NOT NULL,
  "headers" jsonb,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outbox_events_status_check" CHECK ("status" in ('pending', 'processing', 'published', 'failed')),
  CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX IF NOT EXISTS "outbox_events_dispatch_idx"
  ON "outbox_events" USING btree ("status", "available_at");
CREATE INDEX IF NOT EXISTS "outbox_events_aggregate_idx"
  ON "outbox_events" USING btree ("aggregate_type", "aggregate_id");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "actor_type" varchar(30) DEFAULT 'system' NOT NULL,
  "action" varchar(150) NOT NULL,
  "entity_type" varchar(100) NOT NULL,
  "entity_id" varchar(200),
  "request_id" varchar(100),
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_events_entity_idx"
  ON "audit_events" USING btree ("entity_type", "entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx"
  ON "audit_events" USING btree ("actor_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_request_idx"
  ON "audit_events" USING btree ("request_id");

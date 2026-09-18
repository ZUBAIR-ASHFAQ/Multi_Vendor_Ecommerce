-- Module 12 Pass 1: provider-neutral Payment persistence.
-- Raw Stripe webhook bytes, client secrets, card data, and provider secrets are intentionally not stored.

CREATE TABLE "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "provider" varchar(40) NOT NULL,
  "provider_payment_id" varchar(255),
  "currency" varchar(3) NOT NULL,
  "amount_authorized" numeric(18, 4) DEFAULT 0 NOT NULL,
  "amount_captured" numeric(18, 4) DEFAULT 0 NOT NULL,
  "amount_refunded" numeric(18, 4) DEFAULT 0 NOT NULL,
  "status" varchar(40) DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payments_provider_normalized_check"
    CHECK ("provider" = lower(btrim("provider")) and length("provider") > 0),
  CONSTRAINT "payments_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payments_amount_authorized_nonnegative_check" CHECK ("amount_authorized" >= 0),
  CONSTRAINT "payments_amount_captured_nonnegative_check" CHECK ("amount_captured" >= 0),
  CONSTRAINT "payments_amount_refunded_nonnegative_check" CHECK ("amount_refunded" >= 0),
  CONSTRAINT "payments_amount_refunded_not_over_captured_check"
    CHECK ("amount_refunded" <= "amount_captured"),
  CONSTRAINT "payments_status_check"
    CHECK ("status" in ('pending', 'processing', 'captured', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  CONSTRAINT "payments_idempotency_key_check"
    CHECK ("idempotency_key" is null or "idempotency_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uq" ON "payments" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("provider_payment_id");
--> statement-breakpoint
CREATE INDEX "payments_status_created_idx" ON "payments" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "payments_provider_status_created_idx" ON "payments" USING btree ("provider", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "payments_updated_idx" ON "payments" USING btree ("updated_at");
--> statement-breakpoint

CREATE TABLE "payment_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(40) NOT NULL,
  "provider_event_id" varchar(255) NOT NULL,
  "event_type" varchar(160) NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "status" varchar(40) DEFAULT 'received' NOT NULL,
  "error_code" varchar(120),
  CONSTRAINT "payment_webhook_events_provider_normalized_check"
    CHECK ("provider" = lower(btrim("provider")) and length("provider") > 0),
  CONSTRAINT "payment_webhook_events_event_id_not_blank_check"
    CHECK (length(btrim("provider_event_id")) > 0),
  CONSTRAINT "payment_webhook_events_event_type_not_blank_check"
    CHECK (length(btrim("event_type")) > 0),
  CONSTRAINT "payment_webhook_events_payload_hash_check"
    CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_webhook_events_status_check"
    CHECK ("status" in ('received', 'processing', 'processed', 'ignored', 'failed')),
  CONSTRAINT "payment_webhook_events_processed_at_check"
    CHECK ("processed_at" is null or "processed_at" >= "received_at"),
  CONSTRAINT "payment_webhook_events_error_code_check"
    CHECK ("error_code" is null or length(btrim("error_code")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_uq"
  ON "payment_webhook_events" USING btree ("provider", "provider_event_id");
--> statement-breakpoint
CREATE INDEX "payment_webhook_events_status_received_idx"
  ON "payment_webhook_events" USING btree ("status", "received_at");
--> statement-breakpoint
CREATE INDEX "payment_webhook_events_type_received_idx"
  ON "payment_webhook_events" USING btree ("event_type", "received_at");
--> statement-breakpoint

CREATE TABLE "payment_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "type" varchar(40) NOT NULL,
  "provider_txn_id" varchar(255),
  "amount" numeric(18, 4) NOT NULL,
  "status" varchar(40) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "raw_event_id" uuid,
  "source_key" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_transactions_type_check"
    CHECK ("type" in ('intent', 'authorize', 'capture', 'refund', 'failure')),
  CONSTRAINT "payment_transactions_status_check"
    CHECK ("status" in ('pending', 'succeeded', 'failed')),
  CONSTRAINT "payment_transactions_amount_nonnegative_check" CHECK ("amount" >= 0),
  CONSTRAINT "payment_transactions_provider_txn_not_blank_check"
    CHECK ("provider_txn_id" is null or length(btrim("provider_txn_id")) > 0),
  CONSTRAINT "payment_transactions_source_key_not_blank_check"
    CHECK ("source_key" is null or length(btrim("source_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_raw_event_id_payment_webhook_events_id_fk"
  FOREIGN KEY ("raw_event_id") REFERENCES "public"."payment_webhook_events"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_provider_txn_uq"
  ON "payment_transactions" USING btree ("provider_txn_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_source_key_uq"
  ON "payment_transactions" USING btree ("source_key");
--> statement-breakpoint
CREATE INDEX "payment_transactions_payment_occurred_idx"
  ON "payment_transactions" USING btree ("payment_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "payment_transactions_type_status_idx"
  ON "payment_transactions" USING btree ("type", "status", "occurred_at");
--> statement-breakpoint
CREATE INDEX "payment_transactions_raw_event_idx"
  ON "payment_transactions" USING btree ("raw_event_id");

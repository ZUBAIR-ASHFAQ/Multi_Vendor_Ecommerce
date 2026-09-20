-- Module 14 Pass 1: Returns, Refunds & Disputes persistence.
-- This pass creates only the base-guide tables, foreign keys, indexes, and structural checks.
-- Lifecycle values, reason codes, inspection values, and resolution values remain Pass 2 contract decisions.

CREATE TABLE "return_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_no" varchar(40) NOT NULL,
  "order_id" uuid NOT NULL,
  "seller_order_id" uuid NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "status" varchar(40) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  CONSTRAINT "return_requests_return_no_not_blank_check"
    CHECK (length(btrim("return_no")) > 0),
  CONSTRAINT "return_requests_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0),
  CONSTRAINT "return_requests_reason_code_normalized_check"
    CHECK ("reason_code" = lower(btrim("reason_code")) and length("reason_code") > 0),
  CONSTRAINT "return_requests_approved_at_check"
    CHECK ("approved_at" is null or "approved_at" >= "requested_at")
);
--> statement-breakpoint
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_customer_user_id_customer_profiles_user_id_fk"
  FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_seller_order_parent_fk"
  FOREIGN KEY ("seller_order_id", "order_id") REFERENCES "public"."seller_orders"("id", "order_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_return_no_uq"
  ON "return_requests" USING btree ("return_no");
--> statement-breakpoint
CREATE INDEX "return_requests_customer_status_requested_idx"
  ON "return_requests" USING btree ("customer_user_id", "status", "requested_at");
--> statement-breakpoint
CREATE INDEX "return_requests_seller_order_status_requested_idx"
  ON "return_requests" USING btree ("seller_order_id", "status", "requested_at");
--> statement-breakpoint
CREATE INDEX "return_requests_order_requested_idx"
  ON "return_requests" USING btree ("order_id", "requested_at");
--> statement-breakpoint

CREATE TABLE "return_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_request_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "item_condition" varchar(40),
  "resolution" varchar(60),
  "refund_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
  "restock_qty" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "return_items_quantity_positive_check"
    CHECK ("quantity" > 0),
  CONSTRAINT "return_items_refund_amount_nonnegative_check"
    CHECK ("refund_amount" >= 0),
  CONSTRAINT "return_items_restock_qty_nonnegative_check"
    CHECK ("restock_qty" >= 0),
  CONSTRAINT "return_items_restock_qty_not_over_quantity_check"
    CHECK ("restock_qty" <= "quantity"),
  CONSTRAINT "return_items_condition_normalized_check"
    CHECK ("item_condition" is null or ("item_condition" = lower(btrim("item_condition")) and length("item_condition") > 0)),
  CONSTRAINT "return_items_resolution_normalized_check"
    CHECK ("resolution" is null or ("resolution" = lower(btrim("resolution")) and length("resolution") > 0))
);
--> statement-breakpoint
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_return_request_id_return_requests_id_fk"
  FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk"
  FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "return_items_request_order_item_uq"
  ON "return_items" USING btree ("return_request_id", "order_item_id");
--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx"
  ON "return_items" USING btree ("order_item_id");
--> statement-breakpoint

CREATE TABLE "refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_request_id" uuid,
  "order_id" uuid NOT NULL,
  "payment_id" uuid NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(40) NOT NULL,
  "provider_ref" varchar(255),
  "idempotency_key" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refunds_amount_positive_check"
    CHECK ("amount" > 0),
  CONSTRAINT "refunds_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "refunds_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0),
  CONSTRAINT "refunds_provider_ref_not_blank_check"
    CHECK ("provider_ref" is null or length(btrim("provider_ref")) > 0),
  CONSTRAINT "refunds_idempotency_key_not_blank_check"
    CHECK (length(btrim("idempotency_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_return_request_id_return_requests_id_fk"
  FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key_uq"
  ON "refunds" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "refunds_return_request_created_idx"
  ON "refunds" USING btree ("return_request_id", "created_at");
--> statement-breakpoint
CREATE INDEX "refunds_order_created_idx"
  ON "refunds" USING btree ("order_id", "created_at");
--> statement-breakpoint
CREATE INDEX "refunds_payment_status_created_idx"
  ON "refunds" USING btree ("payment_id", "status", "created_at");
--> statement-breakpoint

CREATE TABLE "return_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_request_id" uuid NOT NULL,
  "from_status" varchar(40),
  "to_status" varchar(40) NOT NULL,
  "changed_by" uuid,
  "reason" text,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "return_status_history_from_status_normalized_check"
    CHECK ("from_status" is null or ("from_status" = lower(btrim("from_status")) and length("from_status") > 0)),
  CONSTRAINT "return_status_history_to_status_normalized_check"
    CHECK ("to_status" = lower(btrim("to_status")) and length("to_status") > 0),
  CONSTRAINT "return_status_history_reason_not_blank_check"
    CHECK ("reason" is null or length(btrim("reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "return_status_history"
  ADD CONSTRAINT "return_status_history_return_request_id_return_requests_id_fk"
  FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "return_status_history"
  ADD CONSTRAINT "return_status_history_changed_by_users_id_fk"
  FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "return_status_history_request_changed_idx"
  ON "return_status_history" USING btree ("return_request_id", "changed_at");
--> statement-breakpoint
CREATE INDEX "return_status_history_changed_by_idx"
  ON "return_status_history" USING btree ("changed_by");
--> statement-breakpoint

CREATE TABLE "dispute_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_request_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "visibility" varchar(40) NOT NULL,
  "note" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispute_notes_visibility_normalized_check"
    CHECK ("visibility" = lower(btrim("visibility")) and length("visibility") > 0),
  CONSTRAINT "dispute_notes_note_not_blank_check"
    CHECK (length(btrim("note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "dispute_notes"
  ADD CONSTRAINT "dispute_notes_return_request_id_return_requests_id_fk"
  FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dispute_notes"
  ADD CONSTRAINT "dispute_notes_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dispute_notes_request_created_idx"
  ON "dispute_notes" USING btree ("return_request_id", "created_at");
--> statement-breakpoint
CREATE INDEX "dispute_notes_actor_created_idx"
  ON "dispute_notes" USING btree ("actor_user_id", "created_at");

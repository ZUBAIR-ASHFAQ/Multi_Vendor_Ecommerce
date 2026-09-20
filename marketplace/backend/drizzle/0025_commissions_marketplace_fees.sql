-- Module 16 Pass 1: Commission rules, immutable rule snapshots, and append-only Commission ledger.
-- Rule precedence, commissionable basis, rounding, discount-funding allocation, and command identity remain service-contract decisions for later passes.

CREATE TABLE "commission_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "priority" integer NOT NULL,
  "scope_type" varchar(30) NOT NULL,
  "scope_id" uuid,
  "rate_percent" numeric(9, 6) NOT NULL,
  "fixed_fee" numeric(18, 4),
  "funding_rules_json" jsonb,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone,
  "status" varchar(30) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commission_rules_scope_type_check"
    CHECK ("scope_type" in ('default', 'seller', 'category', 'product')),
  CONSTRAINT "commission_rules_scope_shape_check"
    CHECK (("scope_type" = 'default' and "scope_id" is null) or ("scope_type" <> 'default' and "scope_id" is not null)),
  CONSTRAINT "commission_rules_rate_percent_check"
    CHECK ("rate_percent" >= 0 and "rate_percent" <= 100),
  CONSTRAINT "commission_rules_fixed_fee_nonnegative_check"
    CHECK ("fixed_fee" is null or "fixed_fee" >= 0),
  CONSTRAINT "commission_rules_date_range_check"
    CHECK ("end_at" is null or "end_at" > "start_at"),
  CONSTRAINT "commission_rules_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0)
);
--> statement-breakpoint
CREATE INDEX "commission_rules_resolution_idx"
  ON "commission_rules" USING btree ("scope_type", "scope_id", "status", "start_at", "end_at", "priority");
--> statement-breakpoint
CREATE INDEX "commission_rules_status_start_idx"
  ON "commission_rules" USING btree ("status", "start_at");
--> statement-breakpoint

CREATE TABLE "commission_rule_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_item_id" uuid NOT NULL,
  "rule_id" uuid,
  "rate_percent" numeric(9, 6) NOT NULL,
  "fixed_fee" numeric(18, 4),
  "basis_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commission_rule_snapshots_rate_percent_check"
    CHECK ("rate_percent" >= 0 and "rate_percent" <= 100),
  CONSTRAINT "commission_rule_snapshots_fixed_fee_nonnegative_check"
    CHECK ("fixed_fee" is null or "fixed_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commission_rule_snapshots"
  ADD CONSTRAINT "commission_rule_snapshots_order_item_id_order_items_id_fk"
  FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commission_rule_snapshots"
  ADD CONSTRAINT "commission_rule_snapshots_rule_id_commission_rules_id_fk"
  FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rule_snapshots_order_item_uq"
  ON "commission_rule_snapshots" USING btree ("order_item_id");
--> statement-breakpoint
CREATE INDEX "commission_rule_snapshots_rule_idx"
  ON "commission_rule_snapshots" USING btree ("rule_id");
--> statement-breakpoint

CREATE TABLE "commission_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "seller_order_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "type" varchar(30) NOT NULL,
  "gross_amount" numeric(18, 4) NOT NULL,
  "commission_amount" numeric(18, 4) NOT NULL,
  "seller_net_amount" numeric(18, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "source_key" varchar(255) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commission_entries_type_check"
    CHECK ("type" in ('sale', 'refund', 'adjustment')),
  CONSTRAINT "commission_entries_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "commission_entries_source_key_not_blank_check"
    CHECK (length(btrim("source_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_seller_order_id_seller_orders_id_fk"
  FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commission_entries"
  ADD CONSTRAINT "commission_entries_order_item_id_order_items_id_fk"
  FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_entries_source_key_uq"
  ON "commission_entries" USING btree ("source_key");
--> statement-breakpoint
CREATE INDEX "commission_entries_seller_occurred_idx"
  ON "commission_entries" USING btree ("seller_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "commission_entries_seller_order_occurred_idx"
  ON "commission_entries" USING btree ("seller_order_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "commission_entries_order_item_occurred_idx"
  ON "commission_entries" USING btree ("order_item_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "commission_entries_type_occurred_idx"
  ON "commission_entries" USING btree ("type", "occurred_at");

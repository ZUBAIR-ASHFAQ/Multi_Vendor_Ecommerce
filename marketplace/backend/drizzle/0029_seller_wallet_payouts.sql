-- Module 17 Pass 1: Seller Wallet & Payouts persistence.
-- This pass creates only the five base-guide tables, foreign keys, indexes, and structural checks.
-- Payout lifecycle values, provider behavior, balance-bucket values, and settlement rules
-- remain later contract decisions.

CREATE TABLE "seller_wallets" (
  "seller_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "pending_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
  "available_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
  "held_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
  "negative_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "seller_wallets_pk" PRIMARY KEY ("seller_id", "currency"),
  CONSTRAINT "seller_wallets_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "seller_wallets_pending_nonnegative_check"
    CHECK ("pending_balance" >= 0),
  CONSTRAINT "seller_wallets_available_nonnegative_check"
    CHECK ("available_balance" >= 0),
  CONSTRAINT "seller_wallets_held_nonnegative_check"
    CHECK ("held_balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "seller_wallets"
  ADD CONSTRAINT "seller_wallets_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "seller_wallets_updated_idx"
  ON "seller_wallets" USING btree ("updated_at");
--> statement-breakpoint

CREATE TABLE "seller_wallet_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "currency" varchar(3) NOT NULL,
  "type" varchar(40) NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "balance_bucket" varchar(30) NOT NULL,
  "source_type" varchar(50) NOT NULL,
  "source_id" uuid NOT NULL,
  "source_key" varchar(255) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "seller_wallet_entries_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "seller_wallet_entries_type_normalized_check"
    CHECK ("type" = lower(btrim("type")) and length("type") > 0),
  CONSTRAINT "seller_wallet_entries_bucket_normalized_check"
    CHECK ("balance_bucket" = lower(btrim("balance_bucket")) and length("balance_bucket") > 0),
  CONSTRAINT "seller_wallet_entries_source_type_normalized_check"
    CHECK ("source_type" = lower(btrim("source_type")) and length("source_type") > 0),
  CONSTRAINT "seller_wallet_entries_amount_nonzero_check"
    CHECK ("amount" <> 0),
  CONSTRAINT "seller_wallet_entries_source_key_not_blank_check"
    CHECK (length(btrim("source_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "seller_wallet_entries"
  ADD CONSTRAINT "seller_wallet_entries_wallet_fk"
  FOREIGN KEY ("seller_id", "currency") REFERENCES "public"."seller_wallets"("seller_id", "currency")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "seller_wallet_entries_source_key_uq"
  ON "seller_wallet_entries" USING btree ("source_key");
--> statement-breakpoint
CREATE INDEX "seller_wallet_entries_wallet_occurred_idx"
  ON "seller_wallet_entries" USING btree ("seller_id", "currency", "occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "seller_wallet_entries_source_idx"
  ON "seller_wallet_entries" USING btree ("source_type", "source_id");
--> statement-breakpoint
CREATE INDEX "seller_wallet_entries_bucket_occurred_idx"
  ON "seller_wallet_entries" USING btree ("seller_id", "currency", "balance_bucket", "occurred_at");
--> statement-breakpoint

CREATE TABLE "payout_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "provider_type" varchar(40) NOT NULL,
  "masked_details" varchar(255) NOT NULL,
  "provider_account_ref" varchar(255) NOT NULL,
  "status" varchar(30) NOT NULL,
  "verified_at" timestamp with time zone,
  CONSTRAINT "payout_accounts_provider_type_normalized_check"
    CHECK ("provider_type" = lower(btrim("provider_type")) and length("provider_type") > 0),
  CONSTRAINT "payout_accounts_masked_details_not_blank_check"
    CHECK (length(btrim("masked_details")) > 0),
  CONSTRAINT "payout_accounts_provider_ref_not_blank_check"
    CHECK (length(btrim("provider_account_ref")) > 0),
  CONSTRAINT "payout_accounts_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0)
);
--> statement-breakpoint
ALTER TABLE "payout_accounts"
  ADD CONSTRAINT "payout_accounts_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_id_seller_uq"
  ON "payout_accounts" USING btree ("id", "seller_id");
--> statement-breakpoint
CREATE INDEX "payout_accounts_seller_status_idx"
  ON "payout_accounts" USING btree ("seller_id", "status");
--> statement-breakpoint
CREATE INDEX "payout_accounts_provider_type_idx"
  ON "payout_accounts" USING btree ("provider_type");
--> statement-breakpoint

CREATE TABLE "payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payout_no" varchar(40) NOT NULL,
  "seller_id" uuid NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency" varchar(3) NOT NULL,
  "account_id" uuid NOT NULL,
  "status" varchar(40) NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "provider_ref" varchar(255),
  CONSTRAINT "payouts_payout_no_not_blank_check"
    CHECK (length(btrim("payout_no")) > 0),
  CONSTRAINT "payouts_amount_positive_check"
    CHECK ("amount" > 0),
  CONSTRAINT "payouts_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payouts_status_normalized_check"
    CHECK ("status" = lower(btrim("status")) and length("status") > 0),
  CONSTRAINT "payouts_processed_at_check"
    CHECK ("processed_at" is null or "processed_at" >= "requested_at"),
  CONSTRAINT "payouts_provider_ref_not_blank_check"
    CHECK ("provider_ref" is null or length(btrim("provider_ref")) > 0)
);
--> statement-breakpoint
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_wallet_fk"
  FOREIGN KEY ("seller_id", "currency") REFERENCES "public"."seller_wallets"("seller_id", "currency")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_account_seller_fk"
  FOREIGN KEY ("account_id", "seller_id") REFERENCES "public"."payout_accounts"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_payout_no_uq"
  ON "payouts" USING btree ("payout_no");
--> statement-breakpoint
CREATE INDEX "payouts_seller_status_requested_idx"
  ON "payouts" USING btree ("seller_id", "status", "requested_at");
--> statement-breakpoint
CREATE INDEX "payouts_account_requested_idx"
  ON "payouts" USING btree ("account_id", "requested_at");
--> statement-breakpoint
CREATE INDEX "payouts_status_requested_idx"
  ON "payouts" USING btree ("status", "requested_at");
--> statement-breakpoint

CREATE TABLE "payout_allocations" (
  "payout_id" uuid NOT NULL,
  "wallet_entry_id" uuid NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  CONSTRAINT "payout_allocations_pk" PRIMARY KEY ("payout_id", "wallet_entry_id"),
  CONSTRAINT "payout_allocations_amount_positive_check"
    CHECK ("amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payout_allocations"
  ADD CONSTRAINT "payout_allocations_payout_id_payouts_id_fk"
  FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payout_allocations"
  ADD CONSTRAINT "payout_allocations_wallet_entry_id_seller_wallet_entries_id_fk"
  FOREIGN KEY ("wallet_entry_id") REFERENCES "public"."seller_wallet_entries"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payout_allocations_wallet_entry_idx"
  ON "payout_allocations" USING btree ("wallet_entry_id");

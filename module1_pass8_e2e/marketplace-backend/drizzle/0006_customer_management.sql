-- Module 3 Customer Management database foundation.
-- This migration is append-only and upgrades the supported Module 21 schema.

CREATE TABLE "customer_profiles" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "phone" varchar(32),
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "marketing_opt_in" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_profiles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_profiles_status_check"
    CHECK ("status" in ('active', 'inactive')),
  CONSTRAINT "customer_profiles_display_name_not_blank_check"
    CHECK (length(btrim("display_name")) > 0),
  CONSTRAINT "customer_profiles_phone_not_blank_check"
    CHECK ("phone" is null or length(btrim("phone")) > 0)
);

CREATE INDEX "customer_profiles_status_created_idx"
  ON "customer_profiles" USING btree ("status", "created_at");

-- Existing registered customer identities receive exactly one commerce profile.
-- Authentication status remains authoritative in users; customer profile starts as usable commerce data.
INSERT INTO "customer_profiles"
  ("user_id", "display_name", "phone", "status", "marketing_opt_in", "created_at", "updated_at")
SELECT
  "id",
  "display_name",
  NULL,
  'active',
  false,
  "created_at",
  "updated_at"
FROM "users"
WHERE "account_type" = 'customer'
ON CONFLICT ("user_id") DO NOTHING;

CREATE TABLE "customer_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "label" varchar(100) NOT NULL,
  "recipient_name" varchar(200) NOT NULL,
  "phone" varchar(32) NOT NULL,
  "line1" varchar(255) NOT NULL,
  "line2" varchar(255),
  "city" varchar(120) NOT NULL,
  "region" varchar(120) NOT NULL,
  "postal_code" varchar(32),
  "country_code" varchar(2) NOT NULL,
  "is_default_shipping" boolean DEFAULT false NOT NULL,
  "is_default_billing" boolean DEFAULT false NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_addresses_customer_profile_fk"
    FOREIGN KEY ("customer_user_id") REFERENCES "customer_profiles"("user_id") ON DELETE RESTRICT,
  CONSTRAINT "customer_addresses_status_check"
    CHECK ("status" in ('active', 'archived')),
  CONSTRAINT "customer_addresses_archived_defaults_check"
    CHECK ("status" = 'active' or ("is_default_shipping" = false and "is_default_billing" = false)),
  CONSTRAINT "customer_addresses_label_not_blank_check"
    CHECK (length(btrim("label")) > 0),
  CONSTRAINT "customer_addresses_recipient_name_not_blank_check"
    CHECK (length(btrim("recipient_name")) > 0),
  CONSTRAINT "customer_addresses_phone_not_blank_check"
    CHECK (length(btrim("phone")) > 0),
  CONSTRAINT "customer_addresses_line1_not_blank_check"
    CHECK (length(btrim("line1")) > 0),
  CONSTRAINT "customer_addresses_city_not_blank_check"
    CHECK (length(btrim("city")) > 0),
  CONSTRAINT "customer_addresses_region_not_blank_check"
    CHECK (length(btrim("region")) > 0),
  CONSTRAINT "customer_addresses_line2_not_blank_check"
    CHECK ("line2" is null or length(btrim("line2")) > 0),
  CONSTRAINT "customer_addresses_postal_code_not_blank_check"
    CHECK ("postal_code" is null or length(btrim("postal_code")) > 0),
  CONSTRAINT "customer_addresses_country_code_check"
    CHECK ("country_code" = upper(btrim("country_code")) and "country_code" ~ '^[A-Z]{2}$')
);

CREATE INDEX "customer_addresses_customer_status_idx"
  ON "customer_addresses" USING btree ("customer_user_id", "status", "created_at");

CREATE UNIQUE INDEX "customer_addresses_default_shipping_uq"
  ON "customer_addresses" USING btree ("customer_user_id")
  WHERE "status" = 'active' AND "is_default_shipping" = true;

CREATE UNIQUE INDEX "customer_addresses_default_billing_uq"
  ON "customer_addresses" USING btree ("customer_user_id")
  WHERE "status" = 'active' AND "is_default_billing" = true;

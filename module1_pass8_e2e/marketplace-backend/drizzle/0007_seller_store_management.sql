-- Module 4 Seller & Store Management database foundation.
-- This migration is append-only and upgrades the supported Module 3 schema.

CREATE TABLE "seller_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "applicant_user_id" uuid NOT NULL,
  "payload_json" jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'submitted' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "seller_applications_applicant_user_id_users_id_fk"
    FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "seller_applications_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "seller_applications_status_check"
    CHECK ("status" in ('submitted', 'approved', 'rejected')),
  CONSTRAINT "seller_applications_payload_object_check"
    CHECK (jsonb_typeof("payload_json") = 'object'),
  CONSTRAINT "seller_applications_review_state_check"
    CHECK (
      ("status" = 'submitted' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "reason" IS NULL)
      OR ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "reason" IS NULL)
      OR ("status" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length(btrim("reason")) > 0)
    )
);

CREATE UNIQUE INDEX "seller_applications_open_applicant_uq"
  ON "seller_applications" USING btree ("applicant_user_id")
  WHERE "status" = 'submitted';

CREATE INDEX "seller_applications_status_created_idx"
  ON "seller_applications" USING btree ("status", "created_at");

CREATE INDEX "seller_applications_applicant_created_idx"
  ON "seller_applications" USING btree ("applicant_user_id", "created_at");

CREATE INDEX "seller_applications_reviewer_idx"
  ON "seller_applications" USING btree ("reviewed_by", "reviewed_at");

CREATE TABLE "sellers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "legal_name" varchar(220) NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "tax_id" varchar(120),
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "approval_status" varchar(20) DEFAULT 'approved' NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sellers_owner_user_id_users_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "sellers_status_check"
    CHECK ("status" in ('active', 'suspended')),
  CONSTRAINT "sellers_approval_status_check"
    CHECK ("approval_status" = 'approved'),
  CONSTRAINT "sellers_legal_name_not_blank_check"
    CHECK (length(btrim("legal_name")) > 0),
  CONSTRAINT "sellers_display_name_not_blank_check"
    CHECK (length(btrim("display_name")) > 0),
  CONSTRAINT "sellers_tax_id_not_blank_check"
    CHECK ("tax_id" IS NULL OR length(btrim("tax_id")) > 0)
);

CREATE UNIQUE INDEX "sellers_owner_user_uq"
  ON "sellers" USING btree ("owner_user_id");

CREATE INDEX "sellers_status_approval_idx"
  ON "sellers" USING btree ("status", "approval_status", "created_at");

CREATE TABLE "stores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "slug" varchar(160) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "logo_file_id" uuid,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "default_currency" varchar(3) NOT NULL,
  "support_email" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stores_seller_id_sellers_id_fk"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT,
  CONSTRAINT "stores_logo_file_id_files_id_fk"
    FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE SET NULL,
  CONSTRAINT "stores_status_check"
    CHECK ("status" in ('active', 'inactive', 'suspended')),
  CONSTRAINT "stores_slug_normalized_check"
    CHECK ("slug" = lower(btrim("slug")) AND "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "stores_name_not_blank_check"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "stores_description_not_blank_check"
    CHECK ("description" IS NULL OR length(btrim("description")) > 0),
  CONSTRAINT "stores_currency_check"
    CHECK ("default_currency" = upper(btrim("default_currency")) AND "default_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "stores_support_email_normalized_check"
    CHECK (
      "support_email" IS NULL
      OR ("support_email" = lower(btrim("support_email")) AND length("support_email") BETWEEN 3 AND 320)
    )
);

CREATE UNIQUE INDEX "stores_slug_uq"
  ON "stores" USING btree ("slug");

CREATE INDEX "stores_seller_status_idx"
  ON "stores" USING btree ("seller_id", "status", "created_at");

CREATE INDEX "stores_logo_file_idx"
  ON "stores" USING btree ("logo_file_id");

CREATE TABLE "seller_staff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "seller_staff_seller_id_sellers_id_fk"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT,
  CONSTRAINT "seller_staff_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "seller_staff_status_check"
    CHECK ("status" in ('active', 'inactive'))
);

CREATE UNIQUE INDEX "seller_staff_seller_user_uq"
  ON "seller_staff" USING btree ("seller_id", "user_id");

CREATE INDEX "seller_staff_user_status_idx"
  ON "seller_staff" USING btree ("user_id", "status", "seller_id");

CREATE INDEX "seller_staff_seller_status_idx"
  ON "seller_staff" USING btree ("seller_id", "status", "joined_at");

-- Pre-Module-4 seller role scopes were placeholders because no seller master existed.
-- Refuse to attach the new FK if such data is present so an operator can map it deliberately.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user_roles" WHERE "seller_id" IS NOT NULL) THEN
    RAISE EXCEPTION
      'Module 4 migration cannot attach user_roles.seller_id FK while pre-Module-4 seller scopes exist; map or remove placeholder scopes before retrying';
  END IF;
END
$$;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_seller_id_sellers_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT;

-- Module 4 store logos need a semantic object-storage purpose. Keep both file and link checks aligned.
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";
ALTER TABLE "files"
  ADD CONSTRAINT "files_purpose_check"
  CHECK ("purpose" in ('product_media', 'seller_verification', 'store_asset', 'report_export', 'operational_evidence'));

ALTER TABLE "file_links" DROP CONSTRAINT "file_links_purpose_check";
ALTER TABLE "file_links"
  ADD CONSTRAINT "file_links_purpose_check"
  CHECK ("purpose" in ('product_media', 'seller_verification', 'store_asset', 'report_export', 'operational_evidence'));

ALTER TABLE "shipping_methods"
  ADD COLUMN "currency" varchar(3);
--> statement-breakpoint
UPDATE "shipping_methods" AS shipping_method
   SET "currency" = upper(btrim(platform_setting."value_json" #>> '{}'))
  FROM "platform_settings" AS platform_setting
 WHERE shipping_method."currency" IS NULL
   AND platform_setting."key" = 'commerce.default_currency'
   AND jsonb_typeof(platform_setting."value_json") = 'string'
   AND upper(btrim(platform_setting."value_json" #>> '{}')) ~ '^[A-Z]{3}$';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "shipping_methods"
     WHERE "currency" IS NULL
  ) THEN
    RAISE EXCEPTION 'Shipping method currency cannot be inferred. Configure commerce.default_currency or migrate existing Shipping Core rows explicitly.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "shipping_methods"
     WHERE "pricing_type" <> 'flat'
        OR "status" NOT IN ('active', 'inactive')
  ) THEN
    RAISE EXCEPTION 'Existing Shipping Core rows must use pricing_type=flat and status active/inactive before applying Requirements Patch 0003.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "shipping_methods"
  ALTER COLUMN "currency" SET NOT NULL,
  DROP CONSTRAINT "shipping_methods_pricing_type_not_blank_check",
  DROP CONSTRAINT "shipping_methods_status_not_blank_check";
--> statement-breakpoint
ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_pricing_type_check"
    CHECK ("pricing_type" = 'flat'),
  ADD CONSTRAINT "shipping_methods_currency_check"
    CHECK ("currency" = upper(btrim("currency")) and "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "shipping_methods_status_check"
    CHECK ("status" in ('active', 'inactive'));
--> statement-breakpoint
CREATE INDEX "shipping_methods_currency_status_idx"
  ON "shipping_methods" USING btree ("currency", "status");

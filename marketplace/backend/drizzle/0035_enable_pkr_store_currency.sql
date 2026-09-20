-- Ensure the seller-store currency flow has a valid marketplace default and includes PKR.
-- The supported-currency setting remains authoritative for stores, products, checkout,
-- shipping and payments; existing configured currencies are preserved.
INSERT INTO "platform_settings" ("key", "value_json")
VALUES ('commerce.default_currency', '"USD"'::jsonb)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "platform_settings" AS current_setting ("key", "value_json")
VALUES ('commerce.supported_currencies', '["PKR", "USD"]'::jsonb)
ON CONFLICT ("key") DO UPDATE
SET "value_json" = (
  SELECT jsonb_agg(currency ORDER BY currency)
  FROM (
    SELECT DISTINCT jsonb_array_elements_text(current_setting."value_json") AS currency
    UNION
    SELECT 'PKR'::text AS currency
    UNION
    SELECT default_setting."value_json" #>> '{}' AS currency
    FROM "platform_settings" AS default_setting
    WHERE default_setting."key" = 'commerce.default_currency'
  ) AS supported
  WHERE currency ~ '^[A-Z]{3}$'
),
"updated_at" = now()
WHERE jsonb_typeof(current_setting."value_json") = 'array'
  AND (
    NOT (current_setting."value_json" ? 'PKR')
    OR NOT (
      current_setting."value_json" ? (
        SELECT default_setting."value_json" #>> '{}'
        FROM "platform_settings" AS default_setting
        WHERE default_setting."key" = 'commerce.default_currency'
      )
    )
  );

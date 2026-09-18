-- Module 6 Pass 1 integrity remediation.
-- This migration is append-only: 0009 remains unchanged.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "products"
     GROUP BY "slug"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Module 6 integrity migration blocked: product slugs must be globally unique for GET /api/v1/products/:slug';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "products" p
      JOIN "stores" s ON s."id" = p."store_id"
     WHERE s."seller_id" <> p."seller_id"
  ) THEN
    RAISE EXCEPTION 'Module 6 integrity migration blocked: a product references a store owned by another seller';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "product_variants"
     WHERE "sku" <> btrim("sku")
  ) THEN
    RAISE EXCEPTION 'Module 6 integrity migration blocked: existing SKU values must not contain leading or trailing whitespace';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "product_variants" pv
      JOIN "products" p ON p."id" = pv."product_id"
     GROUP BY p."seller_id", p."store_id", pv."sku"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Module 6 integrity migration blocked: duplicate SKU exists inside one seller/store scope';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "product_attribute_values" pav
      JOIN "attribute_values" av ON av."id" = pav."value_id"
     WHERE pav."value_id" IS NOT NULL
       AND av."attribute_id" <> pav."attribute_id"
  ) THEN
    RAISE EXCEPTION 'Module 6 integrity migration blocked: an attribute value belongs to another attribute';
  END IF;
END;
$$;
--> statement-breakpoint
DROP INDEX "products_store_slug_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "stores_id_seller_uq" ON "stores" USING btree ("id", "seller_id");
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_store_seller_fk"
  FOREIGN KEY ("store_id", "seller_id")
  REFERENCES "public"."stores"("id", "seller_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_sku_normalized_check"
  CHECK ("sku" = btrim("sku"));
--> statement-breakpoint
CREATE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");
--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_values_id_attribute_uq"
  ON "attribute_values" USING btree ("id", "attribute_id");
--> statement-breakpoint
ALTER TABLE "product_attribute_values"
  DROP CONSTRAINT "product_attribute_values_value_id_attribute_values_id_fk";
--> statement-breakpoint
ALTER TABLE "product_attribute_values"
  ADD CONSTRAINT "product_attribute_values_value_attribute_fk"
  FOREIGN KEY ("value_id", "attribute_id")
  REFERENCES "public"."attribute_values"("id", "attribute_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Enforces seller/store-scoped SKU uniqueness and serializes competing SKU writes.
CREATE OR REPLACE FUNCTION enforce_product_variant_sku_scope()
RETURNS trigger AS $$
DECLARE
  owner_seller_id uuid;
  owner_store_id uuid;
BEGIN
  SELECT p."seller_id", p."store_id"
    INTO owner_seller_id, owner_store_id
    FROM "products" p
   WHERE p."id" = NEW."product_id";

  IF owner_seller_id IS NULL OR owner_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize competing writes for the same seller/store/SKU combination.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      owner_seller_id::text || ':' || owner_store_id::text || ':' || NEW."sku",
      0
    )
  );

  IF EXISTS (
    SELECT 1
      FROM "product_variants" pv
      JOIN "products" p ON p."id" = pv."product_id"
     WHERE p."seller_id" = owner_seller_id
       AND p."store_id" = owner_store_id
       AND pv."sku" = NEW."sku"
       AND pv."id" IS DISTINCT FROM NEW."id"
  ) THEN
    RAISE unique_violation
      USING MESSAGE = 'SKU already exists in this seller/store scope',
            CONSTRAINT = 'product_variants_seller_store_sku_uq';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "product_variants_seller_store_sku_trigger"
BEFORE INSERT OR UPDATE OF "product_id", "sku" ON "product_variants"
FOR EACH ROW EXECUTE FUNCTION enforce_product_variant_sku_scope();

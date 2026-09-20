CREATE TABLE "inventory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "on_hand_qty" integer DEFAULT 0 NOT NULL,
  "reserved_qty" integer DEFAULT 0 NOT NULL,
  "reorder_level" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_items_on_hand_nonnegative_check" CHECK ("on_hand_qty" >= 0),
  CONSTRAINT "inventory_items_reserved_nonnegative_check" CHECK ("reserved_qty" >= 0),
  CONSTRAINT "inventory_items_reserved_not_over_on_hand_check" CHECK ("reserved_qty" <= "on_hand_qty"),
  CONSTRAINT "inventory_items_reorder_level_check" CHECK ("reorder_level" is null or "reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "movement_type" varchar(30) NOT NULL,
  "quantity_delta" integer NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "source_id" uuid,
  "idempotency_key" varchar(200) NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor_user_id" uuid,
  CONSTRAINT "stock_movements_type_check" CHECK ("movement_type" in ('adjustment', 'reserve', 'release', 'ship', 'restock')),
  CONSTRAINT "stock_movements_quantity_nonzero_check" CHECK ("quantity_delta" <> 0),
  CONSTRAINT "stock_movements_source_type_not_blank_check" CHECK (length(btrim("source_type")) > 0),
  CONSTRAINT "stock_movements_idempotency_key_normalized_check" CHECK ("idempotency_key" = btrim("idempotency_key") and length("idempotency_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "variant_id" uuid NOT NULL,
  "customer_user_id" uuid NOT NULL,
  "order_attempt_id" uuid,
  "qty" integer NOT NULL,
  "status" varchar(20) DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "source_key" varchar(200) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stock_reservations_qty_positive_check" CHECK ("qty" > 0),
  CONSTRAINT "stock_reservations_status_check" CHECK ("status" in ('reserved', 'committed', 'released', 'consumed', 'expired')),
  CONSTRAINT "stock_reservations_source_key_normalized_check" CHECK ("source_key" = btrim("source_key") and length("source_key") > 0),
  CONSTRAINT "stock_reservations_expiry_after_creation_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_store_seller_fk" FOREIGN KEY ("store_id","seller_id") REFERENCES "public"."stores"("id","seller_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_customer_user_id_customer_profiles_user_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_profiles"("user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_store_variant_uq" ON "inventory_items" USING btree ("store_id","variant_id");
--> statement-breakpoint
CREATE INDEX "inventory_items_seller_store_idx" ON "inventory_items" USING btree ("seller_id","store_id");
--> statement-breakpoint
CREATE INDEX "inventory_items_variant_idx" ON "inventory_items" USING btree ("variant_id");
--> statement-breakpoint
CREATE INDEX "inventory_items_reorder_idx" ON "inventory_items" USING btree ("seller_id","store_id","reorder_level") WHERE "reorder_level" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_idempotency_key_uq" ON "stock_movements" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "stock_movements_item_occurred_idx" ON "stock_movements" USING btree ("inventory_item_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "stock_movements_source_idx" ON "stock_movements" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE INDEX "stock_movements_actor_idx" ON "stock_movements" USING btree ("actor_user_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_source_key_uq" ON "stock_reservations" USING btree ("source_key");
--> statement-breakpoint
CREATE INDEX "stock_reservations_variant_status_expiry_idx" ON "stock_reservations" USING btree ("variant_id","status","expires_at");
--> statement-breakpoint
CREATE INDEX "stock_reservations_customer_status_idx" ON "stock_reservations" USING btree ("customer_user_id","status");
--> statement-breakpoint
CREATE INDEX "stock_reservations_order_attempt_idx" ON "stock_reservations" USING btree ("order_attempt_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_inventory_item_variant_scope()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "product_variants" pv
      JOIN "products" p ON p."id" = pv."product_id"
     WHERE pv."id" = NEW."variant_id"
       AND p."seller_id" = NEW."seller_id"
       AND p."store_id" = NEW."store_id"
  ) THEN
    RAISE EXCEPTION 'inventory item variant does not belong to the seller/store scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "inventory_items_variant_scope_trigger"
BEFORE INSERT OR UPDATE OF "seller_id", "store_id", "variant_id" ON "inventory_items"
FOR EACH ROW EXECUTE FUNCTION enforce_inventory_item_variant_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only_trigger"
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();

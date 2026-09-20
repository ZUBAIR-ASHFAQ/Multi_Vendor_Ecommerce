-- Module 13 Shipping & Fulfillment Completion Pass 1.
-- Adds immutable Shipment allocation/history persistence and narrows Order fulfillment status
-- to the values approved by Requirements Patch 0008. Historical rows are never rewritten.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "orders"
     WHERE "fulfillment_status" NOT IN ('unfulfilled', 'partially_fulfilled', 'fulfilled')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Module 13 fulfillment requires orders.fulfillment_status to be unfulfilled, partially_fulfilled, or fulfilled before migration.';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fulfillment_status_check"
  CHECK ("fulfillment_status" IN ('unfulfilled', 'partially_fulfilled', 'fulfilled'));
--> statement-breakpoint

CREATE TABLE "shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_order_id" uuid NOT NULL,
  "shipment_no" varchar(40) NOT NULL,
  "carrier" varchar(120),
  "service_level" varchar(120),
  "tracking_no" varchar(200),
  "status" varchar(20) DEFAULT 'created' NOT NULL,
  "shipped_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipments_number_matches_id_check"
    CHECK ("shipment_no" = 'SHP-' || upper(replace("id"::text, '-', ''))),
  CONSTRAINT "shipments_status_check"
    CHECK ("status" IN ('created', 'shipped', 'delivered')),
  CONSTRAINT "shipments_carrier_not_blank_check"
    CHECK ("carrier" IS NULL OR length(btrim("carrier")) > 0),
  CONSTRAINT "shipments_service_level_not_blank_check"
    CHECK ("service_level" IS NULL OR length(btrim("service_level")) > 0),
  CONSTRAINT "shipments_tracking_no_not_blank_check"
    CHECK ("tracking_no" IS NULL OR length(btrim("tracking_no")) > 0),
  CONSTRAINT "shipments_tracking_required_after_ship_check"
    CHECK ("status" = 'created' OR ("carrier" IS NOT NULL AND "tracking_no" IS NOT NULL)),
  CONSTRAINT "shipments_lifecycle_timestamps_check"
    CHECK (
      ("status" = 'created' AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
      OR ("status" = 'shipped' AND "shipped_at" IS NOT NULL AND "delivered_at" IS NULL)
      OR (
        "status" = 'delivered'
        AND "shipped_at" IS NOT NULL
        AND "delivered_at" IS NOT NULL
        AND "delivered_at" >= "shipped_at"
      )
    )
);
--> statement-breakpoint
ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_seller_order_id_seller_orders_id_fk"
  FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_shipment_no_uq"
  ON "shipments" USING btree ("shipment_no");
--> statement-breakpoint
CREATE INDEX "shipments_seller_order_status_created_idx"
  ON "shipments" USING btree ("seller_order_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "shipments_status_created_idx"
  ON "shipments" USING btree ("status", "created_at");
--> statement-breakpoint

CREATE TABLE "shipment_items" (
  "shipment_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  CONSTRAINT "shipment_items_pk" PRIMARY KEY ("shipment_id", "order_item_id"),
  CONSTRAINT "shipment_items_quantity_positive_check" CHECK ("quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk"
  FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_order_item_id_order_items_id_fk"
  FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipment_items_order_item_idx"
  ON "shipment_items" USING btree ("order_item_id");
--> statement-breakpoint

CREATE TABLE "shipment_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL,
  "status" varchar(20) NOT NULL,
  "source" varchar(80) NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload_ref" varchar(500),
  CONSTRAINT "shipment_status_history_status_check"
    CHECK ("status" IN ('created', 'shipped', 'delivered')),
  CONSTRAINT "shipment_status_history_source_not_blank_check"
    CHECK (length(btrim("source")) > 0),
  CONSTRAINT "shipment_status_history_payload_ref_not_blank_check"
    CHECK ("payload_ref" IS NULL OR length(btrim("payload_ref")) > 0)
);
--> statement-breakpoint
ALTER TABLE "shipment_status_history"
  ADD CONSTRAINT "shipment_status_history_shipment_id_shipments_id_fk"
  FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipment_status_history_shipment_occurred_idx"
  ON "shipment_status_history" USING btree ("shipment_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "shipment_status_history_status_occurred_idx"
  ON "shipment_status_history" USING btree ("status", "occurred_at");

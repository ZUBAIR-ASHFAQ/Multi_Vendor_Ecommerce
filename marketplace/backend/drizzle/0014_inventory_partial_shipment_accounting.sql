-- Repair Pass 1: add cumulative reservation consumption for future partial shipments.
-- Existing consumed reservations were created only by full shipment, so backfill them to qty.

ALTER TABLE "stock_reservations"
  ADD COLUMN "consumed_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "stock_reservations"
   SET "consumed_qty" = "qty"
 WHERE "status" = 'consumed';
--> statement-breakpoint
ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_consumed_qty_range_check"
  CHECK ("consumed_qty" >= 0 AND "consumed_qty" <= "qty");

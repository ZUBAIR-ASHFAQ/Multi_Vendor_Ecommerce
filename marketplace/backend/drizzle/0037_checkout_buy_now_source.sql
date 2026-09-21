ALTER TABLE "checkout_quotes"
  ADD COLUMN "source" varchar(20) NOT NULL DEFAULT 'cart';

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_source_check"
  CHECK ("source" IN ('cart', 'buy_now'));

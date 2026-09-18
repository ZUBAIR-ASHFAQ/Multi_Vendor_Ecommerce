-- Audit Remediation Pass 1: bounded post-Order payment-expiry lookup support.
-- No business data is rewritten. The index supports deterministic overdue linked-attempt scans
-- used by the frozen Payments -> Orders -> Inventory maintenance direction from Pass 0.

CREATE INDEX "checkout_attempts_expiry_order_idx"
  ON "checkout_attempts" USING btree ("expires_at", "id", "order_id")
  WHERE "order_id" is not null;

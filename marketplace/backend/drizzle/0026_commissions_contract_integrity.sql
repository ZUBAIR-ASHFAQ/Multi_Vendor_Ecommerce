-- Module 16 remediation Pass 1: enforce the approved Commission rule status contract.
-- Existing unsupported statuses are not silently reclassified because that could change finance behavior.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "commission_rules"
     WHERE "status" NOT IN ('active', 'inactive')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Module 16 remediation requires commission_rules.status to be active or inactive before migration.';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_status_check"
  CHECK ("status" IN ('active', 'inactive'));

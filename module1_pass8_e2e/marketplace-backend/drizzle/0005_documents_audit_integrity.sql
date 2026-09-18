-- Module 21 remediation Pass 1: persistence integrity hardening.
-- Keep 0000-0004 immutable; this patch upgrades the already-supported Module 21 schema in place.

ALTER TABLE "files" ADD COLUMN "purpose" varchar(100);

-- Existing Module 21 object keys are server-generated as <purpose>/..., so preserve their signed purpose.
UPDATE "files"
SET "purpose" = split_part("object_key", '/', 1)
WHERE split_part("object_key", '/', 1) IN (
  'product_media',
  'seller_verification',
  'report_export',
  'operational_evidence'
);

-- Fail loudly instead of silently assigning the wrong purpose to an unexpected historical object key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "files" WHERE "purpose" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill files.purpose from one or more existing object keys';
  END IF;
END;
$$;

ALTER TABLE "files" ALTER COLUMN "purpose" SET NOT NULL;
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check"
  CHECK ("purpose" IN (
    'product_media',
    'seller_verification',
    'report_export',
    'operational_evidence'
  ));

-- Link purpose is a controlled business value, not arbitrary free text.
ALTER TABLE "file_links" ADD CONSTRAINT "file_links_purpose_check"
  CHECK ("purpose" IN (
    'product_media',
    'seller_verification',
    'report_export',
    'operational_evidence'
  ));

-- Audit rows stay flexible for cross-module metadata while basic identity fields remain valid.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_type_check"
  CHECK ("actor_type" IN ('system', 'platform_admin', 'seller', 'customer'));
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_not_blank_check"
  CHECK (length(btrim("action")) > 0);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_resource_type_not_blank_check"
  CHECK (length(btrim("resource_type")) > 0);

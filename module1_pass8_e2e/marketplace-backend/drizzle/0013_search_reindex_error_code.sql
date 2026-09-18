-- Module 19 Pass 3 remediation: align reindex persistence with the required stable error_code contract.
-- This migration is append-only; the accepted 0012 Search migration remains unchanged.

ALTER TABLE "search_reindex_runs"
  RENAME COLUMN "error_message" TO "error_code";
--> statement-breakpoint
ALTER TABLE "search_reindex_runs"
  ALTER COLUMN "error_code" TYPE varchar(120)
  USING "error_code"::varchar(120);

ALTER TABLE products
  ADD COLUMN moderation_reason text,
  ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_at timestamptz;

ALTER TABLE products DROP CONSTRAINT products_publication_status_check;
ALTER TABLE products
  ADD CONSTRAINT products_publication_status_check
  CHECK (publication_status IN ('draft', 'pending_approval', 'published', 'rejected', 'unpublished'));

ALTER TABLE products
  ADD CONSTRAINT products_moderation_reason_check
  CHECK (
    (publication_status = 'rejected' AND moderation_reason IS NOT NULL AND length(btrim(moderation_reason)) > 0)
    OR (publication_status <> 'rejected')
  );

CREATE INDEX products_moderation_queue_idx
  ON products (publication_status, updated_at DESC, id);

ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS audit_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS delivery_dispatch_audit_created_at
  ON delivery_dispatch_audit (created_at DESC, id DESC);

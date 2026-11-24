ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS offer_delivery_mode text NOT NULL DEFAULT 'push'
  CHECK (offer_delivery_mode IN ('push', 'polling'));

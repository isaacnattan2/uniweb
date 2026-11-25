ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS enforce_delivery_deadline boolean NOT NULL DEFAULT false;

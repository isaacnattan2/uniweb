ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS parallel_geocoding boolean NOT NULL DEFAULT false;

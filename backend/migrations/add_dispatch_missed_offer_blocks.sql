BEGIN;
ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS missed_offer_block_minutes integer NOT NULL DEFAULT 60
    CHECK (missed_offer_block_minutes BETWEEN 1 AND 10080);
ALTER TABLE driver_dispatch_presence
  ADD COLUMN IF NOT EXISTS blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
UPDATE driver_dispatch_presence SET checked_in_at = NOW()
  WHERE online AND checked_in_at IS NULL;
ALTER TABLE delivery_dispatch_offers
  ADD COLUMN IF NOT EXISTS offered_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS missed_at timestamptz;
CREATE INDEX IF NOT EXISTS delivery_dispatch_offers_missed_history
  ON delivery_dispatch_offers(user_id, missed_at DESC) WHERE missed_at IS NOT NULL;
COMMIT;

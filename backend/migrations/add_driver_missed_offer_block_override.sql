ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS missed_offer_block_minutes integer
    CHECK (missed_offer_block_minutes BETWEEN 1 AND 10080);

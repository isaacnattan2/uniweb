BEGIN;

ALTER TABLE driver_delivery_rate_policy
  ALTER COLUMN minimum_cents DROP NOT NULL,
  ALTER COLUMN maximum_cents DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS driver_delivery_rate_policy_maximum_cents_check,
  ADD CONSTRAINT driver_delivery_rate_policy_maximum_cents_check
    CHECK (maximum_cents BETWEEN 0 AND 1000000 AND
      (minimum_cents IS NULL OR minimum_cents <= maximum_cents));

COMMIT;

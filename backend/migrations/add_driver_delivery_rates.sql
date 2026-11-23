BEGIN;

CREATE TABLE IF NOT EXISTS driver_delivery_rate_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  minimum_cents integer NOT NULL CHECK (minimum_cents >= 0),
  maximum_cents integer NOT NULL CHECK (maximum_cents BETWEEN minimum_cents AND 1000000),
  default_cents integer NOT NULL CHECK (default_cents BETWEEN 0 AND 1000000),
  allow_custom boolean NOT NULL
);

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS delivery_rate_cents integer CHECK (delivery_rate_cents BETWEEN 0 AND 1000000),
  ADD COLUMN IF NOT EXISTS delivery_rate_locked boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS order_delivery_distances (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  address_key text NOT NULL,
  distance_meters integer CHECK (distance_meters >= 0),
  calculated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS driver_rate_cents integer,
  ADD COLUMN IF NOT EXISTS driver_distance_meters integer;

COMMIT;

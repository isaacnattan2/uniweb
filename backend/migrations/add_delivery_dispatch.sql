BEGIN;
CREATE TABLE IF NOT EXISTS delivery_dispatch_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  radius_meters integer NOT NULL CHECK (radius_meters BETWEEN 100 AND 100000),
  subsidy_cents integer NOT NULL CHECK (subsidy_cents BETWEEN 0 AND 1000000)
);
INSERT INTO delivery_dispatch_settings VALUES (true, 5000, 0) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS driver_dispatch_presence (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  online boolean NOT NULL DEFAULT false,
  latitude double precision,
  longitude double precision,
  location_at timestamptz,
  ignored_offers integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS driver_dispatch_shifts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS driver_dispatch_shifts_lookup
  ON driver_dispatch_shifts (user_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS delivery_quotes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  destination text NOT NULL,
  pickup_address text NOT NULL,
  pickup_latitude double precision NOT NULL,
  pickup_longitude double precision NOT NULL,
  distance_meters integer NOT NULL CHECK (distance_meters >= 0),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  rate_cents integer NOT NULL CHECK (rate_cents >= 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  subsidy_cents integer NOT NULL CHECK (subsidy_cents >= 0),
  radius_meters integer NOT NULL,
  immediate_minutes integer,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_quotes_expiry ON delivery_quotes (expires_at);

CREATE TABLE IF NOT EXISTS delivery_dispatch (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('payment_pending', 'scheduled', 'searching', 'offered', 'assigned', 'in_transit', 'delivered', 'needs_choice', 'incident', 'cancelled')),
  slot_at timestamptz,
  capacity_driver_id uuid REFERENCES users(id),
  search_until timestamptz,
  promised_at timestamptz NOT NULL,
  pickup_address text NOT NULL,
  pickup_latitude double precision NOT NULL,
  pickup_longitude double precision NOT NULL,
  distance_meters integer NOT NULL,
  duration_minutes integer NOT NULL,
  rate_cents integer NOT NULL,
  fee_cents integer NOT NULL,
  fee_accepted_at timestamptz NOT NULL DEFAULT NOW(),
  subsidy_cents integer NOT NULL,
  radius_meters integer NOT NULL,
  incident_reason text,
  resolution_reason text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  search_cycle int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  refund_state text CHECK (refund_state IN ('pending', 'processing', 'refunded', 'review')),
  refund_checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS delivery_dispatch_state ON delivery_dispatch (state, slot_at, search_until);

CREATE TABLE IF NOT EXISTS delivery_dispatch_offers (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES delivery_dispatch(order_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  rate_cents integer NOT NULL,
  fee_cents integer NOT NULL,
  expires_at timestamptz NOT NULL,
  notified_at timestamptz,
  search_cycle int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_dispatch_offer_order_pending
  ON delivery_dispatch_offers(order_id) WHERE state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS delivery_dispatch_offer_driver_pending
  ON delivery_dispatch_offers(user_id) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS delivery_dispatch_offer_order ON delivery_dispatch_offers(order_id);
CREATE TABLE IF NOT EXISTS delivery_refund_submissions (
  payment_id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES delivery_dispatch(order_id),
  attempted_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS delivery_driver_earnings (
  order_id uuid PRIMARY KEY REFERENCES delivery_dispatch(order_id),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  subsidy_cents integer NOT NULL CHECK (subsidy_cents >= 0),
  earned_at timestamptz NOT NULL DEFAULT NOW()
);
COMMIT;

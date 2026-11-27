BEGIN;

ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS pickup_stops jsonb;
ALTER TABLE driver_dispatch_presence ADD COLUMN IF NOT EXISTS multi_pickup boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS delivery_route_stops (
  route_order_id uuid NOT NULL REFERENCES delivery_dispatch(order_id),
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  position integer NOT NULL CHECK (position > 0),
  address text NOT NULL,
  collected_at timestamptz,
  UNIQUE (route_order_id, position)
);

COMMIT;

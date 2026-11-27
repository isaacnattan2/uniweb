BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS passenger_ride boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS passenger_ride boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_passenger_history ON orders(user_id, created_at DESC) WHERE passenger_ride;
COMMIT;

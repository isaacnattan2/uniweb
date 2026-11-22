CREATE TABLE IF NOT EXISTS asaas_checkouts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  request_hash TEXT NOT NULL,
  provider_id TEXT NOT NULL UNIQUE
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS asaas_checkout_id UUID REFERENCES asaas_checkouts(id);
CREATE INDEX IF NOT EXISTS idx_orders_asaas_checkout ON orders(asaas_checkout_id);

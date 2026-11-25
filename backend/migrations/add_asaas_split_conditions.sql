ALTER TABLE businesses ADD COLUMN IF NOT EXISTS asaas_pix_split_condition JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS asaas_split_snapshot JSONB;

CREATE TABLE IF NOT EXISTS asaas_driver_payouts (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('sending', 'processing', 'done', 'review')),
  provider_id TEXT UNIQUE,
  provider_status TEXT,
  payment_net_cents BIGINT NOT NULL CHECK (payment_net_cents >= 0),
  store_cents BIGINT NOT NULL CHECK (store_cents >= 0),
  driver_cents BIGINT NOT NULL CHECK (driver_cents > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
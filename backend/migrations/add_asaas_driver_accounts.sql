CREATE TABLE IF NOT EXISTS asaas_driver_accounts (
  driver_id UUID PRIMARY KEY REFERENCES users(id),
  provider_id TEXT UNIQUE,
  wallet_id TEXT UNIQUE,
  encrypted_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((provider_id IS NULL AND wallet_id IS NULL AND encrypted_key IS NULL)
      OR (provider_id IS NOT NULL AND wallet_id IS NOT NULL AND encrypted_key IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS customer_addresses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address JSONB NOT NULL CHECK (jsonb_typeof(address) = 'object'),
  UNIQUE (user_id, address)
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_user_order ON customer_addresses (user_id, id);

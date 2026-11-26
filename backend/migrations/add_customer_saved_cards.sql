CREATE TABLE IF NOT EXISTS asaas_card_customers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_customer_id text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customer_saved_cards (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES asaas_card_customers(user_id) ON DELETE CASCADE,
  encrypted_token text NOT NULL,
  brand text NOT NULL,
  last_four text NOT NULL CHECK (last_four ~ '^[0-9]{4}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_saved_cards_user_idx ON customer_saved_cards(user_id, created_at DESC);

ALTER TABLE asaas_checkouts ADD COLUMN IF NOT EXISTS payment_flow text NOT NULL DEFAULT 'hosted';
ALTER TABLE asaas_checkouts ADD COLUMN IF NOT EXISTS card_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS asaas_card_checkout_reconcile_idx
  ON asaas_checkouts(card_checked_at) WHERE payment_flow = 'saved_card';

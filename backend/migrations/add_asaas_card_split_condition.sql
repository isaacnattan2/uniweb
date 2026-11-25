ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS asaas_card_split_condition JSONB;
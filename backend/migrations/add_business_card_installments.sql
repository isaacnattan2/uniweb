ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS max_card_installments SMALLINT NOT NULL DEFAULT 3
  CHECK (max_card_installments BETWEEN 1 AND 12);

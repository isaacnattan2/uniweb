ALTER TABLE asaas_checkouts
  ADD COLUMN IF NOT EXISTS installment_count SMALLINT
  CHECK (installment_count BETWEEN 1 AND 21);

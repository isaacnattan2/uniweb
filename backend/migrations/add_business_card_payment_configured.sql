ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS card_payment_configured BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE businesses
SET card_payment_configured = TRUE
WHERE card_payment_configured = FALSE
  AND max_card_installments <> 3
  AND 'credit_card' = ANY(payment_methods);
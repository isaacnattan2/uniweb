BEGIN;
ALTER TABLE orders ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE delivery_quotes ALTER COLUMN business_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'orders_passenger_business_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_passenger_business_check
      CHECK (passenger_ride = (business_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'delivery_quotes'::regclass AND conname = 'delivery_quotes_passenger_business_check') THEN
    ALTER TABLE delivery_quotes ADD CONSTRAINT delivery_quotes_passenger_business_check
      CHECK (passenger_ride = (business_id IS NULL));
  END IF;
END $$;
COMMIT;

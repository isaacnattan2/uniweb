BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS passenger_vehicle_type vehicle_type_enum
  CHECK (passenger_vehicle_type IN ('car', 'motorcycle'));
ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS passenger_vehicle_type vehicle_type_enum
  CHECK (passenger_vehicle_type IN ('car', 'motorcycle'));
COMMIT;

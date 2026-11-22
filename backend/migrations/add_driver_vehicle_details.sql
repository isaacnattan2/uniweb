ALTER TYPE vehicle_type_enum ADD VALUE IF NOT EXISTS 'utility';
ALTER TYPE vehicle_type_enum ADD VALUE IF NOT EXISTS 'truck';

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS vehicle_manufacturer VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vehicle_brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(50);

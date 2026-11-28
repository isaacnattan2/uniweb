BEGIN;

UPDATE drivers
SET vehicle_color = 'Prata'
WHERE NULLIF(btrim(vehicle_color), '') IS NULL;

ALTER TABLE drivers ALTER COLUMN vehicle_color SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND conname = 'drivers_vehicle_color_nonblank'
  ) THEN
    ALTER TABLE drivers ADD CONSTRAINT drivers_vehicle_color_nonblank CHECK (btrim(vehicle_color) <> '');
  END IF;
END $$;

COMMIT;

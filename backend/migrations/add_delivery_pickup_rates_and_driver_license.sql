BEGIN;
ALTER TABLE delivery_dispatch_settings ADD COLUMN IF NOT EXISTS allow_lower_offer boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_dispatch_offers ADD COLUMN IF NOT EXISTS pickup_distance_meters integer;
CREATE TABLE IF NOT EXISTS driver_license_photos (
  driver_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 5242880),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS debug_started_at timestamptz;

CREATE TABLE IF NOT EXISTS delivery_dispatch_debug_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL,
  details jsonb NOT NULL
);

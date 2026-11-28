BEGIN;

ALTER TABLE delivery_dispatch_settings
  ADD COLUMN IF NOT EXISTS ride_debug_started_at timestamptz;

ALTER TABLE delivery_dispatch_debug_events
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'delivery'
    CHECK (request_type IN ('delivery', 'ride'));

UPDATE delivery_dispatch_debug_events e
SET request_type = 'ride'
FROM orders o
WHERE o.passenger_ride AND e.request_type = 'delivery'
  AND o.id = CASE WHEN e.details->>'orderId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    THEN (e.details->>'orderId')::uuid END;

COMMIT;

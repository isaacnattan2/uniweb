CREATE TABLE IF NOT EXISTS delivery_dispatch_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL,
  search_cycle integer,
  driver_ids uuid[] NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS delivery_dispatch_audit_drivers
  ON delivery_dispatch_audit USING gin (driver_ids);
CREATE INDEX IF NOT EXISTS delivery_dispatch_audit_order_cycle
  ON delivery_dispatch_audit (order_id, search_cycle);

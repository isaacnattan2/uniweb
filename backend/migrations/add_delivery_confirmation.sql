BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_confirmation_code VARCHAR(4)
    CHECK (delivery_confirmation_code ~ '^[0-9]{4}$'),
  ADD COLUMN IF NOT EXISTS delivery_confirmation_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_confirmation_retry_at TIMESTAMPTZ;

UPDATE orders
SET delivery_confirmation_code = LPAD(
  ((('x' || LEFT(gen_random_uuid()::text, 8))::bit(32)::bigint) % 10000)::text, 4, '0'
)
WHERE delivery_type = 'delivery' AND delivery_status IN ('processing', 'in_transit')
  AND delivery_driver_id IS NOT NULL AND delivery_confirmation_code IS NULL
  AND order_status IN ('confirmed', 'processing') AND payment_status = 'paid' AND deleted_at IS NULL;

COMMIT;

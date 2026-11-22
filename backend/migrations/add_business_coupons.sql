CREATE TABLE IF NOT EXISTS business_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0 AND (discount_type <> 'percent' OR discount_value <= 10000)),
  scope TEXT NOT NULL CHECK (scope IN ('store', 'category', 'products')),
  category TEXT,
  product_ids UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (business_id, code),
  CHECK (
    (scope = 'store' AND category IS NULL AND cardinality(product_ids) = 0)
    OR (scope = 'category' AND category IS NOT NULL AND cardinality(product_ids) = 0)
    OR (scope = 'products' AND category IS NULL AND cardinality(product_ids) BETWEEN 1 AND 100)
  )
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS payment_methods TEXT[] NOT NULL DEFAULT ARRAY['pix', 'credit_card']::TEXT[]
  CHECK (
    cardinality(payment_methods) BETWEEN 1 AND 2
    AND array_position(payment_methods, NULL) IS NULL
    AND payment_methods <@ ARRAY['pix', 'credit_card']::TEXT[]
    AND (cardinality(payment_methods) = 1 OR payment_methods @> ARRAY['pix', 'credit_card']::TEXT[])
  );

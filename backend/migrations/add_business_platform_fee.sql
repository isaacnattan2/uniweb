ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS platform_fee_basis_points SMALLINT
  CHECK (platform_fee_basis_points BETWEEN 0 AND 10000);
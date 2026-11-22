CREATE TABLE IF NOT EXISTS marketplace_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  image_url TEXT NOT NULL CHECK (char_length(image_url) BETWEEN 1 AND 2048),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_ads_published ON marketplace_ads (position, created_at, id) WHERE published;

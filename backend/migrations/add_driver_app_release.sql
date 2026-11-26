CREATE TABLE IF NOT EXISTS driver_app_release (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version_name text NOT NULL,
  version_code integer NOT NULL CHECK (version_code > 0),
  download_url text NOT NULL,
  signer_sha256 text NOT NULL CHECK (signer_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now()
);

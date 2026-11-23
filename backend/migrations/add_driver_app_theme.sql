CREATE TABLE IF NOT EXISTS driver_app_theme (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  primary_color text NOT NULL CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text NOT NULL CHECK (secondary_color ~ '^#[0-9a-fA-F]{6}$')
);

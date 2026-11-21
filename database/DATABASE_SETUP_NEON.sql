-- ============================================================================
-- APP UNI - Database Setup Script (Neon Compatible)
-- PostgreSQL 14+
-- ============================================================================

-- Enable required extensions (Neon-compatible)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Note: The following extensions are NOT available on Neon:
-- - earthdistance, cube: Use simple lat/long calculations
-- - pgtrgm: Use standard LIKE/ILIKE for text search
-- - For advanced geospatial, enable PostGIS via console

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_type_enum AS ENUM ('customer', 'business', 'driver', 'admin');
CREATE TYPE user_status_enum AS ENUM ('active', 'inactive', 'suspended', 'deleted');
CREATE TYPE business_status_enum AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE product_status_enum AS ENUM ('active', 'inactive', 'discontinued');
CREATE TYPE order_status_enum AS ENUM ('pending', 'confirmed', 'processing', 'completed', 'cancelled');
CREATE TYPE payment_status_enum AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE delivery_status_enum AS ENUM ('pending', 'processing', 'in_transit', 'delivered', 'cancelled');
CREATE TYPE delivery_type_enum AS ENUM ('pickup', 'delivery', 'shipping');
CREATE TYPE payment_method_enum AS ENUM ('credit_card', 'debit_card', 'wallet', 'pix');
CREATE TYPE vehicle_type_enum AS ENUM ('car', 'motorcycle', 'bicycle', 'van');
CREATE TYPE driver_status_enum AS ENUM ('active', 'inactive', 'suspended', 'pending_approval');
CREATE TYPE online_status_enum AS ENUM ('online', 'offline', 'on_trip');
CREATE TYPE ride_status_enum AS ENUM ('requested', 'accepted', 'ongoing', 'completed', 'cancelled');
CREATE TYPE commission_type_enum AS ENUM ('percentage', 'fixed', 'hybrid');
CREATE TYPE transaction_type_enum AS ENUM ('purchase', 'cashback_earned', 'cashback_spent', 'ride_payment', 'delivery_fee', 'wallet_top_up', 'withdrawal', 'refund', 'adjustment');
CREATE TYPE transaction_status_enum AS ENUM ('pending', 'completed', 'failed', 'reversed');
CREATE TYPE issue_type_enum AS ENUM ('pothole', 'flooding', 'traffic_accident', 'bad_sidewalk', 'street_light_broken', 'garbage', 'graffiti', 'other');
CREATE TYPE issue_severity_enum AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE issue_status_enum AS ENUM ('reported', 'in_analysis', 'in_progress', 'resolved', 'dismissed');
CREATE TYPE wallet_status_enum AS ENUM ('active', 'frozen', 'closed');
CREATE TYPE review_status_enum AS ENUM ('pending', 'approved', 'rejected');

-- ============================================================================
-- USERS TABLE
-- ============================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  full_name VARCHAR(255) NOT NULL,
  user_type user_type_enum NOT NULL,
  
  cpf_cnpj VARCHAR(20) UNIQUE,
  status user_status_enum DEFAULT 'active',
  
  avatar_url TEXT,
  verified_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

-- ============================================================================
-- WALLETS TABLE
-- ============================================================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  balance_credits DECIMAL(15, 2) DEFAULT 0.00,      -- Créditos da plataforma
  balance_cashback DECIMAL(15, 2) DEFAULT 0.00,     -- Cashback acumulado
  balance_pending DECIMAL(15, 2) DEFAULT 0.00,      -- Cashback pendente
  
  status wallet_status_enum DEFAULT 'active',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_status ON wallets(status);

-- ============================================================================
-- USER DEVICES TABLE
-- ============================================================================

CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  device_name VARCHAR(255),
  device_type VARCHAR(50),          -- ios, android, web
  fcm_token TEXT UNIQUE,            -- Firebase Cloud Messaging
  
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_user_devices_fcm_token ON user_devices(fcm_token);

-- ============================================================================
-- BUSINESSES TABLE
-- ============================================================================

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  
  cnpj VARCHAR(20) UNIQUE,
  
  -- Location (using simple lat/long instead of PostGIS)
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip_code VARCHAR(10),
  country VARCHAR(100),
  
  phone VARCHAR(20),
  email VARCHAR(255),
  website VARCHAR(255),
  
  rating DECIMAL(3, 2) DEFAULT 0.00,
  rating_count INTEGER DEFAULT 0,
  
  opening_hours JSONB,              -- { "monday": {"open": "08:00", "close": "22:00"}, ... }
  
  status business_status_enum DEFAULT 'active',
  verified_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_businesses_owner_id ON businesses(owner_id);
CREATE INDEX idx_businesses_city ON businesses(city);
CREATE INDEX idx_businesses_status ON businesses(status);
CREATE INDEX idx_businesses_created_at ON businesses(created_at);
CREATE INDEX idx_businesses_name ON businesses(name);
-- Geospatial index removed - use standard lat/long filtering instead
-- For better geospatial queries, enable PostGIS: CREATE EXTENSION postgis;

-- ============================================================================
-- PRODUCTS TABLE
-- ============================================================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  image_url TEXT,
  
  price DECIMAL(15, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT 0.00,
  
  cashback_percent DECIMAL(5, 2) DEFAULT 0.00,
  
  category VARCHAR(100),
  
  stock INTEGER DEFAULT 0,
  
  rating DECIMAL(3, 2) DEFAULT 0.00,
  rating_count INTEGER DEFAULT 0,
  
  status product_status_enum DEFAULT 'active',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  
  UNIQUE(business_id, slug)
);

CREATE INDEX idx_products_business_id ON products(business_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_created_at ON products(created_at);

-- ============================================================================
-- ORDERS TABLE
-- ============================================================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id),
  delivery_driver_id UUID REFERENCES users(id),  -- Nullable, assigned later
  
  order_number VARCHAR(50) UNIQUE NOT NULL,
  
  subtotal DECIMAL(15, 2) NOT NULL,
  discount DECIMAL(15, 2) DEFAULT 0.00,
  delivery_fee DECIMAL(15, 2) DEFAULT 0.00,
  tax DECIMAL(15, 2) DEFAULT 0.00,
  total DECIMAL(15, 2) NOT NULL,
  
  cashback_earned DECIMAL(15, 2) DEFAULT 0.00,
  
  payment_method payment_method_enum NOT NULL,
  payment_status payment_status_enum DEFAULT 'pending',
  
  delivery_type delivery_type_enum DEFAULT 'delivery',
  delivery_address TEXT,
  delivery_status delivery_status_enum DEFAULT 'pending',
  
  order_status order_status_enum DEFAULT 'pending',
  
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_business_id ON orders(business_id);
CREATE INDEX idx_orders_delivery_driver_id ON orders(delivery_driver_id);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- ============================================================================
-- ORDER ITEMS TABLE
-- ============================================================================

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  
  product_name VARCHAR(255) NOT NULL,
  product_price DECIMAL(15, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal DECIMAL(15, 2) NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- ============================================================================
-- DRIVERS TABLE
-- ============================================================================

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  license_number VARCHAR(50) UNIQUE,
  license_expiry DATE,
  
  vehicle_type vehicle_type_enum NOT NULL,
  vehicle_plate VARCHAR(20),
  
  rating DECIMAL(3, 2) DEFAULT 5.00,
  rating_count INTEGER DEFAULT 0,
  
  status driver_status_enum DEFAULT 'pending_approval',
  online_status online_status_enum DEFAULT 'offline',
  
  current_latitude DECIMAL(10, 8),
  current_longitude DECIMAL(11, 8),
  current_location TEXT,
  
  verified_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_drivers_user_id ON drivers(user_id);
CREATE INDEX idx_drivers_status ON drivers(status);
CREATE INDEX idx_drivers_online_status ON drivers(online_status);

-- ============================================================================
-- RIDES TABLE
-- ============================================================================

CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  
  start_location TEXT NOT NULL,
  start_latitude DECIMAL(10, 8),
  start_longitude DECIMAL(11, 8),
  
  end_location TEXT NOT NULL,
  end_latitude DECIMAL(10, 8),
  end_longitude DECIMAL(11, 8),
  
  distance_km DECIMAL(10, 2),
  estimated_fare DECIMAL(15, 2),
  final_fare DECIMAL(15, 2),
  
  cashback_earned DECIMAL(15, 2) DEFAULT 0.00,
  
  ride_status ride_status_enum DEFAULT 'requested',
  
  scheduled_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  rating DECIMAL(3, 2),
  review TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_rides_user_id ON rides(user_id);
CREATE INDEX idx_rides_driver_id ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(ride_status);
CREATE INDEX idx_rides_created_at ON rides(created_at);

-- ============================================================================
-- DELIVERIES TABLE
-- ============================================================================

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  
  pickup_location TEXT NOT NULL,
  pickup_latitude DECIMAL(10, 8),
  pickup_longitude DECIMAL(11, 8),
  pickup_at TIMESTAMP,
  
  delivery_location TEXT NOT NULL,
  delivery_latitude DECIMAL(10, 8),
  delivery_longitude DECIMAL(11, 8),
  
  distance_km DECIMAL(10, 2),
  delivery_fee DECIMAL(15, 2),
  
  status delivery_status_enum DEFAULT 'pending',
  
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  estimated_delivery_at TIMESTAMP,
  
  signature_url TEXT,
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX idx_deliveries_driver_id ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);

-- ============================================================================
-- URBAN ISSUES TABLE
-- ============================================================================

CREATE TABLE urban_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  
  issue_type issue_type_enum NOT NULL,
  severity issue_severity_enum DEFAULT 'medium',
  
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  location_text VARCHAR(255),
  
  photo_url TEXT,
  
  status issue_status_enum DEFAULT 'reported',
  
  votes_count INTEGER DEFAULT 0,
  
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_urban_issues_reporter_id ON urban_issues(reporter_id);
CREATE INDEX idx_urban_issues_type ON urban_issues(issue_type);
CREATE INDEX idx_urban_issues_severity ON urban_issues(severity);
CREATE INDEX idx_urban_issues_status ON urban_issues(status);
CREATE INDEX idx_urban_issues_created_at ON urban_issues(created_at);

-- ============================================================================
-- REVIEWS TABLE
-- ============================================================================

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  reviewed_entity_type VARCHAR(50) NOT NULL,  -- 'business', 'product', 'driver'
  reviewed_entity_id UUID NOT NULL,           -- business_id, product_id, or driver_id
  
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  
  status review_status_enum DEFAULT 'approved',
  
  helpful_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_entity ON reviews(reviewed_entity_type, reviewed_entity_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_reviews_created_at ON reviews(created_at);

-- ============================================================================
-- TRANSACTIONS TABLE
-- ============================================================================

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  
  transaction_type transaction_type_enum NOT NULL,
  
  amount DECIMAL(15, 2) NOT NULL,
  balance_before DECIMAL(15, 2),
  balance_after DECIMAL(15, 2),
  
  status transaction_status_enum DEFAULT 'pending',
  
  reference_entity_type VARCHAR(50),         -- 'order', 'ride', 'business', etc
  reference_entity_id UUID,
  
  description TEXT,
  metadata JSONB,                            -- Flexible field for extra info
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);

-- ============================================================================
-- AUDIT LOGS TABLE
-- ============================================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(255) NOT NULL,
  entity_id UUID,
  
  changes JSONB,                     -- { "field": {"old": value, "new": value}, ... }
  
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER order_items_updated_at BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER drivers_updated_at BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER rides_updated_at BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER deliveries_updated_at BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER urban_issues_updated_at BEFORE UPDATE ON urban_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active Users View
CREATE VIEW active_users AS
SELECT u.*, w.balance_credits, w.balance_cashback
FROM users u
LEFT JOIN wallets w ON u.id = w.user_id
WHERE u.deleted_at IS NULL AND u.status = 'active';

-- Active Drivers View
CREATE VIEW active_drivers AS
SELECT u.id as user_id, u.email, u.full_name, 
       d.id as driver_id, d.vehicle_type, d.vehicle_plate, 
       d.current_latitude, d.current_longitude, d.status, d.online_status,
       d.rating, d.rating_count
FROM users u
JOIN drivers d ON u.id = d.user_id
WHERE u.deleted_at IS NULL AND d.deleted_at IS NULL 
  AND d.status = 'active' AND d.online_status = 'online';

-- Top Rated Businesses View
CREATE VIEW top_businesses AS
SELECT b.*, u.email as owner_email,
       COUNT(DISTINCT r.id) as review_count,
       COUNT(DISTINCT o.id) as order_count
FROM businesses b
LEFT JOIN users u ON b.owner_id = u.id
LEFT JOIN reviews r ON b.id = r.reviewed_entity_id AND r.reviewed_entity_type = 'business'
LEFT JOIN orders o ON b.id = o.business_id
WHERE b.deleted_at IS NULL AND b.status = 'active'
GROUP BY b.id, u.id
ORDER BY b.rating DESC;

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
-- Total Tables: 14
-- Total Enums: 23
-- Total Indices: 50+
-- Total Triggers: 11
-- Total Views: 3

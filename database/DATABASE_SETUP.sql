-- ============================================================================
-- APP UNI - Database Setup Script
-- PostgreSQL 14+
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "earthdistance";
CREATE EXTENSION IF NOT EXISTS "cube";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pgtrgm"; -- For text search

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
  phone VARCHAR(20),
  full_name VARCHAR(255) NOT NULL,
  user_type user_type_enum NOT NULL,
  
  cpf_cnpj VARCHAR(20) UNIQUE,
  date_of_birth DATE,
  avatar_url TEXT,
  
  country VARCHAR(3) DEFAULT 'BR',
  state VARCHAR(2),
  city VARCHAR(100),
  address TEXT,
  zip_code VARCHAR(10),
  
  status user_status_enum DEFAULT 'active',
  verified_email BOOLEAN DEFAULT false,
  verified_phone BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_city ON users(city);
CREATE INDEX idx_users_status ON users(status);

-- ============================================================================
-- WALLETS TABLE
-- ============================================================================

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  balance DECIMAL(10, 2) DEFAULT 0.00,
  cashback_balance DECIMAL(10, 2) DEFAULT 0.00,
  credit_balance DECIMAL(10, 2) DEFAULT 0.00,
  
  currency VARCHAR(3) DEFAULT 'BRL',
  status wallet_status_enum DEFAULT 'active',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT non_negative_balance CHECK (balance >= 0),
  CONSTRAINT non_negative_cashback CHECK (cashback_balance >= 0),
  CONSTRAINT non_negative_credit CHECK (credit_balance >= 0)
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);

-- ============================================================================
-- BUSINESSES TABLE
-- ============================================================================

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  business_name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  cnpj VARCHAR(20) UNIQUE NOT NULL,
  
  country VARCHAR(3) DEFAULT 'BR',
  state VARCHAR(2) NOT NULL,
  city VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  zip_code VARCHAR(10),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  category VARCHAR(100),
  subcategory VARCHAR(100),
  
  phone VARCHAR(20),
  email VARCHAR(255),
  website TEXT,
  
  opening_hours JSONB,
  
  status business_status_enum DEFAULT 'active',
  verified BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_businesses_owner_id ON businesses(owner_id);
CREATE INDEX idx_businesses_city ON businesses(city);
CREATE INDEX idx_businesses_category ON businesses(category);

-- ============================================================================
-- PRODUCTS TABLE
-- ============================================================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sku VARCHAR(100),
  
  price DECIMAL(10, 2) NOT NULL,
  discount_price DECIMAL(10, 2),
  currency VARCHAR(3) DEFAULT 'BRL',
  
  cashback_percentage DECIMAL(5, 2) DEFAULT 0,
  cashback_amount DECIMAL(10, 2),
  
  category VARCHAR(100),
  tags TEXT[],
  
  image_urls TEXT[],
  thumbnail_url TEXT,
  
  stock_quantity INT DEFAULT 0,
  low_stock_alert INT DEFAULT 10,
  
  status product_status_enum DEFAULT 'active',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_price CHECK (price > 0),
  CONSTRAINT valid_stock CHECK (stock_quantity >= 0),
  CONSTRAINT valid_cashback CHECK (cashback_percentage BETWEEN 0 AND 100)
);

CREATE INDEX idx_products_business_id ON products(business_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_name ON products USING GIN (to_tsvector('portuguese', name));

-- ============================================================================
-- ORDERS TABLE
-- ============================================================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  
  subtotal DECIMAL(10, 2) NOT NULL,
  discount DECIMAL(10, 2) DEFAULT 0,
  taxes DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  
  cashback_earned DECIMAL(10, 2) DEFAULT 0,
  
  payment_method payment_method_enum NOT NULL,
  payment_status payment_status_enum DEFAULT 'pending',
  
  delivery_type delivery_type_enum DEFAULT 'delivery',
  delivery_status delivery_status_enum DEFAULT 'pending',
  delivery_address TEXT,
  estimated_delivery DATE,
  
  status order_status_enum DEFAULT 'pending',
  
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_total CHECK (total >= subtotal - discount)
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_business_id ON orders(business_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);

-- ============================================================================
-- ORDER ITEMS TABLE
-- ============================================================================

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL,
  discount DECIMAL(10, 2) DEFAULT 0,
  subtotal DECIMAL(10, 2) NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- ============================================================================
-- DRIVERS TABLE
-- ============================================================================

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  driver_license VARCHAR(20) UNIQUE,
  license_expiry DATE,
  national_id VARCHAR(20) UNIQUE,
  
  vehicle_type vehicle_type_enum NOT NULL,
  vehicle_model VARCHAR(255),
  vehicle_plate VARCHAR(10) UNIQUE,
  vehicle_color VARCHAR(50),
  
  certified BOOLEAN DEFAULT false,
  background_check_passed BOOLEAN DEFAULT false,
  
  average_rating DECIMAL(3, 2) DEFAULT 0,
  total_rides INT DEFAULT 0,
  total_deliveries INT DEFAULT 0,
  
  status driver_status_enum DEFAULT 'pending_approval',
  online_status online_status_enum DEFAULT 'offline',
  
  current_latitude DECIMAL(10, 8),
  current_longitude DECIMAL(11, 8),
  last_location_update TIMESTAMP,
  
  preferred_zone VARCHAR(100),
  commission_type commission_type_enum DEFAULT 'percentage',
  commission_rate DECIMAL(5, 2),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_rating CHECK (average_rating BETWEEN 0 AND 5)
);

CREATE INDEX idx_drivers_user_id ON drivers(user_id);
CREATE INDEX idx_drivers_status ON drivers(status);
CREATE INDEX idx_drivers_city ON drivers(preferred_zone);

-- ============================================================================
-- RIDES TABLE
-- ============================================================================

CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_id UUID REFERENCES drivers(id) ON DELETE RESTRICT,
  
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  dropoff_latitude DECIMAL(10, 8) NOT NULL,
  dropoff_longitude DECIMAL(11, 8) NOT NULL,
  
  pickup_address TEXT,
  dropoff_address TEXT,
  
  distance_km DECIMAL(10, 2),
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  
  base_fare DECIMAL(10, 2),
  distance_fare DECIMAL(10, 2),
  time_fare DECIMAL(10, 2),
  surge_multiplier DECIMAL(3, 2) DEFAULT 1.0,
  total_fare DECIMAL(10, 2),
  
  payment_method payment_method_enum NOT NULL,
  payment_status payment_status_enum DEFAULT 'pending',
  
  cashback_earned DECIMAL(10, 2) DEFAULT 0,
  
  status ride_status_enum DEFAULT 'requested',
  cancellation_reason VARCHAR(255),
  
  user_rating INT CHECK (user_rating BETWEEN 1 AND 5),
  driver_rating INT CHECK (driver_rating BETWEEN 1 AND 5),
  user_review TEXT,
  driver_review TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rides_user_id ON rides(user_id);
CREATE INDEX idx_rides_driver_id ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);
CREATE INDEX idx_rides_created_at ON rides(created_at DESC);

-- ============================================================================
-- DELIVERIES TABLE
-- ============================================================================

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE RESTRICT,
  
  pickup_latitude DECIMAL(10, 8) NOT NULL,
  pickup_longitude DECIMAL(11, 8) NOT NULL,
  dropoff_latitude DECIMAL(10, 8) NOT NULL,
  dropoff_longitude DECIMAL(11, 8) NOT NULL,
  
  pickup_address TEXT,
  dropoff_address TEXT,
  
  distance_km DECIMAL(10, 2),
  estimated_duration_minutes INT,
  
  delivery_fee DECIMAL(10, 2),
  tip DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2),
  
  payment_status payment_status_enum DEFAULT 'pending',
  
  status delivery_status_enum DEFAULT 'pending',
  
  assigned_at TIMESTAMP,
  picked_up_at TIMESTAMP,
  delivered_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX idx_deliveries_driver_id ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);

-- ============================================================================
-- URBAN ISSUES TABLE
-- ============================================================================

CREATE TABLE urban_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address TEXT,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  
  issue_type issue_type_enum NOT NULL,
  severity issue_severity_enum DEFAULT 'medium',
  
  description TEXT,
  photo_urls TEXT[],
  
  status issue_status_enum DEFAULT 'reported',
  resolution_notes TEXT,
  
  assigned_to_city_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP,
  
  upvote_count INT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX idx_urban_issues_reporter_id ON urban_issues(reporter_id);
CREATE INDEX idx_urban_issues_city ON urban_issues(city);
CREATE INDEX idx_urban_issues_status ON urban_issues(status);
CREATE INDEX idx_urban_issues_severity ON urban_issues(severity);

-- ============================================================================
-- TRANSACTIONS TABLE
-- ============================================================================

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT,
  
  transaction_type transaction_type_enum NOT NULL,
  
  amount DECIMAL(10, 2) NOT NULL,
  balance_before DECIMAL(10, 2),
  balance_after DECIMAL(10, 2),
  
  reference_id UUID,
  reference_type VARCHAR(50),
  
  status transaction_status_enum DEFAULT 'pending',
  
  description TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT valid_amount CHECK (amount > 0)
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_reference ON transactions(reference_id, reference_type);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);

-- ============================================================================
-- REVIEWS TABLE
-- ============================================================================

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  reviewable_type VARCHAR(50) NOT NULL,
  reviewable_id UUID NOT NULL,
  
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(255),
  comment TEXT,
  
  photo_urls TEXT[],
  
  status review_status_enum DEFAULT 'pending',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX idx_reviews_reviewable ON reviews(reviewable_type, reviewable_id);

-- ============================================================================
-- USER DEVICES TABLE
-- ============================================================================

CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  device_id VARCHAR(255) UNIQUE,
  device_type VARCHAR(50),
  device_name VARCHAR(255),
  
  fcm_token TEXT,
  
  last_active TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);

-- ============================================================================
-- AUDIT LOGS TABLE
-- ============================================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  
  changes JSONB,
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_businesses_updated_at
BEFORE UPDATE ON businesses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_drivers_updated_at
BEFORE UPDATE ON drivers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rides_updated_at
BEFORE UPDATE ON rides
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deliveries_updated_at
BEFORE UPDATE ON deliveries
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_urban_issues_updated_at
BEFORE UPDATE ON urban_issues
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active users by type
CREATE VIEW active_users_by_type AS
SELECT user_type, COUNT(*) as count
FROM users
WHERE status = 'active' AND deleted_at IS NULL
GROUP BY user_type;

-- Top businesses by orders
CREATE VIEW top_businesses_by_orders AS
SELECT 
  b.id,
  b.business_name,
  COUNT(o.id) as total_orders,
  SUM(o.total) as total_revenue,
  AVG(CAST(r.rating AS DECIMAL)) as avg_rating
FROM businesses b
LEFT JOIN orders o ON b.id = o.business_id
LEFT JOIN reviews r ON b.id = r.reviewable_id AND r.reviewable_type = 'business'
WHERE b.status = 'active'
GROUP BY b.id, b.business_name
ORDER BY total_orders DESC;

-- Driver performance metrics
CREATE VIEW driver_performance AS
SELECT 
  d.id,
  d.user_id,
  u.full_name,
  COUNT(DISTINCT r.id) as total_rides,
  COUNT(DISTINCT de.id) as total_deliveries,
  AVG(d.average_rating) as avg_rating,
  SUM(r.total_fare) as total_earnings
FROM drivers d
JOIN users u ON d.user_id = u.id
LEFT JOIN rides r ON d.id = r.driver_id AND r.status = 'completed'
LEFT JOIN deliveries de ON d.id = de.driver_id AND de.status = 'delivered'
WHERE d.status = 'active'
GROUP BY d.id, d.user_id, u.full_name;

-- ============================================================================
-- DONE
-- ============================================================================
-- Database setup complete!
-- Apply row-level security (RLS) policies based on your security requirements
-- ============================================================================

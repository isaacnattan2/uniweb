export interface AuthRequest {
  userId?: string;
  businessId?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  status: 'active' | 'inactive' | 'suspended';
  user_type: 'customer' | 'business' | 'driver';
  created_at: Date;
}

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: Date;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  description: string;
  price: number;
  quantity_available: number;
  category: string;
  status: 'active' | 'inactive';
  created_at: Date;
}

export interface Order {
  id: string;
  customer_id: string;
  business_id: string;
  status: 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled';
  total_amount: number;
  created_at: Date;
}

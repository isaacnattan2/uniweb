import axios, { AxiosInstance } from 'axios';
import type { Business, StorePaymentMethod, UserType } from '../context/store';

export interface Seller {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: 'active' | 'inactive' | 'suspended';
}

export interface AdminBusiness {
  id: string;
  name: string;
  category: string;
  description: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_status: Seller['status'] | 'deleted';
  status: 'active' | 'inactive' | 'suspended';
}

export interface RatingSummary {
  rating?: string | number;
  rating_count?: number;
}

export interface MarketplaceCategory {
  kind: 'business' | 'product';
  value: string;
  label: string;
}

export interface PublicProduct extends RatingSummary {
  id: string;
  business_id: string;
  business_name?: string;
  name: string;
  description?: string;
  category?: string;
  category_label?: string;
  price: string | number;
  stock: number;
  images?: Array<{ id?: string; image_url: string; order_index?: number }>;
}

export interface PublicBusiness extends RatingSummary {
  payment_methods?: StorePaymentMethod[];
  max_card_installments?: number;
  id: string;
  name: string;
  description?: string;
  category?: string;
  category_label?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    return `${new URL(API_URL, window.location.origin).origin}${url}`;
  }
  return url;
}

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export async function registerUser(email: string, password: string, fullName: string, userType: string = 'customer') {
  const response = await api.post('/auth/register', { email, password, fullName, userType });
  return response.data;
}

export async function loginUser(email: string, password: string) {
  const response = await api.post('/auth/login', { email, password });
  return response.data;
}

export async function getCurrentUser(): Promise<{ id: string; user_type: UserType }> {
  const response = await api.get('/auth/me');
  return response.data;
}

export async function getSellers(includeInactive = false): Promise<Seller[]> {
  const response = await api.get('/admin/sellers', { params: { includeInactive } });
  return response.data;
}

export async function updateSeller(id: string, data: { fullName: string; email: string; phone: string }) {
  await api.put('/admin/sellers/' + id, data);
}

export async function setAdminBlock(resource: 'sellers' | 'businesses', id: string, blocked: boolean) {
  await api.put('/admin/' + resource + '/' + id + '/status', { blocked });
}

export async function createSeller(fullName: string, email: string, password: string) {
  const response = await api.post('/admin/sellers', { fullName, email, password });
  return response.data;
}

export async function getAdminBusinesses(): Promise<AdminBusiness[]> {
  const response = await api.get('/admin/businesses');
  return response.data;
}

export async function transferBusiness(businessId: string, ownerId: string) {
  const response = await api.put(`/admin/businesses/${businessId}/owner`, { ownerId });
  return response.data;
}

// Business (Vendor)
export async function createBusiness(name: string, description: string, category: string, ownerId: string) {
  const response = await api.post('/businesses', { name, description, category, ownerId });
  return response.data;
}

export async function getMyBusinesses() {
  const response = await api.get('/businesses/my-businesses');
  return response.data;
}

export async function getBusiness(id: string): Promise<Business> {
  const response = await api.get(`/businesses/${id}`);
  return response.data;
}

export async function updateBusiness(id: string, data: { name: string; category: string; description: string } | { payment_methods: StorePaymentMethod[]; max_card_installments: number }): Promise<Business> {
  const response = await api.put(`/businesses/${id}`, data);
  return response.data;
}

// Products (Vendor)
export async function createProduct(businessId: string, name: string, description: string, price: number, quantity: number, category: string, images?: string[]) {
  const response = await api.post('/products', { businessId, name, description, price, quantity, category, images });
  return response.data;
}

export async function getProductsByBusiness(businessId: string) {
  const response = await api.get(`/products/business/${businessId}`);
  return response.data;
}

export async function updateProduct(productId: string, data: any) {
  const response = await api.put(`/products/${productId}`, data);
  return response.data;
}

export async function deleteProduct(productId: string) {
  const response = await api.delete(`/products/${productId}`);
  return response.data;
}

// Shop (Public)
export async function getAllBusinesses(): Promise<PublicBusiness[]> {
  const response = await api.get('/shop/businesses');
  return response.data;
}

export async function getBusinessPublic(businessId: string): Promise<PublicBusiness> {
  const response = await api.get(`/shop/businesses/${businessId}`);
  return response.data;
}

export async function getProductsPublic(businessId: string): Promise<PublicProduct[]> {
  const response = await api.get(`/shop/businesses/${businessId}/products`);
  return response.data;
}

export async function getRecentProducts(category?: string): Promise<PublicProduct[]> {
  const response = await api.get('/shop/products/recent', { params: { category } });
  return response.data;
}

export async function searchProducts(query: string, category?: string): Promise<PublicProduct[]> {
  const response = await api.get('/shop/search', { params: { q: query, category } });
  return response.data;
}

export async function getMarketplaceCategories(): Promise<MarketplaceCategory[]> {
  const response = await api.get('/shop/categories');
  return response.data;
}

export async function createMarketplaceCategory(kind: MarketplaceCategory['kind'], label: string): Promise<MarketplaceCategory> {
  const response = await api.post('/admin/categories', { kind, label });
  return response.data;
}

export async function renameMarketplaceCategory(category: MarketplaceCategory, label: string): Promise<MarketplaceCategory> {
  const response = await api.put('/admin/categories/' + category.kind + '/' + encodeURIComponent(category.value), { label });
  return response.data;
}

export async function deleteMarketplaceCategory(category: MarketplaceCategory) {
  await api.delete('/admin/categories/' + category.kind + '/' + encodeURIComponent(category.value));
}

export interface MarketplaceReviewInput {
  rating: number | null;
  comment: string | null;
}

export interface MarketplaceComment extends MarketplaceReviewInput {
  id: string;
  author: string;
  updated_at: string | null;
}

type ReviewKind = MarketplaceCategory['kind'];

export async function getMarketplaceComments(kind: ReviewKind, id: string, page = 0): Promise<{ comments: MarketplaceComment[]; hasMore: boolean }> {
  return (await api.get('/shop/reviews/' + kind + '/' + id, { params: { page } })).data;
}

export async function getMyMarketplaceReview(kind: ReviewKind, id: string): Promise<{
  eligible: boolean;
  review: (MarketplaceReviewInput & { status: string }) | null;
}> {
  return (await api.get('/shop/reviews/' + kind + '/' + id + '/mine')).data;
}

export async function rateMarketplaceItem(kind: ReviewKind, id: string, input: MarketplaceReviewInput): Promise<RatingSummary> {
  return (await api.put('/shop/reviews/' + kind + '/' + id, input)).data;
}

// Orders
export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'wallet';
export type DeliveryType = 'pickup' | 'delivery' | 'shipping';

export async function createOrder(
  items: Array<{ productId: string; quantity: number; price: number }>,
  paymentMethod: PaymentMethod,
  deliveryType: DeliveryType,
  deliveryAddress: string,
  checkoutId: string,
  couponCode?: string
): Promise<{ orderIds: string[]; checkoutUrl: string | null }> {
  const response = await api.post('/orders/checkout', { items, paymentMethod, deliveryType, deliveryAddress, checkoutId, couponCode });
  return response.data;
}

export async function getMyOrders() {
  const response = await api.get('/orders/my-orders');
  return response.data;
}

export async function getOrder(orderId: string) {
  const response = await api.get(`/orders/${orderId}`);
  return response.data;
}

// Upload
export async function uploadImages(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('images', file);
  });

  const response = await api.post('/upload/images', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}
export interface StoreCoupon {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  scope: 'store' | 'category' | 'products';
  category: string | null;
  product_ids: string[];
  active: boolean;
}

export interface StoreCouponInput {
  code: string;
  discountType: StoreCoupon['discount_type'];
  discountValue: number;
  scope: StoreCoupon['scope'];
  category: string;
  productIds: string[];
  active: boolean;
}

export async function getStoreCoupons(businessId: string): Promise<StoreCoupon[]> {
  return (await api.get('/businesses/' + businessId + '/coupons')).data;
}

export async function saveStoreCoupon(businessId: string, input: StoreCouponInput, couponId?: string): Promise<StoreCoupon> {
  const path = '/businesses/' + businessId + '/coupons';
  return (couponId ? await api.put(path + '/' + couponId, input) : await api.post(path, input)).data;
}

export async function deleteStoreCoupon(businessId: string, couponId: string) {
  await api.delete('/businesses/' + businessId + '/coupons/' + couponId);
}

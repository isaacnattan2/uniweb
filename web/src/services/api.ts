import axios, { AxiosInstance } from 'axios';
import type { Business, CartItem, StorePaymentMethod, UserType } from '../context/store';

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
  address?: string | null;
  payment_methods?: StorePaymentMethod[];
  max_card_installments?: number;
  id: string;
  name: string;
  description?: string;
  category?: string;
  category_label?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface StoreOrder {
  id: string;
  order_number: string;
  created_at: string | null;
  total: string;
  status: string;
  payment_status: string;
  delivery_type: string;
  delivery_status: string | null;
  delivery_assigned: boolean;
}

export type StoreOrderAction = 'requeue' | 'cancel';

export async function getStorePushIdentity() {
  const { data } = await api.get<{ externalId: string; token: string }>('/auth/me/push-identity');
  return data;
}

export async function getStoreOrders(businessId: string, offset: number, signal: AbortSignal, orderId?: string) {
  const response = await api.get<{ items: StoreOrder[]; nextOffset: number | null }>(
    `/businesses/${businessId}/orders`, { params: { offset, orderId }, signal }
  );
  return response.data;
}

export async function updateStoreOrder(businessId: string, orderId: string, action: StoreOrderAction) {
  await api.patch(`/businesses/${businessId}/orders/${orderId}`, { action });
}

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
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export async function registerUser(email: string, password: string, fullName: string, userType: string = 'customer', deliveryAddress?: DeliveryAddress, phone?: string) {
  const response = await api.post('/auth/register', { email, password, fullName, userType, deliveryAddress, phone });
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

export async function updateBusiness(id: string, data: { name: string; category: string; description: string; address?: string | null } | { payment_methods: StorePaymentMethod[]; max_card_installments: number }): Promise<Business> {
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

export interface DeliveryAddress {
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement: string;
}

export async function lookupPostalCode(cep: string, signal: AbortSignal): Promise<Pick<DeliveryAddress, 'street' | 'neighborhood' | 'city' | 'state'>> {
  return (await api.get('/auth/postal-code/' + cep, { signal })).data;
}

export interface SavedDeliveryAddress {
  id: string;
  address: DeliveryAddress;
}

export async function getSavedDeliveryAddresses(signal: AbortSignal): Promise<SavedDeliveryAddress[]> {
  return (await api.get('/auth/me/addresses', { signal })).data;
}

export async function createOrder(
  items: Array<{ productId: string; quantity: number; price: number }>,
  paymentMethod: PaymentMethod,
  deliveryType: DeliveryType,
  deliveryAddress: DeliveryAddress | string,
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

export async function cancelMyOrder(orderId: string) {
  await api.post(`/orders/${orderId}/cancel`);
}

export async function getOrder(orderId: string) {
  const response = await api.get(`/orders/${orderId}`);
  return response.data;
}

export interface TrackedPosition {
  latitude: number;
  longitude: number;
  updatedAt: string;
}

export async function getDeliveryTracking(orderId: string, signal: AbortSignal) {
  const response = await api.get<{ active: boolean; position: TrackedPosition | null }>(
    `/orders/${encodeURIComponent(orderId)}/tracking`, { signal, timeout: 7000 }
  );
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

export interface MarketplaceAd {
  id: string;
  business_id: string;
  title: string;
  image_url: string;
}

export interface AdminAd extends MarketplaceAd {
  position: number;
  published: boolean;
}

export async function getShopAds(): Promise<MarketplaceAd[]> {
  return (await api.get('/shop/ads')).data;
}

export async function getAdminAds(): Promise<AdminAd[]> {
  return (await api.get('/admin/ads')).data;
}

export async function saveAdminAd(data: {
  businessId: string; title: string; position: number; published: boolean; imageUrl: string;
}, id?: string): Promise<AdminAd> {
  return (id ? await api.put('/admin/ads/' + id, data) : await api.post('/admin/ads', data)).data;
}

export async function deleteAdminAd(id: string) {
  await api.delete('/admin/ads/' + id);
}

export interface CustomerProfile {
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
}

export async function getCustomerProfile(signal: AbortSignal): Promise<CustomerProfile> {
  return (await api.get('/auth/me/profile', { signal })).data;
}

export async function saveCustomerProfile(data: {
  fullName: string; email: string; phone: string; currentPassword: string;
}): Promise<CustomerProfile> {
  return (await api.put('/auth/me/profile', data)).data;
}

export async function saveCustomerAvatar(file: File): Promise<{ avatar_url: string }> {
  const form = new FormData();
  form.append('image', file);
  return (await api.post('/auth/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
}

export async function saveCustomerAddress(address: DeliveryAddress, id?: string): Promise<SavedDeliveryAddress> {
  const path = '/auth/me/addresses';
  return (id ? await api.put(path + '/' + id, address) : await api.post(path, address)).data;
}

export type CustomerCartAction =
  | { action: 'add' | 'set'; productId: string; quantity: number }
  | { action: 'remove'; productId: string }
  | { action: 'merge'; items: Array<{ productId: string; quantity: number }> };

export async function getCustomerCart(token: string): Promise<CartItem[]> {
  return (await api.get('/cart', { headers: { Authorization: 'Bearer ' + token } })).data;
}

export async function changeCustomerCart(token: string, change: CustomerCartAction): Promise<CartItem[]> {
  return (await api.post('/cart', change, { headers: { Authorization: 'Bearer ' + token } })).data;
}

export interface DriverRegistrationInput {
  fullName: string;
  email: string;
  phone: string;
  cpf: string;
  password: string;
  vehicleType: string;
  manufacturer: string;
  brand: string;
  color: string;
  plate: string;
}

export interface DriverRegistration {
  full_name: string;
  email: string;
  phone: string;
  vehicle_type: string;
  vehicle_manufacturer: string | null;
  vehicle_brand: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
}

export async function registerDriver(data: DriverRegistrationInput): Promise<{
  user: { id: string; user_type: 'driver' };
  token: string;
}> {
  return (await api.post('/auth/register/driver', data)).data;
}

export async function getDriverRegistration(signal: AbortSignal): Promise<DriverRegistration> {
  return (await api.get('/auth/me/driver', { signal })).data;
}

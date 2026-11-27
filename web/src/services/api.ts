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
  payment_methods?: StorePaymentMethod[];
  max_card_installments?: number;
  card_payment_configured?: boolean;
  asaas_pix_split_condition?: SavedPaymentSplit | null;
  asaas_card_split_condition?: SavedPaymentSplit | null;
  owner_email: string;
  owner_status: Seller['status'] | 'deleted';
  status: 'active' | 'inactive' | 'suspended';
}

export interface AdminDriver {
  has_license_photo?: boolean;
  missed_offer_block_minutes: number | null;
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: 'active' | 'inactive' | 'suspended';
  checked_in: boolean;
  vehicle_type: string | null;
  vehicle_manufacturer: string | null;
  vehicle_brand: string | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
  delivery_rate_cents: number | null;
  delivery_rate_locked: boolean | null;
}

export interface DeliveryRatePolicy {
  minimumCents: number | null;
  maximumCents: number | null;
  defaultCents: number;
  allowCustom: boolean;
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
  card_payment_configured?: boolean;
  platform_fee_basis_points?: number | null;
  asaas_pix_split_condition?: SavedPaymentSplit | null;
  asaas_card_split_condition?: SavedPaymentSplit | null;
  id: string;
  name: string;
  description?: string;
  category?: string;
  category_label?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function formatOrderCode(orderId: string) {
  return orderId.slice(0, 8).toUpperCase();
}

export type DriverAppTheme = { primary: string; secondary: string };

export async function getDriverAppTheme(signal: AbortSignal) {
  return (await api.get<DriverAppTheme>('/app/theme', { signal })).data;
}

export async function updateDriverAppTheme(theme: DriverAppTheme) {
  return (await api.put<DriverAppTheme>('/admin/app/theme', theme)).data;
}

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
  dispatch_state?: string | null;
  slot_at?: string | null;
}

export type StoreOrderAction = 'requeue' | 'cancel';

export async function getStorePushIdentity() {
  const { data } = await api.get<{ externalId: string; token: string }>('/auth/me/push-identity', { params: { channel: 'web' } });
  return data;
}

export interface AsaasSimulationFees {
  environment: 'sandbox' | 'production';
  fetchedAt: string;
  pix: {
    standardFixed: number | null;
    fixed: number;
    rate: number;
    minimum: number | null;
    maximum: number | null;
    promotionExpiresAt: string | null;
  } | null;
  creditCard: {
    daysToReceive: number | null;
    bands: { min: number; max: number; standardRate: number | null; rate: number; fixed: number; promotionExpiresAt: string | null }[];
  };
}

export async function getAsaasSimulationFees(signal: AbortSignal): Promise<AsaasSimulationFees> {
  return (await api.get('/admin/asaas/fees', { signal })).data;
}

export type PaymentSplitDraft = {
  method: 'pix' | 'credit_card';
  maxInstallments: number;
  fixedFeePerInstallment?: boolean;
  mode: 'fixed' | 'percentage';
  feeOwner: string;
  discountOwner: string;
  commissionBase: string;
  commissionRate: number;
  commissionFixed: number;
  feeSource: 'manual' | 'account';
  asaasRate: number;
  asaasFixed: number;
  asaasMinimum: number | null;
  asaasMaximum: number | null;
  fixedOverride: number | null;
  rateOverride: number | null;
};

export type SavedPaymentSplit = Omit<PaymentSplitDraft, 'method' | 'maxInstallments' | 'feeSource'> & {
  version: string;
  ownerId: string;
  expiresAt: string | null;
  maxInstallments?: number;
  feeSource?: PaymentSplitDraft['feeSource'];
  manualFixedPerInstallment?: number;
  cardFeeBands?: { min: number; max: number; rate: number; fixed: number }[];
};

export async function removePaymentSplitCondition(id: string, method: PaymentSplitDraft['method'], version: string) {
  await api.delete('/admin/businesses/' + id + '/split-conditions/' + (method === 'pix' ? 'pix' : 'card') + '/' + version);
}

export async function applyPaymentSplitCondition(id: string, draft: PaymentSplitDraft, expectedVersion: string | null, authorizeCardSetup: boolean, expectedCardLimit?: number): Promise<{ condition: SavedPaymentSplit; maxInstallments: number; configuredCard: boolean }> {
  const conditionPath = draft.method === 'pix' ? '/pix-split' : '/card-split';
  return (await api.put('/admin/businesses/' + id + conditionPath, { ...draft, expectedVersion, authorizeCardSetup, expectedCardLimit })).data;
}

export interface AdminSplitPayment {
  id: string;
  store: string;
  payment_status: string;
  order_status: string;
  delivery_status: string;
  driver_cents: number | null;
  payment_method: 'pix' | 'credit_card';
  payout_state: 'sending' | 'processing' | 'done' | 'review' | null;
  provider_status: string | null;
  payment_net_cents: string | null;
  shared_payment_id?: string | null;
  store_split_status?: 'none' | 'done' | 'unconfirmed';
  store_cents: string | null;
  confirmed_driver_cents: string | null;
  snapshot: { gross: number; fee: number; net: number; storeEstimate: number; condition: { mode: string; version: string } };
}

export async function getPlatformAsaasBalance(signal: AbortSignal): Promise<{ balance: number; sandbox: boolean }> {
  return (await api.get('/admin/asaas/balance', { signal })).data;
}

export async function getAdminSplitPayments(signal: AbortSignal): Promise<{ balance: number | null; orders: AdminSplitPayment[] }> {
  return (await api.get('/admin/asaas/split-payments', { signal })).data;
}

export async function requestAdminDriverSplitPayment(id: string): Promise<{ state: string }> {
  return (await api.post('/admin/asaas/split-payments/' + id + '/driver')).data;
}

export interface StoreAsaasApproval {
  id?: string;
  general: string;
  commercialInfo?: string;
  bankAccountInfo?: string;
  documentation?: string;
  documentQuery: 'available' | 'initializing' | 'unavailable';
  documentHttpStatus?: number;
  documents: { id?: string; type?: string; status?: string; description?: string; onboardingUrl?: string }[];
}

export interface AdminStoreAsaasAccount {
  sandbox: boolean;
  approval?: StoreAsaasApproval;
  registrationPending?: boolean;
  canSimulate?: boolean;
}

export async function getAdminStoreAsaasAccount(id: string, signal: AbortSignal, collection: 'businesses' | 'drivers' = 'businesses'): Promise<AdminStoreAsaasAccount> {
  return (await api.get('/admin/' + collection + '/' + id + '/asaas-account', { signal })).data;
}

export async function simulateAdminStoreAsaasApproval(id: string, collection: 'businesses' | 'drivers' = 'businesses'): Promise<AdminStoreAsaasAccount> {
  return (await api.post('/admin/' + collection + '/' + id + '/asaas-account/sandbox-approve')).data;
}

export type StoreWithdrawalsResponse = {
  configured: false;
  canRegister?: boolean;
  registrationPending?: boolean;
  approval?: StoreAsaasApproval;
} | {
  configured: true;
  sandbox: boolean;
  availableBalance: number;
  approval: StoreAsaasApproval;
  previousOffset: number | null;
  nextOffset: number | null;
  transfers: {
    id: string;
    status: string;
    value: number;
    netValue?: number | null;
    transferFee?: number | null;
    dateCreated: string;
    effectiveDate?: string | null;
    operationType?: string | null;
  }[];
};

export interface StoreAsaasRegistration {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  province: string;
  complement: string;
  birthDate: string;
  companyType: string;
  incomeValue: number;
}

export async function createStoreAsaasAccount(businessId: string | undefined, registration: StoreAsaasRegistration) {
  const path = businessId ? '/businesses/' + businessId + '/asaas-account' : '/auth/me/driver/asaas-account';
  await api.post(path, registration);
}

export async function getStoreWithdrawals(businessId: string | undefined, offset: number, signal: AbortSignal): Promise<StoreWithdrawalsResponse> {
  const path = businessId ? '/businesses/' + businessId + '/withdrawals' : '/auth/me/driver/withdrawals';
  const { data } = await api.get(path, { params: { offset }, signal });
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

export async function getAdminDrivers(signal: AbortSignal) {
  return (await api.get<AdminDriver[]>('/admin/drivers', { signal })).data;
}

export async function getAdminDeliveryRatePolicy(signal: AbortSignal) {
  return (await api.get<DeliveryRatePolicy | null>('/admin/drivers/delivery-rate', { signal })).data;
}

export async function saveAdminDeliveryRatePolicy(policy: DeliveryRatePolicy) {
  return (await api.put<DeliveryRatePolicy>('/admin/drivers/delivery-rate', policy)).data;
}

export async function getDriverLicensePhoto(id: string, signal?: AbortSignal): Promise<Blob> {
  return (await api.get('/admin/drivers/' + encodeURIComponent(id) + '/license-photo', { responseType: 'blob', signal })).data;
}

export async function setDriverMissedOfferBlock(id: string, minutes: number | null) {
  return (await api.put<{ minutes: number | null }>('/admin/drivers/' + encodeURIComponent(id) + '/missed-offer-block', { minutes })).data;
}

export async function setDriverDeliveryRateLock(id: string, locked: boolean) {
  return (await api.put<{ locked: boolean }>('/admin/drivers/' + id + '/delivery-rate-lock', { locked })).data;
}

export async function setAdminBlock(resource: 'sellers' | 'businesses' | 'drivers', id: string, blocked: boolean) {
  await api.put('/admin/' + resource + '/' + id + '/status', { blocked });
}

export async function createSeller(fullName: string, email: string, password: string) {
  const response = await api.post('/admin/sellers', { fullName, email, password });
  return response.data;
}

export async function getAdminBusinesses(signal?: AbortSignal): Promise<AdminBusiness[]> {
  const response = await api.get('/admin/businesses', { signal });
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

export async function getMyBusinesses(signal?: AbortSignal): Promise<Business[]> {
  const response = await api.get('/businesses/my-businesses', { signal });
  return response.data;
}

export async function getBusiness(id: string): Promise<Business> {
  const response = await api.get(`/businesses/${id}`);
  return response.data;
}

export async function updateBusinessPlatformFee(id: string, fee: number | null): Promise<number | null> {
  const { data } = await api.put('/admin/businesses/' + id + '/platform-fee', { platform_fee_basis_points: fee });
  return data.platform_fee_basis_points;
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

export type SavedCustomerCard = { id: string; brand: string; lastFour: string };
export type SavedCardInput = {
  holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string;
  cpfCnpj: string; postalCode: string; addressNumber: string; phone: string; consent: true;
};

export async function getCustomerCards(signal?: AbortSignal): Promise<{ enabled: boolean; cards: SavedCustomerCard[] }> {
  return (await api.get('/auth/me/cards', { signal })).data;
}

export async function saveCustomerCard(card: SavedCardInput): Promise<SavedCustomerCard> {
  try {
    return (await api.post('/auth/me/cards', card, { timeout: 125000 })).data;
  } catch (error) {
    // Axios retains the request body in its error. Only return the API's sanitized message.
    const message = axios.isAxiosError(error) ? error.response?.data?.error : undefined;
    throw new Error(typeof message === 'string' ? message : 'Não foi possível cadastrar o cartão no Sandbox.');
  }
}

export async function deleteCustomerCard(id: string) {
  await api.delete('/auth/me/cards/' + encodeURIComponent(id));
}

export interface CheckoutDeliverySelection {
  deliveryQuoteId: string;
  scheduledAt: string | null;
  deliveryFeeAccepted: true;
}

export async function createOrder(
  items: Array<{ productId: string; quantity: number; price: number }>,
  paymentMethod: PaymentMethod,
  deliveryType: DeliveryType,
  deliveryAddress: DeliveryAddress | string,
  checkoutId: string,
  couponCode?: string,
  delivery?: CheckoutDeliverySelection | { deliveryQuotes: CheckoutDeliverySelection[] },
  card?: { savedCardId: string; installments: number },
): Promise<{ orderIds: string[]; checkoutUrl: string | null; paymentStatus?: 'paid' | 'pending' | 'failed' }> {
  const response = await api.post('/orders/checkout',
    { items, paymentMethod, deliveryType, deliveryAddress, checkoutId, couponCode, ...delivery, ...card },
    card ? { timeout: 70000 } : undefined);
  return response.data;
}

export interface DeliveryQuote {
  options: { id: string; feeCents: number; estimatedMinutes: number | null }[];
  slots: string[];
  windowMinutes: number;
}

export type DeliveryQuoteMode = 'immediate' | 'scheduled';

export async function getDeliveryQuote(stores: string | string[], address: DeliveryAddress, mode: DeliveryQuoteMode, signal: AbortSignal) {
  const businesses = typeof stores === 'string' ? { businessId: stores } : { businessIds: stores };
  return (await api.post<DeliveryQuote>('/orders/delivery-quote', { ...businesses, address, mode }, { signal })).data;
}

export async function getDeliveryAlternatives(orderId: string) {
  return (await api.get<{ immediate: boolean; slots: string[]; windowMinutes: number }>(`/orders/${orderId}/delivery-alternatives`)).data;
}

export async function scheduleDeliveryAlternative(orderId: string, scheduledAt: string | null) {
  await api.put(`/orders/${orderId}/delivery-alternatives`, { scheduledAt });
}

export async function getDispatchSettings() {
  return (await api.get<{ radius_meters: number; subsidy_cents: number; missed_offer_block_minutes: number; enforce_delivery_deadline: boolean; audit_enabled: boolean; debug_enabled: boolean; allow_lower_offer: boolean; parallel_geocoding: boolean; offer_delivery_mode: 'push' | 'polling' }>('/admin/delivery-dispatch/settings')).data;
}

export async function saveDispatchSettings(radiusMeters: number, subsidyCents: number, offerDeliveryMode: 'push' | 'polling', missedOfferBlockMinutes: number, enforceDeliveryDeadline: boolean, auditEnabled: boolean, allowLowerOffer: boolean, debugEnabled?: boolean, parallelGeocoding?: boolean) {
  await api.put('/admin/delivery-dispatch/settings', { radiusMeters, subsidyCents, offerDeliveryMode, missedOfferBlockMinutes, enforceDeliveryDeadline, auditEnabled, allowLowerOffer, debugEnabled, parallelGeocoding });
}

export interface DispatchDebugEvent {
  key: string;
  driverName?: string | null;
  details: Pick<DriverAuditEntry['details'], 'customerFeeCents' | 'subsidyCents' | 'maxFeeCents'> & {
    event: string;
    orderId: string;
    occurredAt: string;
    searchCycle?: number;
    driverId?: string;
    selectedDriverId?: string;
    acceptedByProvider?: boolean;
    state?: string;
    retryInSeconds?: number;
    reason?: string;
    missedAt?: string;
    blockedUntil?: string;
    drivers?: ({ driverId: string } & NonNullable<DriverAuditEntry['details']['decision']>)[];
  };
}

export async function getDispatchDebug(signal: AbortSignal) {
  return (await api.get<{ enabled: boolean; events: DispatchDebugEvent[]; driverNames?: Record<string, string> }>('/admin/delivery-dispatch/debug', { signal })).data;
}

export interface DispatchIncident {
  order_id: string;
  store_name: string;
  state: string;
  incident_reason: string | null;
  refund_state: string | null;
}

export async function getDispatchIncidents() {
  return (await api.get<DispatchIncident[]>('/admin/delivery-dispatch/incidents')).data;
}

export async function resolveDispatchIncident(orderId: string, action: string, reason: string) {
  await api.put(`/admin/delivery-dispatch/incidents/${orderId}`, { action, reason });
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
  app_download_url?: string;
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

export async function getDriverRegistration(signal?: AbortSignal): Promise<DriverRegistration> {
  return (await api.get('/auth/me/driver', { signal })).data;
}

export interface DriverAuditEntry {
  id: string;
  order_id: string;
  search_cycle: number | null;
  created_at: string;
  details: {
    event: string;
    selected?: boolean;
    acceptedByProvider?: boolean;
    missedAt?: string;
    ignoredOffers?: number;
    blockedUntil?: string;
    expiresAt?: string;
    notifiedAt?: string;
    customerFeeCents?: number;
    subsidyCents?: number;
    maxFeeCents?: number;
    radiusMeters?: number;
    promisedAt?: string;
    decision?: { reasons: string[]; locationAt?: string; blockedUntil?: string; pickupMeters?: number; estimatedMinutes?: number; feeCents?: number; offeredFeeCents?: number | null };
  };
}

export async function getDriverDispatchAudit(id: string, signal: AbortSignal, params: {
  start?: string; end?: string; eventType?: string; page: number; pageSize: number;
}) {
  const { data } = await api.get<DriverAuditEntry[] | { entries: DriverAuditEntry[]; hasNext: boolean }>(
    '/admin/drivers/' + encodeURIComponent(id) + '/dispatch-audit', { signal, params },
  );
  if (Array.isArray(data)) {
    const entries = params.eventType ? data.filter(({ details }) => details.event === params.eventType) : data;
    return { entries, hasNext: false, supportsPagination: false };
  }
  if (!Array.isArray(data?.entries) || typeof data.hasNext !== 'boolean') {
    throw new Error('Resposta inválida da auditoria de entregas.');
  }
  return { ...data, supportsPagination: true };
}

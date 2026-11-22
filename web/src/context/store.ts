import { create } from 'zustand';
import axios from 'axios';
import { changeCustomerCart, getCustomerCart } from '../services/api';
import type { CustomerCartAction } from '../services/api';

export type UserType = 'admin' | 'business' | 'customer' | 'driver';

export type StorePaymentMethod = 'pix' | 'credit_card';
export const DEFAULT_CARD_INSTALLMENTS = 3;
export const MAX_CARD_INSTALLMENTS = 12;

export interface Business {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address?: string | null;
  status: string;
  payment_methods?: StorePaymentMethod[];
  max_card_installments?: number;
}

interface Product {
  id: string;
  business_id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  status: string;
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  businessId: string;
  businessName?: string;
}

interface AuthState {
  token: string | null;
  userId: string | null;
  userType: UserType | null;
  businessId: string | null;
  login: (token: string, userId: string, userType: UserType) => void;
  logout: () => void;
  setBusiness: (businessId: string) => void;
}

interface BusinessState {
  businesses: Business[];
  currentBusiness: Business | null;
  setBusinesses: (businesses: Business[]) => void;
  setCurrentBusiness: (business: Business) => void;
}

interface ProductState {
  products: Product[];
  setProducts: (products: Product[]) => void;
  addProduct: (product: Product) => void;
  removeProduct: (productId: string) => void;
}

interface CartState {
  items: CartItem[];
  syncing: number;
  error: string;
  ready: boolean;
  addToCart: (item: CartItem) => Promise<boolean>;
  removeFromCart: (productId: string) => Promise<boolean>;
  updateQuantity: (productId: string, quantity: number) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  getTotal: () => number;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token') || null,
  userId: localStorage.getItem('userId') || null,
  userType: null,
  businessId: localStorage.getItem('businessId') || null,
  login: (token, userId, userType) => {
    if (localStorage.getItem('userId') !== userId) {
      localStorage.removeItem('businessId');
    }
    localStorage.setItem('token', token);
    localStorage.setItem('userId', userId);
    set({ token, userId, userType, businessId: localStorage.getItem('businessId') });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('businessId');
    set({ token: null, userId: null, userType: null, businessId: null });
  },
  setBusiness: (businessId) => {
    localStorage.setItem('businessId', businessId);
    set({ businessId });
  },
}));

export const useBusinessStore = create<BusinessState>((set) => ({
  businesses: [],
  currentBusiness: null,
  setBusinesses: (businesses) => set({ businesses }),
  setCurrentBusiness: (business) => set({ currentBusiness: business }),
}));

export const useProductStore = create<ProductState>((set) => ({
  products: [],
  setProducts: (products) => set({ products }),
  addProduct: (product) => set((state) => ({ products: [...state.products, product] })),
  removeProduct: (productId) => set((state) => ({ products: state.products.filter((p) => p.id !== productId) })),
}));

const guestCartKey = 'uniweb-guest-cart';
const cartUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const pendingCartKey = (userId: string) => 'uniweb-cart-pending-' + userId;
function readLocalCart(key: string): CartItem[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(data) ? data.filter((item) =>
      item && typeof item.productId === 'string' && cartUuid.test(item.productId) &&
      typeof item.businessId === 'string' && typeof item.name === 'string' &&
      typeof item.price === 'number' && Number.isFinite(item.price) &&
      Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 2147483647
    ) : [];
  } catch {
    return [];
  }
}

function moveLocalCart(from: string, to: string) {
  if (localStorage.getItem(from) === null) return;
  const items = new Map<string, CartItem>();
  for (const item of [...readLocalCart(to), ...readLocalCart(from)]) {
    const previous = items.get(item.productId);
    if (!previous || item.quantity > previous.quantity) items.set(item.productId, item);
  }
  if (items.size) localStorage.setItem(to, JSON.stringify([...items.values()]));
  localStorage.removeItem(from);
}

const initialAuth = useAuthStore.getState();
moveLocalCart('cart', initialAuth.token && initialAuth.userId ? pendingCartKey(initialAuth.userId) : guestCartKey);

function customerScope(auth = useAuthStore.getState()) {
  return auth.userType === 'customer' && auth.token && auth.userId
    ? { token: auth.token, userId: auth.userId } : null;
}

let queue = Promise.resolve();
let generation = 0;
const scopeKey = (scope: ReturnType<typeof customerScope>) => scope && scope.userId + ':' + scope.token;

function syncCart(change?: CustomerCartAction): Promise<boolean> {
  const scope = customerScope();
  if (!scope) return Promise.resolve(false);
  const taskGeneration = generation;
  const current = () => generation === taskGeneration && scopeKey(customerScope()) === scopeKey(scope);
  useCartStore.setState((state) => ({ syncing: state.syncing + 1, error: '' }));
  const task = queue.then(async () => {
    if (!current()) return false;
    try {
      const key = pendingCartKey(scope.userId);
      const raw = localStorage.getItem(key);
      const pending = readLocalCart(key);
      let items: CartItem[] | undefined;
      for (let offset = 0; offset < pending.length; offset += 1000) {
        items = await changeCustomerCart(scope.token, {
          action: 'merge',
          items: pending.slice(offset, offset + 1000).map(({ productId, quantity }) => ({ productId, quantity })),
        });
        if (!current()) return false;
      }
      if (pending.length && localStorage.getItem(key) === raw) localStorage.removeItem(key);
      if (items) useCartStore.setState({ items, ready: true });
      if (change) items = await changeCustomerCart(scope.token, change);
      else if (!items) items = await getCustomerCart(scope.token);
      if (!current()) return false;
      useCartStore.setState({ items, ready: true, error: '' });
      return true;
    } catch (err) {
      if (current()) {
        useCartStore.setState({ error: axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error : 'Não foi possível sincronizar o carrinho. Tente novamente.' });
      }
      return false;
    } finally {
      if (current()) useCartStore.setState((state) => ({ syncing: state.syncing - 1 }));
    }
  });
  queue = task.then(() => undefined);
  return task;
}

export const useCartStore = create<CartState>((set, get) => {
  function updateGuest(update: (items: CartItem[]) => CartItem[]) {
    const items = update(get().items);
    localStorage.setItem(guestCartKey, JSON.stringify(items));
    set({ items, error: '', ready: true });
    return Promise.resolve(true);
  }

  return {
    items: readLocalCart(guestCartKey),
    syncing: 0,
    error: '',
    ready: true,
    refresh: () => syncCart(),
    addToCart: (item) => customerScope()
      ? syncCart({ action: 'add', productId: item.productId, quantity: item.quantity })
      : updateGuest((items) => items.some((entry) => entry.productId === item.productId)
        ? items.map((entry) => entry.productId === item.productId ? { ...entry, quantity: entry.quantity + item.quantity } : entry)
        : [...items, item]),
    removeFromCart: (productId) => customerScope()
      ? syncCart({ action: 'remove', productId })
      : updateGuest((items) => items.filter((item) => item.productId !== productId)),
    updateQuantity: (productId, quantity) => customerScope()
      ? syncCart({ action: 'set', productId, quantity })
      : updateGuest((items) => items.map((item) => item.productId === productId ? { ...item, quantity } : item)),
    getTotal: () => get().items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
});

useAuthStore.subscribe((auth, previous) => {
  const scope = customerScope(auth);
  if (scopeKey(scope) === scopeKey(customerScope(previous))) return;
  generation++;
  queue = Promise.resolve();
  useCartStore.setState({ items: scope ? [] : readLocalCart(guestCartKey), syncing: 0, ready: !scope, error: '' });
  if (scope) {
    moveLocalCart(guestCartKey, pendingCartKey(scope.userId));
    void syncCart();
  }
});

window.addEventListener('focus', () => { if (customerScope() && !useCartStore.getState().syncing) void syncCart(); });
window.addEventListener('storage', (event) => {
  if (event.key === guestCartKey && !customerScope()) useCartStore.setState({ items: readLocalCart(guestCartKey) });
});

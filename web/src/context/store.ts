import { create } from 'zustand';

export type UserType = 'admin' | 'business' | 'customer' | 'driver';

export type StorePaymentMethod = 'pix' | 'credit_card';
export const DEFAULT_CARD_INSTALLMENTS = 3;
export const MAX_CARD_INSTALLMENTS = 12;

export interface Business {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
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

interface CartItem {
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
  addToCart: (item: CartItem) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeStoreFromCart: (businessId: string) => void;
  clearCart: () => void;
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

export const useCartStore = create<CartState>((set, get) => ({
  items: JSON.parse(localStorage.getItem('cart') || '[]'),
  addToCart: (item) => {
    set((state) => {
      const existing = state.items.find((i) => i.productId === item.productId);
      let newItems;
      if (existing) {
        newItems = state.items.map((i) =>
          i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i
        );
      } else {
        newItems = [...state.items, item];
      }
      localStorage.setItem('cart', JSON.stringify(newItems));
      return { items: newItems };
    });
  },
  removeFromCart: (productId) => {
    set((state) => {
      const newItems = state.items.filter((i) => i.productId !== productId);
      localStorage.setItem('cart', JSON.stringify(newItems));
      return { items: newItems };
    });
  },
  updateQuantity: (productId, quantity) => {
    set((state) => {
      const newItems = state.items.map((i) =>
        i.productId === productId ? { ...i, quantity: Math.max(1, quantity) } : i
      );
      localStorage.setItem('cart', JSON.stringify(newItems));
      return { items: newItems };
    });
  },
  removeStoreFromCart: (businessId) => {
    set((state) => {
      const items = state.items.filter((item) => item.businessId !== businessId);
      localStorage.setItem('cart', JSON.stringify(items));
      return { items };
    });
  },
  clearCart: () => {
    localStorage.removeItem('cart');
    set({ items: [] });
  },
  getTotal: () => {
    return get().items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  },
}));

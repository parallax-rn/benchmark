import { create } from 'zustand';
import { parsePrice } from './price';
import type { Product } from './api';

export type CartItem = { id: string; name: string; price: number; qty: number };

type Cart = { items: CartItem[]; add: (p: Product) => void; clear: () => void };

export const useCart = create<Cart>(set => ({
  items: [],
  add: p =>
    set(s => {
      const found = s.items.find(i => i.id === p.id);
      if (found) return { items: s.items.map(i => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i)) };
      return { items: [...s.items, { id: p.id, name: p.name, price: parsePrice(p.price), qty: 1 }] };
    }),
  clear: () => set({ items: [] }),
}));

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.price, 0);
}

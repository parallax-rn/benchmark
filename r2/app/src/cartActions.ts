import { useMemo } from 'react';
import { cartTotal, useCart, type CartItem } from './cart';

export function inc(id: string): void {
  useCart.setState(s => ({ items: s.items.map(i => (i.id === id ? { ...i, qty: i.qty + 1 } : i)) }));
}

// One less; the line goes away at zero.
export function dec(id: string): void {
  useCart.setState(s => ({ items: s.items.flatMap(i => (i.id !== id ? [i] : i.qty > 1 ? [{ ...i, qty: i.qty - 1 }] : [])) }));
}

// Totals are kept per cart content across renders and screens (the cart re-renders on every keystroke of the coupon field).
const totals = new Map<string, number>();

export const cartKey = (items: CartItem[]): string => items.map(i => `${i.id}x${i.qty}`).join(',');

export function useCartTotal(items: CartItem[], discount: number): number {
  return useMemo(() => {
    const key = cartKey(items);
    if (!totals.has(key)) totals.set(key, cartTotal(items));
    return Math.round(totals.get(key)! * (1 - discount) * 100) / 100;
  }, [items, discount]);
}

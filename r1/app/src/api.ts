export const API = 'http://127.0.0.1:8797';

export type Product = { id: string; name: string; price: number | string; description: string; restockedAt: string; stock?: number };

async function json<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(API + path, init);
  return { ok: res.ok, status: res.status, body: (await res.json()) as T };
}

export const getProducts = () => json<Product[]>('/products');
export const getStock = () => json<Record<string, number>>('/stock');
export const getProduct = (id: string) => json<Product>(`/products/${encodeURIComponent(id)}`);
export const searchProducts = (q: string) => json<Product[]>(`/search?q=${encodeURIComponent(q)}`);
export const getProfile = () => json<{ name: string }>('/profile');

export type SaveResult = { data: { name: string; updatedAt: string } | null; error?: string };
export const saveProfile = (name: string) =>
  json<SaveResult>('/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });

import { API } from './api';

export type CouponResult = { discount?: number; error?: string };

export async function applyCoupon(code: string): Promise<CouponResult> {
  try {
    const res = await fetch(`${API}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const body = (await res.json()) as { discount?: number; error?: string };
    if (!res.ok) return { error: res.status === 404 ? 'Unknown coupon' : body.error ?? `Could not apply the coupon (${res.status}). Try again.` };
    return { discount: body.discount };
  } catch {
    return {};
  }
}

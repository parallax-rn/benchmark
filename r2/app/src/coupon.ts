import { API } from './api';

export type CouponResult = { discount?: number; error?: string };

export async function applyCoupon(code: string): Promise<CouponResult> {
  try {
    const res = await fetch(`${API}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) {
      const text = await res.text();
      return { error: res.status === 404 ? 'Unknown coupon' : `Could not apply the coupon (${res.status}${text.startsWith('{') ? '' : ', server error'}). Try again.` };
    }
    const body = (await res.json()) as { discount: number };
    return { discount: body.discount };
  } catch (e) {
    return { error: `Could not apply the coupon: ${String(e)}` };
  }
}

export function parsePrice(p: number | string): number {
  return typeof p === 'number' ? p : Number(String(p).replace(',', '.'));
}

export function formatPrice(p: number | string): string {
  const n = parsePrice(p);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

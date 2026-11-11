export function parsePrice(p: number | string): number {
  return Number(p);
}

export function formatPrice(p: number | string): string {
  const n = parsePrice(p);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

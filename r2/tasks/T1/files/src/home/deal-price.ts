// A deal shows the price with two decimals, as the rest of the shop does.
export function dealPrice(p: number | string): string {
  return `$${parseFloat(String(p)).toFixed(2)}`;
}

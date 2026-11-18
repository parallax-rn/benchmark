import { parsePrice } from '../price';

// A deal shows the price with two decimals, as the rest of the shop does.
export function dealPrice(p: number | string): string {
  return `$${parsePrice(p).toFixed(2)}`;
}

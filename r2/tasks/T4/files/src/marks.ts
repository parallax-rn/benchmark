// The small coloured mark at the start of a product row: what kind of offer the product is in.
export type Offer = 'sale' | 'clearance' | 'new';

// The offers as the merchandising sheet exports them (its spelling of the offer varies).
const SHEET = 'p1:Sale p3:Clearance p4:New p6:sale p7:clearance';

export const OFFERS: Record<string, string> = Object.fromEntries(SHEET.split(' ').map(entry => entry.split(':')).map(([id, offer]) => [id, offer]));

export const OFFER_COLORS: Record<Offer, string> = { sale: '#d1242f', clearance: '#f0883e', new: '#2da44e' };
export const NO_OFFER = '#c8c8c8';

export function markColor(id: string): string {
  return OFFER_COLORS[OFFERS[id] as Offer] ?? NO_OFFER;
}

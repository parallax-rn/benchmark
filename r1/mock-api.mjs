// The benchmark app's API (plan 0023): node stdlib, 127.0.0.1 only, the same for every bug. The correct app handles everything it sends.
// node bench/r1/mock-api.mjs [--port 8797]
import { createServer } from 'node:http';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8797;

// Prices: most suppliers send numbers; the "legacy" supplier sends strings with a decimal comma (bug B1).
export const PRODUCTS = [
  { id: 'p1', name: 'Desk lamp', price: 39.5 },
  { id: 'p2', name: 'Lantern', price: '12,99' },
  { id: 'p3', name: 'Ladder', price: 89 },
  { id: 'p4', name: 'Label maker', price: '24,90' },
  { id: 'p5', name: 'Lamp shade', price: 15.25 },
  { id: 'p6', name: 'Mug', price: 8 },
  { id: 'p7', name: 'Notebook', price: '4,50' },
  { id: 'p8', name: 'Pen set', price: 11.75 },
].map((p, n) => ({ ...p, description: `${p.name}, sold by the Shop.`, restockedAt: new Date(Date.now() - (n + 2) * 86400000).toISOString() }));

// Stock comes from another service and answers fast; the product list is slow, so stock arrives first (bug B2).
export const STOCK = { p1: 4, p2: 0, p3: 2, p4: 7, p5: 1, p6: 12, p7: 0, p8: 3 };
export const PRODUCTS_DELAY = 800;
export const STOCK_DELAY = 100;

// A name over 20 characters is rejected with 422 and `data: null` (bug B3); the stored profile starts with a 24-character name.
export const MAX_NAME = 20;
let profile = { name: 'Alexandria Montgomery-Li', updatedAt: '2026-11-01T09:00:00Z' };

export const searchDelay = hits => 100 + 50 * hits;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const log = status => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} ${status}`);
  if (req.method === 'GET' && url.pathname === '/products') return void setTimeout(() => (log(200), send(res, 200, PRODUCTS)), PRODUCTS_DELAY);
  if (req.method === 'GET' && url.pathname === '/stock') return void setTimeout(() => (log(200), send(res, 200, STOCK)), STOCK_DELAY);
  const one = url.pathname.match(/^\/products\/([^/]+)$/);
  if (req.method === 'GET' && one) {
    const p = PRODUCTS.find(x => x.id === decodeURIComponent(one[1]));
    return p ? (log(200), send(res, 200, p)) : (log(404), send(res, 404, { error: 'not found' }));
  }
  if (req.method === 'GET' && url.pathname === '/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const hits = PRODUCTS.filter(p => p.name.toLowerCase().includes(q));
    return void setTimeout(() => (log(200), send(res, 200, hits)), searchDelay(hits.length));
  }
  if (req.method === 'GET' && url.pathname === '/profile') return log(200), send(res, 200, { name: profile.name });
  if (req.method === 'POST' && url.pathname === '/profile') {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      let name = '';
      try {
        name = String(JSON.parse(raw).name ?? '');
      } catch {}
      if (!name || name.length > MAX_NAME) return log(422), send(res, 422, { data: null, error: `Name must be 1 to ${MAX_NAME} characters` });
      profile = { name, updatedAt: new Date().toISOString() };
      log(200), send(res, 200, { data: profile });
    });
    return;
  }
  log(404), send(res, 404, { error: 'not found' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handle).listen(port, '127.0.0.1', () => console.log(`mock API on http://127.0.0.1:${port}`));
}

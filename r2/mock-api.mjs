// The R2 app's API (plan 0027): R1's mock (bench/r1/mock-api.mjs) plus a coupon endpoint and a slower search, node stdlib, 127.0.0.1 only.
//   node bench/r2/mock-api.mjs [--port 8797]
// T2: the first POST /coupon after the start (or after POST /__rearm, the harness's only control) answers 500 with an HTML body, as a proxy in
// front of a crashed service does; every later one answers as the coupon service does. T3: a search answers later the more products match.
import { createServer } from 'node:http';
import { handle as r1, PRODUCTS } from '../r1/mock-api.mjs';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8797;

export const COUPONS = { SAVE10: 0.1 };
export const searchDelay = hits => 100 + 150 * hits;

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

export function createHandler() {
  let failNext = true;
  return (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const log = status => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} ${status}`);
    if (req.method === 'POST' && url.pathname === '/__rearm') return (failNext = true), log(204), res.writeHead(204).end();
    if (req.method === 'POST' && url.pathname === '/coupon') {
      let raw = '';
      req.on('data', c => (raw += c));
      req.on('end', () => {
        if (failNext) {
          failNext = false;
          return log(500), send(res, 500, '<html><body><h1>500 Internal Server Error</h1></body></html>', 'text/html');
        }
        let code = '';
        try {
          code = String(JSON.parse(raw).code ?? '').toUpperCase();
        } catch {}
        const discount = COUPONS[code];
        return discount === undefined ? (log(404), send(res, 404, { error: 'Unknown coupon' })) : (log(200), send(res, 200, { discount }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const hits = PRODUCTS.filter(p => p.name.toLowerCase().includes(q));
      return void setTimeout(() => (log(200), send(res, 200, hits)), searchDelay(hits.length));
    }
    return r1(req, res);
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(createHandler()).listen(port, '127.0.0.1', () => console.log(`shop API on http://127.0.0.1:${port}`));
}

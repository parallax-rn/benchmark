import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createHandler, searchDelay } from './mock-api.mjs';

async function server() {
  const s = createServer(createHandler());
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { base, close: () => new Promise(r => s.close(r)) };
}
const coupon = (base, code) => fetch(`${base}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });

test('the first coupon call fails with an HTML 500, later ones answer, and rearm brings the failure back', async () => {
  const { base, close } = await server();
  try {
    const first = await coupon(base, 'SAVE10');
    assert.equal(first.status, 500);
    assert.match(await first.text(), /^<html>/);
    assert.deepEqual(await (await coupon(base, 'save10')).json(), { discount: 0.1 });
    const unknown = await coupon(base, 'NOPE');
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'Unknown coupon' });
    assert.equal((await fetch(`${base}/__rearm`, { method: 'POST' })).status, 204);
    assert.equal((await coupon(base, 'SAVE10')).status, 500);
  } finally {
    await close();
  }
});

test('typing "lamp" one key at a time at 150 ms: the answer to "la" lands last (T3), and R1 routes still answer', async () => {
  const hits = { l: 5, la: 5, lam: 2, lamp: 2 };
  const arrivals = ['l', 'la', 'lam', 'lamp'].map((q, i) => ({ q, at: i * 150 + searchDelay(hits[q]) })).sort((a, b) => a.at - b.at);
  assert.equal(arrivals.at(-1).q, 'la');
  const { base, close } = await server();
  try {
    const found = await (await fetch(`${base}/search?q=la`)).json();
    assert.deepEqual(found.map(p => p.id).sort(), ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.equal((await (await fetch(`${base}/products/p2`)).json()).price, '12,99');
  } finally {
    await close();
  }
});

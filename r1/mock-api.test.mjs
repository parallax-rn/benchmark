import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { handle, MAX_NAME, PRODUCTS } from './mock-api.mjs';

test('the API sends what the bugs need', async () => {
  const s = createServer(handle).listen(0, '127.0.0.1');
  await new Promise(r => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const orig = console.log;
  console.log = () => {};
  try {
    assert.ok(PRODUCTS.some(p => typeof p.price === 'string' && p.price.includes(','))); // B1
    const t0 = Date.now(); // B2: stock lands before the product list
    const [products, stock] = await Promise.all([fetch(`${base}/products`).then(r => r.json().then(b => [Date.now() - t0, b])), fetch(`${base}/stock`).then(r => r.json().then(b => [Date.now() - t0, b]))]);
    assert.ok(stock[0] + 500 < products[0]);
    assert.ok(products[1].every(p => p.id in stock[1]) && Object.values(stock[1]).some(n => n === 0));
    const name = (await (await fetch(`${base}/profile`)).json()).name; // B3
    assert.ok(name.length > MAX_NAME);
    const bad = await fetch(`${base}/profile`, { method: 'POST', body: JSON.stringify({ name }) });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).data, null);
    const ok = await fetch(`${base}/profile`, { method: 'POST', body: JSON.stringify({ name: 'Alex' }) });
    assert.equal((await ok.json()).data.name, 'Alex');
  } finally {
    console.log = orig;
    s.close();
  }
});
